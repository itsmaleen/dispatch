/**
 * OpenClaw Adapter
 * 
 * WebSocket-based control of OpenClaw instances.
 * Connects to OpenClaw gateway, sends tasks via cron API, receives results.
 */

import WebSocket from 'ws';
import type { 
  AdapterConfig, 
  AdapterState, 
  AdapterCapabilities,
  SendOptions 
} from '@acc/contracts';
import type { AdapterContext, AdapterImplementation } from './types';

interface OpenClawConfig extends AdapterConfig {
  options?: {
    /** Gateway URL (e.g., ws://localhost:3000) */
    gatewayUrl: string;
    /** Gateway token for auth */
    gatewayToken: string;
    /** Model to use */
    model?: string;
    /** Thinking level */
    thinking?: 'off' | 'low' | 'medium' | 'high';
  };
}

interface PendingTask {
  turnId: string;
  startedAt: Date;
  resolve: (result: unknown) => void;
  reject: (error: Error) => void;
}

export class OpenClawAdapter implements AdapterImplementation {
  private ctx!: AdapterContext;
  private config: OpenClawConfig;
  private ws: WebSocket | null = null;
  private state: AdapterState = {
    status: 'disconnected',
  };
  private pendingTasks = new Map<string, PendingTask>();
  private messageId = 0;
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 5;

  constructor(config: OpenClawConfig) {
    this.config = config;
  }

  async init(ctx: AdapterContext): Promise<void> {
    this.ctx = ctx;
    this.ctx.log.info('OpenClaw adapter initialized');
  }

