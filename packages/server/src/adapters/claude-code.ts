/**
 * Claude Code Adapter
 * 
 * Uses the official @anthropic-ai/claude-agent-sdk for proper
 * programmatic control of Claude Code.
 */

import { query, type Query, type SDKMessage, type Options, type PermissionMode } from '@anthropic-ai/claude-agent-sdk';
import type { 
  AdapterConfig, 
  AdapterState, 
  AdapterCapabilities,
  SendOptions,
} from '@acc/contracts';
import type { AdapterContext, AdapterImplementation } from './types';

interface ClaudeCodeConfig extends AdapterConfig {
  cwd?: string;
  options?: {
    /** Path to claude binary (default: 'claude') */
    binaryPath?: string;
    /** Model to use */
    model?: string;
    /** Permission mode */
    permissionMode?: PermissionMode;
    /** Per-turn timeout in ms */
    turnTimeoutMs?: number;
  };
}

interface QueuedMessage {
  message: string;
  resolve: (result: string) => void;
  reject: (error: Error) => void;
  turnId: string;
}

export class ClaudeCodeAdapter implements AdapterImplementation {
  private ctx!: AdapterContext;
  private config: ClaudeCodeConfig;
  private queryInstance: Query | null = null;
  private state: AdapterState = {
    status: 'disconnected',
  };
  private messageQueue: QueuedMessage[] = [];
  private currentTurn: QueuedMessage | null = null;
  private outputBuffer = '';
  private turnStartTime = 0;

  constructor(config: ClaudeCodeConfig) {
    this.config = config;
  }

  async init(ctx: AdapterContext): Promise<void> {
    this.ctx = ctx;
    this.ctx.log.info('Claude Code adapter initialized (using official SDK)');
  }

  getCapabilities(): AdapterCapabilities {
    return {
      streaming: true,
      interruptible: true,
      concurrent: false,
      fileWatch: true,
      approvals: true,
    };
  }

  getState(): AdapterState {
    return { ...this.state };
  }

  async connect(): Promise<void> {
    if (this.state.status !== 'disconnected') {
      throw new Error('Already connected or connecting');
    }

    this.updateState({ status: 'connecting' });
    this.ctx.log.info('Connecting to Claude Code via SDK...');

    try {
      // Verify claude binary exists
      const { execSync } = await import('child_process');
      const binaryPath = this.config.options?.binaryPath ?? 'claude';
      try {
        execSync(`which ${binaryPath}`, { encoding: 'utf-8' });
      } catch {
        throw new Error(`Claude Code binary not found: ${binaryPath}`);
      }

      const threadId = crypto.randomUUID();
      this.updateState({ 
        status: 'ready',
        activeThreadId: threadId,
      });

      this.ctx.emitEvent({
        type: 'session.started',
        threadId,
      });

      this.ctx.log.info('Claude Code adapter ready');

    } catch (error) {
      this.updateState({ 
        status: 'error', 
        lastError: error instanceof Error ? error.message : 'Connection failed' 
      });
      throw error;
    }
  }

  async disconnect(): Promise<void> {
    if (this.queryInstance) {
      try {
        // Close the query gracefully
        await this.queryInstance.return(undefined);
      } catch {
        // Ignore errors during disconnect
      }
      this.queryInstance = null;
    }
    this.currentTurn = null;
    this.messageQueue = [];
    this.updateState({ status: 'disconnected' });
    this.ctx.log.info('Claude Code disconnected');
  }

  async send(options: SendOptions): Promise<{ turnId: string }> {
    if (this.state.status !== 'ready' && this.state.status !== 'running') {
      throw new Error(`Not ready - current status: ${this.state.status}`);
    }

    const turnId = crypto.randomUUID();
    
    // Build the full message
    let message = options.message;
    if (options.context) {
      message = `Context:\n${options.context}\n\nTask:\n${message}`;
    }

    // Create a promise that will resolve when this turn completes
    const turnPromise = new Promise<string>((resolve, reject) => {
      const queuedMessage: QueuedMessage = { message, resolve, reject, turnId };
      this.messageQueue.push(queuedMessage);
    });

    // Start processing if not already running
    if (!this.currentTurn) {
      this.processNextMessage();
    }

    // Don't await the promise - return immediately with turnId
    // The result will come via events
    turnPromise.then((result) => {
      this.ctx.emitEvent({
        type: 'turn.completed',
        threadId: this.state.activeThreadId!,
        turnId,
        status: 'completed',
        durationMs: Date.now() - this.turnStartTime,
        payload: { result },
      });
    }).catch((error) => {
      this.ctx.emitEvent({
        type: 'turn.completed',
        threadId: this.state.activeThreadId!,
        turnId,
        status: 'failed',
        reason: error.message,
        durationMs: Date.now() - this.turnStartTime,
      });
    });

    this.ctx.emitEvent({
      type: 'turn.started',
      threadId: this.state.activeThreadId!,
      turnId,
    });

    return { turnId };
  }

