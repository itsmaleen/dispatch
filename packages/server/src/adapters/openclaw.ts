/**
 * OpenClaw Adapter
 * 
 * HTTP-based control of OpenClaw instances.
 * Uses the gateway HTTP API to spawn sessions and get results.
 */

import type { 
  AdapterConfig, 
  AdapterState, 
  AdapterCapabilities,
  SendOptions 
} from '@acc/contracts';
import type { AdapterContext, AdapterImplementation } from './types';

interface OpenClawConfig extends AdapterConfig {
  options?: {
    /** Gateway URL (e.g., http://localhost:18789) */
    gatewayUrl: string;
    /** Gateway token for auth */
    gatewayToken: string;
    /** Model to use (e.g., anthropic/claude-sonnet-4-20250514) */
    model?: string;
    /** Thinking level */
    thinking?: 'off' | 'low' | 'medium' | 'high';
    /** Timeout in seconds */
    timeoutSeconds?: number;
    /** Optional callback URL for task results */
    callbackUrl?: string;
  };
}

// Note: Config-receiver runs tasks synchronously
// Results come via callback webhook if configured

export class OpenClawAdapter implements AdapterImplementation {
  private ctx!: AdapterContext;
  private config: OpenClawConfig;
  private state: AdapterState = {
    status: 'disconnected',
  };

  constructor(config: OpenClawConfig) {
    this.config = config;
  }

  async init(ctx: AdapterContext): Promise<void> {
    this.ctx = ctx;
    this.ctx.log.info('OpenClaw adapter initialized');
  }

  getCapabilities(): AdapterCapabilities {
    return {
      streaming: false, // HTTP doesn't stream, we poll
      interruptible: false, // Can't interrupt spawned sessions easily
      concurrent: true,
      maxConcurrency: 5,
      fileWatch: false,
      approvals: false,
    };
  }

  getState(): AdapterState {
    return { ...this.state };
  }

  async connect(): Promise<void> {
    if (this.state.status !== 'disconnected') {
      throw new Error('Already connected or connecting');
    }

    const { gatewayUrl, gatewayToken } = this.config.options ?? {};
    if (!gatewayUrl || !gatewayToken) {
      throw new Error('OpenClaw gatewayUrl and gatewayToken are required');
    }

    this.updateState({ status: 'connecting' });
    this.ctx.log.info(`Connecting to OpenClaw at ${gatewayUrl}...`);

    try {
      // Test connection with health check
      const response = await fetch(`${gatewayUrl}/health`, {
        headers: {
          'Authorization': `Bearer ${gatewayToken}`,
        },
      });

      if (!response.ok) {
        throw new Error(`Health check failed: ${response.status}`);
      }

      this.updateState({ 
        status: 'ready',
        activeThreadId: crypto.randomUUID(),
      });

      this.ctx.emitEvent({
        type: 'session.started',
        threadId: this.state.activeThreadId!,
      });

      this.ctx.log.info('OpenClaw connected');

    } catch (error) {
      this.updateState({ 
        status: 'error', 
        lastError: error instanceof Error ? error.message : 'Connection failed' 
      });
      throw error;
    }
  }

  async disconnect(): Promise<void> {
    this.updateState({ status: 'disconnected' });
    this.ctx.log.info('OpenClaw disconnected');
  }

  async send(options: SendOptions): Promise<{ turnId: string }> {
    if (this.state.status !== 'ready') {
      throw new Error('Not connected');
    }

    const { gatewayUrl, gatewayToken } = this.config.options ?? {};
    const turnId = crypto.randomUUID();
    
    this.ctx.emitEvent({
      type: 'turn.started',
      threadId: this.state.activeThreadId!,
      turnId,
    });

    const startedAt = new Date();

    try {
      // Send task via config-receiver /task endpoint
      // This is used by docker/EC2 agents with config-receiver installed
      const response = await fetch(`${gatewayUrl}/task`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${gatewayToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          task: this.formatMessage(options),
          taskId: turnId,
          model: options.model ?? this.config.options?.model,
          callback: this.config.options?.callbackUrl, // Optional webhook for results
        }),
      });

      if (!response.ok) {
        const error = await response.text();
        throw new Error(`Spawn failed: ${error}`);
      }

      const result = await response.json() as { 
        ok: boolean;
        taskId?: string;
        jobId?: string;
        message?: string;
        error?: string;
      };

      if (!result.ok) {
        throw new Error(result.error ?? 'Task injection failed');
      }

      this.ctx.log.info(`Task injected: ${result.taskId ?? result.jobId}`);

      // Config-receiver runs tasks synchronously in main session
      // Mark as completed immediately (results come via callback if configured)
      const durationMs = Date.now() - startedAt.getTime();
      
      this.ctx.emitEvent({
        type: 'turn.completed',
        threadId: this.state.activeThreadId!,
        turnId,
        status: 'completed',
        durationMs,
      });

      return { turnId };

    } catch (error) {
      this.ctx.emitEvent({
        type: 'turn.completed',
        threadId: this.state.activeThreadId!,
        turnId,
        status: 'failed',
        reason: error instanceof Error ? error.message : 'Unknown error',
        durationMs: Date.now() - startedAt.getTime(),
      });
      throw error;
    }
  }

  async interrupt(): Promise<void> {
    // Config-receiver tasks run synchronously, can't interrupt
    this.ctx.log.info('OpenClaw interrupt called (no-op for config-receiver)');
  }

  async destroy(): Promise<void> {
    await this.disconnect();
  }

  // ============ Private Methods ============

  private updateState(partial: Partial<AdapterState>): void {
    this.state = { ...this.state, ...partial };
    this.ctx.emitEvent({
      type: 'session.state.changed',
      threadId: this.state.activeThreadId,
      payload: { state: this.state.status },
    });
  }

  private formatMessage(options: SendOptions): string {
    let message = options.message;
    
    if (options.context) {
      message = `[Context]\n${options.context}\n\n[Task]\n${message}`;
    }
    
    return message;
  }
}

export function createOpenClawAdapter(config: AdapterConfig): OpenClawAdapter {
  return new OpenClawAdapter(config as OpenClawConfig);
}
