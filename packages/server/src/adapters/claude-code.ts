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
    /** Model to use (e.g., 'sonnet', 'opus', 'haiku') */
    model?: string;
    /** Permission mode */
    permissionMode?: PermissionMode;
    /** Per-turn timeout in ms */
    turnTimeoutMs?: number;
  };
}

/** Task-specific options for optimization */
export interface TaskOptions {
  /** Task type - affects default optimization settings */
  taskType?: 'planning' | 'execution' | 'research';
  /** Effort level: 'low' (fastest), 'medium', 'high' (default), 'max' */
  effort?: 'low' | 'medium' | 'high' | 'max';
  /** Thinking mode */
  thinking?: { type: 'adaptive' } | { type: 'enabled'; budgetTokens?: number } | { type: 'disabled' };
  /** Max turns (1 = single response, no agentic loops) */
  maxTurns?: number;
  /** Override model for this task */
  model?: string;
}

/** Default options per task type */
const TASK_DEFAULTS: Record<string, Partial<TaskOptions>> = {
  planning: {
    effort: 'low',
    thinking: { type: 'disabled' },
    maxTurns: 1,
  },
  execution: {
    effort: 'high',
    thinking: { type: 'adaptive' },
    // No maxTurns limit - let it work
  },
  research: {
    effort: 'medium',
    thinking: { type: 'adaptive' },
    maxTurns: 5,
  },
};

interface QueuedMessage {
  message: string;
  resolve: (result: string) => void;
  reject: (error: Error) => void;
  turnId: string;
  taskOptions?: TaskOptions;
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