  private async processNextMessage(): Promise<void> {
    if (this.messageQueue.length === 0) {
      this.currentTurn = null;
      this.updateState({ status: 'ready', activeTurnId: undefined });
      return;
    }

    const queuedMessage = this.messageQueue.shift()!;
    this.currentTurn = queuedMessage;
    this.outputBuffer = '';
    this.turnStartTime = Date.now();
    this.updateState({ status: 'running', activeTurnId: queuedMessage.turnId });

    try {
      this.ctx.log.info(`Starting Claude Code query (${queuedMessage.message.length} chars)`);

      // Build SDK options
      const sdkOptions: Options = {
        cwd: this.config.cwd ?? process.cwd(),
        permissionMode: this.config.options?.permissionMode ?? 'bypassPermissions',
      };

      if (this.config.options?.model) {
        sdkOptions.model = this.config.options.model;
      }

      // Create query with the message
      this.queryInstance = query({
        prompt: queuedMessage.message,
        options: sdkOptions,
      });

      // Process the stream
      for await (const event of this.queryInstance) {
        this.handleSDKMessage(event);
      }

      // Query completed successfully
      this.ctx.log.info(`Claude Code query completed (${Date.now() - this.turnStartTime}ms)`);
      queuedMessage.resolve(this.outputBuffer);

    } catch (error) {
      this.ctx.log.error(`Claude Code query failed: ${error}`);
      queuedMessage.reject(error instanceof Error ? error : new Error(String(error)));
    } finally {
      this.queryInstance = null;
      this.currentTurn = null;
      // Process next message if any
      this.processNextMessage();
    }
  }

  private handleSDKMessage(event: SDKMessage): void {
    const turnId = this.currentTurn?.turnId;
    if (!turnId) return;

    switch (event.type) {
      case 'assistant': {
        // Full assistant message
        const content = (event.message as any)?.content;
        if (Array.isArray(content)) {
          for (const block of content) {
            if (block?.type === 'text' && typeof block.text === 'string') {
              this.outputBuffer += block.text;
              this.ctx.emitEvent({
                type: 'content.delta',
                threadId: this.state.activeThreadId!,
                turnId,
                payload: {
                  streamKind: 'assistant_text',
                  delta: block.text,
                },
              });
            }
          }
        }
        break;
      }

      case 'stream_event': {
        // Streaming delta
        const streamEvent = event.event as any;
        if (streamEvent?.type === 'content_block_delta') {
          const delta = streamEvent.delta;
          if (delta?.type === 'text_delta' && delta.text) {
            this.outputBuffer += delta.text;
            this.ctx.emitEvent({
              type: 'content.delta',
              threadId: this.state.activeThreadId!,
              turnId,
              payload: {
                streamKind: delta.type.includes('thinking') ? 'reasoning' : 'assistant_text',
                delta: delta.text,
              },
            });
          }
        } else if (streamEvent?.type === 'content_block_start') {
          // Tool use started
          const block = streamEvent.content_block;
          if (block?.type === 'tool_use' || block?.type === 'server_tool_use') {
            this.ctx.emitEvent({
              type: 'item.started',
              threadId: this.state.activeThreadId!,
              turnId,
              payload: {
                itemId: block.id,
                itemType: this.classifyTool(block.name),
                title: block.name,
              },
            });
          }
        } else if (streamEvent?.type === 'content_block_stop') {
          // Tool use completed
          this.ctx.emitEvent({
            type: 'item.completed',
            threadId: this.state.activeThreadId!,
            turnId,
            payload: {
              itemType: 'tool_call',
              status: 'completed',
            },
          });
        }
        break;
      }

      case 'result': {
        // Query result with usage info
        const result = event as any;
        if (result.usage) {
          this.ctx.log.info(`Usage: input=${result.usage.input_tokens}, output=${result.usage.output_tokens}`);
        }
        if (typeof result.total_cost_usd === 'number') {
          this.ctx.log.info(`Cost: $${result.total_cost_usd.toFixed(4)}`);
        }
        break;
      }

      case 'system': {
        // System messages (status updates, etc)
        const sysEvent = event as any;
        if (sysEvent.subtype === 'status') {
          this.ctx.log.info(`Claude Code status: ${sysEvent.status}`);
        }
        break;
      }

      case 'tool_progress': {
        // Tool execution progress
        const toolEvent = event as any;
        this.ctx.log.info(`Tool progress: ${toolEvent.tool_name} (${toolEvent.elapsed_time_seconds}s)`);
        break;
      }

      default: {
        // Log unhandled event types for debugging
        this.ctx.log.info(`SDK event: ${event.type}`);
      }
    }
  }

  private classifyTool(toolName: string): string {
    const name = toolName.toLowerCase();
    if (name.includes('bash') || name.includes('command') || name.includes('shell')) {
      return 'command_execution';
    }
    if (name.includes('edit') || name.includes('write') || name.includes('file')) {
      return 'file_change';
    }
    if (name.includes('read') || name.includes('view')) {
      return 'file_read';
    }
    return 'tool_call';
  }

  async interrupt(): Promise<void> {
    if (!this.queryInstance) return;
    
    try {
      await this.queryInstance.interrupt();
      this.ctx.log.info('Claude Code interrupted');
    } catch (error) {
      this.ctx.log.warn(`Interrupt failed: ${error}`);
    }
    
    if (this.currentTurn) {
      this.ctx.emitEvent({
        type: 'turn.completed',
        threadId: this.state.activeThreadId!,
        turnId: this.currentTurn.turnId,
        status: 'interrupted',
        durationMs: Date.now() - this.turnStartTime,
      });
      this.currentTurn.reject(new Error('Interrupted'));
      this.currentTurn = null;
    }
    
    this.updateState({ status: 'ready', activeTurnId: undefined });
  }

  async destroy(): Promise<void> {
    await this.disconnect();
  }

  private updateState(partial: Partial<AdapterState>): void {
    this.state = { ...this.state, ...partial };
    this.ctx.emitEvent({
      type: 'session.state.changed',
      threadId: this.state.activeThreadId,
      payload: { state: this.state.status },
    });
  }
}

export function createClaudeCodeAdapter(config: AdapterConfig): ClaudeCodeAdapter {
  return new ClaudeCodeAdapter(config as ClaudeCodeConfig);
}
