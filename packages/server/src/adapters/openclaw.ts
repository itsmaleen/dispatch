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
  };
}

interface PendingTask {
  turnId: string;
  startedAt: Date;
  sessionKey?: string;
  pollInterval?: ReturnType<typeof setInterval>;
}

export class OpenClawAdapter implements AdapterImplementation {
  private ctx!: AdapterContext;
  private config: OpenClawConfig;
  private state: AdapterState = {
    status: 'disconnected',
  };
  private pendingTasks = new Map<string, PendingTask>();

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
    // Clear all pending task polls
    for (const [, task] of this.pendingTasks) {
      if (task.pollInterval) {
        clearInterval(task.pollInterval);
      }
    }
    this.pendingTasks.clear();
    
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
        status: string; 
        childSessionKey?: string;
        runId?: string;
      };

      this.ctx.log.info(`Spawned session: ${result.childSessionKey}`);

      // Track the pending task
      const task: PendingTask = {
        turnId,
        startedAt,
        sessionKey: result.childSessionKey,
      };
      this.pendingTasks.set(turnId, task);

      // Start polling for completion
      this.pollForCompletion(turnId, result.childSessionKey!);

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
    // Clear all polls - sessions will continue but we stop tracking
    for (const [turnId, task] of this.pendingTasks) {
      if (task.pollInterval) {
        clearInterval(task.pollInterval);
      }
      this.ctx.emitEvent({
        type: 'turn.completed',
        threadId: this.state.activeThreadId!,
        turnId,
        status: 'interrupted',
        durationMs: Date.now() - task.startedAt.getTime(),
      });
    }
    this.pendingTasks.clear();
    this.ctx.log.info('OpenClaw tasks interrupted');
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

  private pollForCompletion(turnId: string, sessionKey: string): void {
    const { gatewayUrl, gatewayToken } = this.config.options ?? {};
    const task = this.pendingTasks.get(turnId);
    if (!task) return;

    let pollCount = 0;
    const maxPolls = 60; // 5 minutes at 5s intervals

    task.pollInterval = setInterval(async () => {
      pollCount++;
      
      if (pollCount > maxPolls) {
        clearInterval(task.pollInterval);
        this.pendingTasks.delete(turnId);
        this.ctx.emitEvent({
          type: 'turn.completed',
          threadId: this.state.activeThreadId!,
          turnId,
          status: 'failed',
          reason: 'Polling timeout',
          durationMs: Date.now() - task.startedAt.getTime(),
        });
        return;
      }

      try {
        // Check session status via history endpoint
        const response = await fetch(
          `${gatewayUrl}/api/sessions/${encodeURIComponent(sessionKey)}/history?limit=1`,
          {
            headers: {
              'Authorization': `Bearer ${gatewayToken}`,
            },
          }
        );

        if (!response.ok) {
          this.ctx.log.warn(`Poll failed: ${response.status}`);
          return;
        }

        const data = await response.json() as { 
          messages?: Array<{ role: string; content: string }>;
          status?: string;
        };

        // Check if session has completed (look for assistant message)
        const assistantMessage = data.messages?.find(m => m.role === 'assistant');
        if (assistantMessage) {
          clearInterval(task.pollInterval);
          this.pendingTasks.delete(turnId);

          this.ctx.emitEvent({
            type: 'content.delta',
            threadId: this.state.activeThreadId!,
            turnId,
            payload: {
              streamKind: 'assistant_text',
              delta: assistantMessage.content,
            },
          });

          this.ctx.emitEvent({
            type: 'turn.completed',
            threadId: this.state.activeThreadId!,
            turnId,
            status: 'completed',
            durationMs: Date.now() - task.startedAt.getTime(),
          });
        }
      } catch (error) {
        this.ctx.log.warn(`Poll error: ${error}`);
      }
    }, 5000); // Poll every 5 seconds
  }
}

export function createOpenClawAdapter(config: AdapterConfig): OpenClawAdapter {
  return new OpenClawAdapter(config as OpenClawConfig);
}