  async send(options: SendOptions & { taskOptions?: TaskOptions }): Promise<{ turnId: string }> {
    if (this.state.status !== 'ready' && this.state.status !== 'running') {
      throw new Error(`Not ready - current status: ${this.state.status}`);
    }

    const turnId = crypto.randomUUID();
    
    // Build the full message
    let message = options.message;
    if (options.context) {
      message = `Context:\n${options.context}\n\nTask:\n${message}`;
    }

    // Merge task options with defaults
    const taskType = options.taskOptions?.taskType ?? 'execution';
    const defaults = TASK_DEFAULTS[taskType] ?? {};
    const taskOptions: TaskOptions = {
      ...defaults,
      ...options.taskOptions,
    };

    // Create a promise that will resolve when this turn completes
    const turnPromise = new Promise<string>((resolve, reject) => {
      const queuedMessage: QueuedMessage = { 
        message, 
        resolve, 
        reject, 
        turnId,
        taskOptions,
      };
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
      const taskOpts = queuedMessage.taskOptions ?? {};
      this.ctx.log.info(`Starting Claude Code query (${queuedMessage.message.length} chars, type=${taskOpts.taskType ?? 'execution'}, effort=${taskOpts.effort ?? 'default'})`);

      // Build SDK options with task-specific optimizations
      const sdkOptions: Options = {
        cwd: this.config.cwd ?? process.cwd(),
        permissionMode: this.config.options?.permissionMode ?? 'bypassPermissions',
      };

      // Model: task override > config override > default
      const model = taskOpts.model ?? this.config.options?.model;
      if (model) {
        sdkOptions.model = model;
      }

      // Effort level for speed optimization
      if (taskOpts.effort) {
        sdkOptions.effort = taskOpts.effort;
      }

      // Thinking mode
      if (taskOpts.thinking) {
        sdkOptions.thinking = taskOpts.thinking;
      }

      // Max turns (1 = single response)
      if (taskOpts.maxTurns) {
        sdkOptions.maxTurns = taskOpts.maxTurns;
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

    // Log ALL SDK events for debugging
    this.ctx.log.info(`[SDK] ${event.type}${(event as any).subtype ? `:${(event as any).subtype}` : ''}`);

    switch (event.type) {
      case 'assistant': {
        // Full assistant message - emit activity for visibility
        this.ctx.emitEvent({
          type: 'activity',
          threadId: this.state.activeThreadId!,
          turnId,
          payload: {
            activityType: 'info',
            label: 'Processing response...',
          },
        });
        
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
        const streamEvent = event.event as any;
        const streamType = streamEvent?.type;
        this.ctx.log.info(`[SDK] stream_event/${streamType}`);
        
        if (streamType === 'content_block_delta') {
          const delta = streamEvent.delta;
          const deltaType = delta?.type;
          this.ctx.log.info(`[SDK] delta type: ${deltaType}`);
          
          if (deltaType === 'text_delta' && delta.text) {
            this.outputBuffer += delta.text;
            
            // Emit content delta
            this.ctx.emitEvent({
              type: 'content.delta',
              threadId: this.state.activeThreadId!,
              turnId,
              payload: {
                streamKind: 'assistant_text',
                delta: delta.text,
              },
            });
          } else if (deltaType === 'thinking_delta' && delta.thinking) {
            // Emit thinking activity
            this.ctx.emitEvent({
              type: 'activity',
              threadId: this.state.activeThreadId!,
              turnId,
              payload: {
                activityType: 'thinking',
                label: 'Thinking...',
                detail: delta.thinking.slice(0, 100),
              },
            });

            this.ctx.emitEvent({
              type: 'content.delta',
              threadId: this.state.activeThreadId!,
              turnId,
              payload: {
                streamKind: 'reasoning',
                delta: delta.thinking,
              },
            });
          } else if (deltaType === 'input_json_delta') {
            // Tool input streaming - show as activity
            this.ctx.emitEvent({
              type: 'activity',
              threadId: this.state.activeThreadId!,
              turnId,
              payload: {
                activityType: 'tool_started',
                label: 'Building tool input...',
                status: 'running',
              },
            });
          }
        } else if (streamType === 'content_block_start') {
          const block = streamEvent.content_block;
          const blockType = block?.type;
          this.ctx.log.info(`[SDK] content_block_start: ${blockType} - ${block?.name || 'no name'}`);

          if (blockType === 'tool_use' || blockType === 'server_tool_use') {
            const toolType = this.classifyTool(block.name);
            const activityType = toolType === 'file_read' ? 'file_read' :
                                 toolType === 'file_change' ? 'file_write' :
                                 toolType === 'command_execution' ? 'command' : 'tool_started';
            const detail = this.summarizeToolInput(block.name, block.input);
            
            this.ctx.emitEvent({
              type: 'activity',
              threadId: this.state.activeThreadId!,
              turnId,
              payload: {
                activityType,
                label: this.toolLabel(block.name),
                detail,
                status: 'running',
              },
            });
            
            this.ctx.emitEvent({
              type: 'item.started',
              threadId: this.state.activeThreadId!,
              turnId,
              payload: {
                itemId: block.id,
                itemType: toolType,
                title: block.name,
                detail,
              },
            });
          } else if (blockType === 'thinking') {
            this.ctx.emitEvent({
              type: 'activity',
              threadId: this.state.activeThreadId!,
              turnId,
              payload: {
                activityType: 'thinking',
                label: 'Thinking...',
                status: 'running',
              },
            });
          } else if (blockType === 'text') {
            this.ctx.emitEvent({
              type: 'activity',
              threadId: this.state.activeThreadId!,
              turnId,
              payload: {
                activityType: 'info',
                label: 'Writing response...',
              },
            });
          }
        } else if (streamType === 'content_block_stop') {
          this.ctx.emitEvent({
            type: 'activity',
            threadId: this.state.activeThreadId!,
            turnId,
            payload: {
              activityType: 'info',
              label: 'Block completed',
              status: 'completed',
            },
          });
          
          this.ctx.emitEvent({
            type: 'activity',
            threadId: this.state.activeThreadId!,
            turnId,
            payload: {
              activityType: 'tool_completed',
              label: 'Tool completed',
              status: 'completed',
            },
          });
          
          this.ctx.emitEvent({
            type: 'item.completed',
            threadId: this.state.activeThreadId!,
            turnId,
            payload: {
              itemType: 'tool_call',
              status: 'completed',
            },
          });
        } else if (streamType === 'message_start') {
          this.ctx.emitEvent({
            type: 'activity',
            threadId: this.state.activeThreadId!,
            turnId,
            payload: {
              activityType: 'info',
              label: 'Starting response...',
            },
          });
        } else if (streamType === 'message_stop') {
          this.ctx.emitEvent({
            type: 'activity',
            threadId: this.state.activeThreadId!,
            turnId,
            payload: {
              activityType: 'info',
              label: 'Response complete',
              status: 'completed',
            },
          });
        }
        break;
      }

      case 'result': {
        const result = event as any;

        // Emit usage/cost as activity
        if (result.usage || typeof result.total_cost_usd === 'number') {
          const parts = [];
          if (result.usage) {
            parts.push(`${result.usage.input_tokens} in / ${result.usage.output_tokens} out`);
          }
          if (typeof result.total_cost_usd === 'number') {
            parts.push(`$${result.total_cost_usd.toFixed(4)}`);
          }

          this.ctx.emitEvent({
            type: 'activity',
            threadId: this.state.activeThreadId!,
            turnId,
            payload: {
              activityType: 'info',
              label: 'Completed',
              detail: parts.join(' • '),
            },
          });

          this.ctx.log.info(`Usage: ${parts.join(' • ')}`);
        }
        break;
      }

      case 'system': {
        const sysEvent = event as any;
        if (sysEvent.subtype === 'status') {
          this.ctx.emitEvent({
            type: 'activity',
            threadId: this.state.activeThreadId!,
            turnId,
            payload: {
              activityType: 'info',
              label: `Status: ${sysEvent.status}`,
            },
          });
          this.ctx.log.info(`Claude Code status: ${sysEvent.status}`);
        }
        break;
      }

      case 'tool_progress': {
        const toolEvent = event as any;
        this.ctx.emitEvent({
          type: 'activity',
          threadId: this.state.activeThreadId!,
          turnId,
          payload: {
            activityType: 'tool_started',
            label: toolEvent.tool_name || 'Tool',
            detail: `${toolEvent.elapsed_time_seconds}s elapsed`,
            status: 'running',
          },
        });
        this.ctx.log.info(`Tool progress: ${toolEvent.tool_name} (${toolEvent.elapsed_time_seconds}s)`);
        break;
      }

      default: {
        // Still log but don't emit activity for unknown types
        this.ctx.log.info(`[SDK] Unhandled: ${event.type}`);
      }
    }
  }
  
  private toolLabel(toolName: string): string {
    const name = toolName.toLowerCase();
    if (name.includes('read')) return 'Reading file';
    if (name.includes('edit') || name.includes('write')) return 'Editing file';
    if (name.includes('bash') || name.includes('command')) return 'Running command';
    if (name.includes('glob') || name.includes('find')) return 'Searching files';
    if (name.includes('grep')) return 'Searching content';
    return toolName;
  }
  
  private summarizeToolInput(toolName: string, input: any): string {
    if (!input || typeof input !== 'object') return '';
    
    // File operations
    if (input.path) return input.path;
    if (input.file_path) return input.file_path;
    
    // Commands
    if (input.command) {
      const cmd = String(input.command);
      return cmd.length > 60 ? cmd.slice(0, 57) + '...' : cmd;
    }
    
    // Search patterns
    if (input.pattern) return input.pattern;
    if (input.query) return input.query;
    
    return '';
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
