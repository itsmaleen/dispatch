/**
 * ACC Channel Plugin for OpenClaw
 * 
 * Connects OpenClaw instances to Dispatch for orchestration.
 * Bidirectional WebSocket communication for tasks and streaming responses.
 */

import WebSocket from 'ws';

export interface ACCChannelConfig {
  /** ACC server URL (e.g., ws://localhost:3333) */
  serverUrl: string;
  /** Authentication token */
  token: string;
  /** Agent name/identifier */
  agentName?: string;
  /** Reconnect on disconnect */
  autoReconnect?: boolean;
  /** Reconnect interval in ms */
  reconnectInterval?: number;
}

export interface ACCMessage {
  type: string;
  taskId?: string;
  message?: string;
  content?: string;
  status?: string;
  error?: string;
  metadata?: Record<string, unknown>;
}

interface ChannelContext {
  config: ACCChannelConfig;
  log: {
    info: (msg: string, ...args: unknown[]) => void;
    warn: (msg: string, ...args: unknown[]) => void;
    error: (msg: string, ...args: unknown[]) => void;
  };
  /** Send a message to an agent session */
  sendToSession: (sessionKey: string, message: string) => Promise<void>;
  /** Spawn an isolated session */
  spawnSession: (task: string, options?: {
    label?: string;
    model?: string;
    timeoutSeconds?: number;
  }) => Promise<{ sessionKey: string; runId: string }>;
}

export class ACCChannel {
  private ws: WebSocket | null = null;
  private ctx: ChannelContext;
  private config: ACCChannelConfig;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private activeTasks = new Map<string, { sessionKey: string; startedAt: Date }>();

  constructor(ctx: ChannelContext) {
    this.ctx = ctx;
    this.config = ctx.config;
  }

  async connect(): Promise<void> {
    const wsUrl = this.config.serverUrl.replace(/^http/, 'ws') + '/channel';
    
    this.ctx.log.info(`Connecting to ACC server at ${wsUrl}...`);

    return new Promise((resolve, reject) => {
      this.ws = new WebSocket(wsUrl, {
        headers: {
          'Authorization': `Bearer ${this.config.token}`,
          'X-Agent-Name': this.config.agentName ?? 'unnamed',
        },
      });

      this.ws.on('open', () => {
        this.ctx.log.info('Connected to ACC server');
        this.sendRegistration();
        resolve();
      });

      this.ws.on('message', (data) => {
        this.handleMessage(data.toString());
      });

      this.ws.on('close', () => {
        this.ctx.log.warn('Disconnected from ACC server');
        if (this.config.autoReconnect !== false) {
          this.scheduleReconnect();
        }
      });

      this.ws.on('error', (error) => {
        this.ctx.log.error('ACC WebSocket error:', error.message);
        reject(error);
      });
    });
  }

  async disconnect(): Promise<void> {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }

  /** Send streaming content delta to ACC */
  sendContentDelta(taskId: string, delta: string): void {
    this.send({
      type: 'content.delta',
      taskId,
      content: delta,
    });
  }

  /** Send task completion to ACC */
  sendTaskCompleted(taskId: string, result: string, status: 'completed' | 'failed' = 'completed'): void {
    const task = this.activeTasks.get(taskId);
    const durationMs = task ? Date.now() - task.startedAt.getTime() : 0;
    
    this.send({
      type: 'task.completed',
      taskId,
      content: result,
      status,
      metadata: { durationMs },
    });
    
    this.activeTasks.delete(taskId);
  }

  /** Send error to ACC */
  sendError(taskId: string, error: string): void {
    this.send({
      type: 'task.error',
      taskId,
      error,
      status: 'failed',
    });
    this.activeTasks.delete(taskId);
  }

  // ============ Private Methods ============

  private send(msg: ACCMessage): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(msg));
    }
  }

  private sendRegistration(): void {
    this.send({
      type: 'register',
      metadata: {
        agentName: this.config.agentName,
        capabilities: ['streaming', 'spawn'],
        version: '0.1.0',
      },
    });
  }

  private async handleMessage(data: string): Promise<void> {
    try {
      const msg = JSON.parse(data) as ACCMessage;
      
      switch (msg.type) {
        case 'task.send':
          await this.handleTaskSend(msg);
          break;
        
        case 'task.cancel':
          await this.handleTaskCancel(msg);
          break;
        
        case 'ping':
          this.send({ type: 'pong' });
          break;
        
        default:
          this.ctx.log.warn(`Unknown message type: ${msg.type}`);
      }
    } catch (error) {
      this.ctx.log.error('Failed to handle message:', error);
    }
  }

  private async handleTaskSend(msg: ACCMessage): Promise<void> {
    const { taskId, message } = msg;
    if (!taskId || !message) {
      this.sendError(taskId ?? 'unknown', 'Missing taskId or message');
      return;
    }

    this.ctx.log.info(`Received task ${taskId}: ${message.slice(0, 50)}...`);
    
    // Track the task
    const startedAt = new Date();
    
    // Send acknowledgment
    this.send({
      type: 'task.started',
      taskId,
      metadata: { startedAt: startedAt.toISOString() },
    });

    try {
      // Spawn an isolated session for the task
      const { sessionKey } = await this.ctx.spawnSession(message, {
        label: `acc-${taskId.slice(0, 8)}`,
        timeoutSeconds: 300,
      });

      this.activeTasks.set(taskId, { sessionKey, startedAt });

      // Note: The actual result comes from the session completion
      // We'll need to hook into session events to send results back
      // For now, the spawn promise resolving means the task is queued

    } catch (error) {
      this.sendError(taskId, error instanceof Error ? error.message : 'Task failed');
    }
  }

  private async handleTaskCancel(msg: ACCMessage): Promise<void> {
    const { taskId } = msg;
    if (!taskId) return;

    const task = this.activeTasks.get(taskId);
    if (task) {
      // TODO: Implement session cancellation
      this.ctx.log.info(`Cancelling task ${taskId}`);
      this.activeTasks.delete(taskId);
      this.send({
        type: 'task.cancelled',
        taskId,
      });
    }
  }

  private scheduleReconnect(): void {
    const interval = this.config.reconnectInterval ?? 5000;
    this.ctx.log.info(`Reconnecting in ${interval}ms...`);
    
    this.reconnectTimer = setTimeout(() => {
      this.connect().catch((error) => {
        this.ctx.log.error('Reconnect failed:', error);
        this.scheduleReconnect();
      });
    }, interval);
  }
}

/**
 * Channel plugin factory for OpenClaw
 */
export function createChannel(ctx: ChannelContext): ACCChannel {
  return new ACCChannel(ctx);
}

export default { createChannel };