  getCapabilities(): AdapterCapabilities {
    return {
      streaming: true,
      interruptible: true,
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

    return new Promise((resolve, reject) => {
      try {
        this.ws = new WebSocket(gatewayUrl, {
          headers: {
            'Authorization': `Bearer ${gatewayToken}`,
          },
        });

        this.ws.on('open', () => {
          this.ctx.log.info('OpenClaw WebSocket connected');
          this.reconnectAttempts = 0;
          this.updateState({ 
            status: 'ready',
            activeThreadId: crypto.randomUUID(),
          });
          
          this.ctx.emitEvent({
            type: 'session.started',
            threadId: this.state.activeThreadId!,
          });
          
          resolve();
        });

        this.ws.on('message', (data) => {
          this.handleMessage(data.toString());
        });

        this.ws.on('close', () => {
          this.ctx.log.warn('OpenClaw WebSocket closed');
          this.updateState({ status: 'disconnected' });
          this.attemptReconnect();
        });

        this.ws.on('error', (error) => {
          this.ctx.log.error('OpenClaw WebSocket error:', error.message);
          if (this.state.status === 'connecting') {
            reject(error);
          }
        });

      } catch (error) {
        this.updateState({ 
          status: 'error', 
          lastError: error instanceof Error ? error.message : 'Connection failed' 
        });
        reject(error);
      }
    });
  }

  async disconnect(): Promise<void> {
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    this.updateState({ status: 'disconnected' });
    this.ctx.log.info('OpenClaw disconnected');
  }

  async send(options: SendOptions): Promise<{ turnId: string }> {
    if (!this.ws || this.state.status !== 'ready') {
      throw new Error('Not connected');
    }

    const turnId = crypto.randomUUID();
    const taskId = `task-${turnId.slice(0, 8)}`;
    
    this.ctx.emitEvent({
      type: 'turn.started',
      threadId: this.state.activeThreadId!,
      turnId,
    });

    // Create task via cron API
    const cronJob = {
      name: taskId,
      schedule: { kind: 'at', at: new Date().toISOString() },
      sessionTarget: 'isolated',
      deleteAfterRun: true,
      payload: {
        kind: 'agentTurn',
        message: this.formatMessage(options),
        model: options.model ?? this.config.options?.model,
        thinking: this.config.options?.thinking ?? 'low',
        timeoutSeconds: 300,
      },
      delivery: {
        mode: 'announce',
        channel: 'fleet',
        to: `default:task:${turnId}`,
      },
    };

    const requestId = this.sendRequest('cron.add', cronJob);

    // Track pending task
    return new Promise((resolve, reject) => {
      this.pendingTasks.set(turnId, {
        turnId,
        startedAt: new Date(),
        resolve: () => resolve({ turnId }),
        reject,
      });

      // Set timeout
      setTimeout(() => {
        if (this.pendingTasks.has(turnId)) {
          this.pendingTasks.delete(turnId);
          reject(new Error('Task timeout'));
        }
      }, 300000); // 5 min timeout
    });
  }

  async interrupt(): Promise<void> {
    // Cancel all pending tasks
    for (const [turnId, task] of this.pendingTasks) {
      this.ctx.emitEvent({
        type: 'turn.completed',
        threadId: this.state.activeThreadId!,
        turnId,
        status: 'interrupted',
        durationMs: Date.now() - task.startedAt.getTime(),
      });
      task.reject(new Error('Interrupted'));
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

  private sendRequest(method: string, params: unknown): number {
    const id = ++this.messageId;
    const message = JSON.stringify({ id, method, params });
    this.ws?.send(message);
    return id;
  }

  private formatMessage(options: SendOptions): string {
    let message = options.message;
    
    if (options.context) {
      message = `[Context]\n${options.context}\n\n[Task]\n${message}`;
    }
    
    return message;
  }

  private handleMessage(data: string): void {
    try {
      const msg = JSON.parse(data);

      // Handle RPC responses
      if (msg.id && msg.result) {
        this.ctx.log.info(`RPC response ${msg.id}:`, msg.result);
        return;
      }

      // Handle events
      if (msg.type === 'event') {
        this.handleEvent(msg);
        return;
      }

      // Handle fleet callbacks (task results)
      if (msg.type === 'result' || msg.taskId) {
        this.handleTaskResult(msg);
        return;
      }

    } catch (error) {
      this.ctx.log.error('Failed to parse message:', error);
    }
  }

  private handleEvent(msg: { event: string; data: unknown }): void {
    this.ctx.log.info(`OpenClaw event: ${msg.event}`);
    
    // Map OpenClaw events to our event types
    // This is a simplified mapping - expand as needed
    this.ctx.emitEvent({
      type: 'content.delta',
      threadId: this.state.activeThreadId!,
      payload: {
        streamKind: 'assistant_text',
        delta: JSON.stringify(msg.data),
      },
    });
  }

  private handleTaskResult(msg: { taskId?: string; turnId?: string; result?: string; status?: string }): void {
    const turnId = msg.turnId ?? msg.taskId?.replace('task-', '');
    if (!turnId) return;

    const pending = this.pendingTasks.get(turnId);
    if (!pending) return;

    const durationMs = Date.now() - pending.startedAt.getTime();
    
    this.ctx.emitEvent({
      type: 'turn.completed',
      threadId: this.state.activeThreadId!,
      turnId,
      status: msg.status === 'error' ? 'failed' : 'completed',
      durationMs,
    });

    if (msg.result) {
      this.ctx.emitEvent({
        type: 'content.delta',
        threadId: this.state.activeThreadId!,
        turnId,
        payload: {
          streamKind: 'assistant_text',
          delta: msg.result,
        },
      });
    }

    this.pendingTasks.delete(turnId);
    pending.resolve(msg);
  }

  private attemptReconnect(): void {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      this.ctx.log.error('Max reconnect attempts reached');
      this.updateState({ status: 'error', lastError: 'Connection lost' });
      return;
    }

    this.reconnectAttempts++;
    const delay = Math.min(1000 * Math.pow(2, this.reconnectAttempts), 30000);
    
    this.ctx.log.info(`Reconnecting in ${delay}ms (attempt ${this.reconnectAttempts})...`);
    
    setTimeout(() => {
      this.connect().catch((error) => {
        this.ctx.log.error('Reconnect failed:', error);
      });
    }, delay);
  }
}

export function createOpenClawAdapter(config: AdapterConfig): OpenClawAdapter {
  return new OpenClawAdapter(config as OpenClawConfig);
}
