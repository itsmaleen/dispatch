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
  /** Effort level: 'low' (fastest), 'medium', 'high' (default), 'max' */
  effort?: 'low' | 'medium' | 'high' | 'max';
  /** Thinking mode */
  thinking?: { type: 'adaptive' } | { type: 'enabled'; budgetTokens?: number } | { type: 'disabled' };
  /** Max turns (1 = single response, no agentic loops) */
  maxTurns?: number;
  /** Override model for this task */
  model?: string;
}

interface QueuedMessage {
  message: string;
  cwd?: string;
  resolve: (result: string) => void;
  reject: (error: Error) => void;
  turnId: string;
  taskOptions?: TaskOptions;
}

/** Tracks an active content block during streaming */
interface ActiveBlock {
  id: string;
  index: number;           // Stream index for lookup during deltas
  type: 'tool_use' | 'server_tool_use' | 'thinking' | 'text';
  name?: string;           // Tool name (e.g., "Read", "Bash")
  activityType: string;    // Our activity type (file_read, command, etc.)
  label: string;           // Human-readable label
  inputJson: string;       // Accumulated JSON input
  detail?: string;         // Extracted detail (file path, command)
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
  private activeBlocks: Map<string, ActiveBlock> = new Map();

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
    
    // Phase 1: Log incoming cwd from SendOptions
    this.ctx.log.info(`[send] Received cwd in options: ${options.cwd ?? '(not provided)'}`);
    this.ctx.log.info(`[send] Message preview: ${options.message.slice(0, 80)}...`);
    
    // Build the full message
    let message = options.message;
    if (options.context) {
      message = `Context:\n${options.context}\n\nTask:\n${message}`;
    }

    // Task options (classification is now handled by separate classifier service)
    const taskOptions: TaskOptions = options.taskOptions ?? {};

    // Create a promise that will resolve when this turn completes
    const turnPromise = new Promise<string>((resolve, reject) => {
      const queuedMessage: QueuedMessage = { 
        message,
        cwd: options.cwd,
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
      this.ctx.log.info(`Starting Claude Code query (${queuedMessage.message.length} chars, effort=${taskOpts.effort ?? 'default'}, model=${taskOpts.model ?? 'default'})`);

      // Build SDK options with task-specific optimizations
      // cwd priority: message option > config > process.cwd()
      const effectiveCwd = queuedMessage.cwd ?? this.config.cwd ?? process.cwd();
      
      // Phase 1: Detailed CWD tracing
      this.ctx.log.info(`┌─ CWD TRACE ─────────────────────────────────`);
      this.ctx.log.info(`│ queuedMessage.cwd: ${queuedMessage.cwd ?? '(not set)'}`);
      this.ctx.log.info(`│ this.config.cwd:   ${this.config.cwd ?? '(not set)'}`);
      this.ctx.log.info(`│ process.cwd():     ${process.cwd()}`);
      this.ctx.log.info(`│ → effectiveCwd:    ${effectiveCwd}`);
      this.ctx.log.info(`│ source: ${queuedMessage.cwd ? 'message' : this.config.cwd ? 'config' : 'process.cwd()'}`);
      this.ctx.log.info(`└─────────────────────────────────────────────`);
      
      const sdkOptions: Options = {
        cwd: effectiveCwd,
        permissionMode: this.config.options?.permissionMode ?? 'bypassPermissions',
        includePartialMessages: true, // Enable streaming events for activity tracking
      };
      
      // Log what we're passing to SDK
      this.ctx.log.info(`SDK options.cwd = "${sdkOptions.cwd}"`);

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
      // The SDK may throw on process exit even if result was success
      // Check if we got output before failing
      if (this.outputBuffer.length > 0) {
        this.ctx.log.info(`Claude Code query ended with error but has output (${this.outputBuffer.length} chars), treating as success`);
        queuedMessage.resolve(this.outputBuffer);
      } else {
        this.ctx.log.error(`Claude Code query failed: ${error}`);
        queuedMessage.reject(error instanceof Error ? error : new Error(String(error)));
      }
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

    // Log SDK events for debugging
    this.ctx.log.info(`[SDK] ${event.type}${(event as any).subtype ? `:${(event as any).subtype}` : ''}`);

    switch (event.type) {
      case 'assistant': {
        // Full assistant message - may come without streaming for fast tasks
        this.ctx.log.info(`[SDK] assistant message received, content count: ${(event.message as any)?.content?.length ?? 0}`);
        const content = (event.message as any)?.content;
        if (Array.isArray(content)) {
          for (const block of content) {
            this.ctx.log.info(`[SDK] content block: ${block?.type}, text: "${block?.text?.slice(0, 100)}..."`);
            if (block?.type === 'text' && typeof block.text === 'string') {
              // Only emit if not already streamed (check if text is new)
              if (!this.outputBuffer.includes(block.text)) {
                this.outputBuffer += block.text;
                
                // Emit content.delta so waitForAdapterResult picks it up
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
        }
        break;
      }

      case 'stream_event': {
        this.handleStreamEvent(event.event as any, turnId);
        break;
      }

      case 'result': {
        const result = event as any;
        // Clear active blocks on completion
        this.activeBlocks.clear();

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
              status: 'completed',
            },
          });

          this.ctx.log.info(`Usage: ${parts.join(' • ')}`);
        }
        break;
      }

      case 'system': {
        const sysEvent = event as any;
        if (sysEvent.subtype === 'status') {
          this.ctx.log.info(`Claude Code status: ${sysEvent.status}`);
        }
        break;
      }

      case 'tool_progress': {
        const toolEvent = event as any;
        const toolUseId = toolEvent.tool_use_id;

        // Use activity.update if we have a tool_use_id, otherwise emit new activity
        if (toolUseId) {
          this.ctx.emitEvent({
            type: 'activity.update',
            threadId: this.state.activeThreadId!,
            turnId,
            payload: {
              itemId: toolUseId,
              detail: `${toolEvent.elapsed_time_seconds}s elapsed`,
              status: 'running',
            },
          });
        } else {
          this.ctx.emitEvent({
            type: 'activity',
            threadId: this.state.activeThreadId!,
            turnId,
            payload: {
              activityType: 'tool',
              label: toolEvent.tool_name || 'Tool running',
              detail: `${toolEvent.elapsed_time_seconds}s elapsed`,
              status: 'running',
            },
          });
        }
        break;
      }

      case 'tool_use_summary': {
        // Tool completion with summary text - don't create new activity
        // The tool completion is already handled by content_block_stop
        // Just log it for debugging
        const summaryEvent = event as any;
        this.ctx.log.info(`[SDK] tool_use_summary: ${summaryEvent.summary}`);
        break;
      }

      case 'user': {
        // User messages (tool results, etc.) - just log, don't emit activity
        this.ctx.log.info(`[SDK] user message (tool result or input)`);
        break;
      }

      default: {
        this.ctx.log.info(`[SDK] Unhandled: ${event.type}`);
      }
    }
  }

  /** Handle stream_event from the SDK */
  private handleStreamEvent(streamEvent: any, turnId: string): void {
    const streamType = streamEvent?.type;
    const blockIndex = streamEvent?.index;
    
    switch (streamType) {
      case 'content_block_start': {
        const block = streamEvent.content_block;
        const blockType = block?.type;
        const blockId = block?.id || `block_${blockIndex}`;
        
        this.ctx.log.info(`[SDK] content_block_start: ${blockType} (${block?.name || 'no name'}) id=${blockId}`);

        if (blockType === 'tool_use' || blockType === 'server_tool_use') {
          const toolName = block.name || 'Tool';
          const toolType = this.classifyTool(toolName);
          const activityType = this.toolToActivityType(toolType);
          const label = this.toolLabel(toolName);
          
          // Track this block
          this.activeBlocks.set(blockId, {
            id: blockId,
            index: blockIndex,
            type: blockType,
            name: toolName,
            activityType,
            label,
            inputJson: '',
            detail: undefined,
          });

          // Emit activity with status: running (includes itemId for tracking)
          this.ctx.emitEvent({
            type: 'activity',
            threadId: this.state.activeThreadId!,
            turnId,
            payload: {
              itemId: blockId,
              activityType,
              label,
              status: 'running',
            },
          });
          
        } else if (blockType === 'thinking') {
          const blockId = `thinking_${blockIndex}`;
          this.activeBlocks.set(blockId, {
            id: blockId,
            index: blockIndex,
            type: 'thinking',
            activityType: 'thinking',
            label: 'Thinking...',
            inputJson: '',
          });

          this.ctx.emitEvent({
            type: 'activity',
            threadId: this.state.activeThreadId!,
            turnId,
            payload: {
              itemId: blockId,
              activityType: 'thinking',
              label: 'Thinking...',
              status: 'running',
            },
          });
          
        } else if (blockType === 'text') {
          // Don't emit activity for text blocks - they're just the response
          const blockId = `text_${blockIndex}`;
          this.activeBlocks.set(blockId, {
            id: blockId,
            index: blockIndex,
            type: 'text',
            activityType: 'info',
            label: 'Writing response...',
            inputJson: '',
          });
        }
        break;
      }

      case 'content_block_delta': {
        const delta = streamEvent.delta;
        const deltaType = delta?.type;
        const blockId = this.findBlockByIndex(blockIndex);
        
        if (deltaType === 'text_delta' && delta.text) {
          this.outputBuffer += delta.text;
          
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
          this.ctx.emitEvent({
            type: 'content.delta',
            threadId: this.state.activeThreadId!,
            turnId,
            payload: {
              streamKind: 'reasoning',
              delta: delta.thinking,
            },
          });
          
        } else if (deltaType === 'input_json_delta' && delta.partial_json) {
          // Accumulate JSON input for the tool
          if (blockId) {
            const block = this.activeBlocks.get(blockId);
            if (block) {
              block.inputJson += delta.partial_json;

              // Try to extract detail from accumulated JSON
              const detail = this.tryExtractDetail(block.inputJson);
              if (detail && detail !== block.detail) {
                block.detail = detail;
                this.ctx.log.info(`[SDK] Extracted detail for ${blockId}: ${detail}`);

                // Emit activity.update with detail (updates existing activity by itemId)
                this.ctx.emitEvent({
                  type: 'activity.update',
                  threadId: this.state.activeThreadId!,
                  turnId,
                  payload: {
                    itemId: blockId,
                    detail,
                    status: 'running',
                  },
                });
              }
            } else {
              this.ctx.log.warn(`[SDK] Block not found for delta: ${blockId} (active blocks: ${Array.from(this.activeBlocks.keys()).join(', ')})`);
            }
          } else {
            this.ctx.log.warn(`[SDK] Could not find block for index ${blockIndex}`);
          }
        }
        break;
      }

      case 'content_block_stop': {
        const blockId = this.findBlockByIndex(blockIndex);
        if (blockId) {
          const block = this.activeBlocks.get(blockId);
          if (block) {
            // Try final detail extraction
            if (!block.detail && block.inputJson) {
              block.detail = this.tryExtractDetail(block.inputJson);
            }

            // Only emit completion for tool blocks
            if (block.type === 'tool_use' || block.type === 'server_tool_use') {
              // Use activity.update to update the existing activity entry
              this.ctx.emitEvent({
                type: 'activity.update',
                threadId: this.state.activeThreadId!,
                turnId,
                payload: {
                  itemId: blockId,
                  detail: block.detail,
                  status: 'completed',
                },
              });
            } else if (block.type === 'thinking') {
              // Use activity.update to update the existing thinking activity
              this.ctx.emitEvent({
                type: 'activity.update',
                threadId: this.state.activeThreadId!,
                turnId,
                payload: {
                  itemId: blockId,
                  status: 'completed',
                },
              });
            }

            this.activeBlocks.delete(blockId);
          }
        }
        break;
      }

      case 'message_start': {
        // Don't clear blocks here - they're cleared on 'result' event
        // Clearing here can cause race conditions where delta events
        // arrive after message_start but before blocks are re-created
        this.ctx.log.info(`[SDK] message_start (${this.activeBlocks.size} active blocks)`);
        break;
      }

      case 'message_stop': {
        // Don't clear blocks here either - wait for 'result' event
        // This ensures all delta events are processed
        this.ctx.log.info(`[SDK] message_stop (${this.activeBlocks.size} active blocks)`);
        break;
      }
    }
  }

  /** Find block ID by stream index */
  private findBlockByIndex(index: number): string | undefined {
    // Look up block by its stored index
    for (const [id, block] of this.activeBlocks.entries()) {
      if (block.index === index) {
        return id;
      }
    }
    return undefined;
  }

  /** Try to extract detail (file path, command) from accumulated JSON */
  private tryExtractDetail(json: string): string | undefined {
    try {
      // Try to parse - may fail if still accumulating
      const input = JSON.parse(json);
      
      // File operations
      if (input.path) return input.path;
      if (input.file_path) return input.file_path;
      if (input.file) return input.file;
      
      // Commands
      if (input.command) {
        const cmd = String(input.command);
        return cmd.length > 60 ? cmd.slice(0, 57) + '...' : cmd;
      }
      
      // Search patterns
      if (input.pattern) return input.pattern;
      if (input.query) return input.query;
      if (input.regex) return input.regex;
      
      return undefined;
    } catch {
      // JSON not complete yet - try partial extraction
      const pathMatch = json.match(/"(?:path|file_path|file)"\s*:\s*"([^"]+)"/);
      if (pathMatch) return pathMatch[1];
      
      const cmdMatch = json.match(/"command"\s*:\s*"([^"]{1,60})/);
      if (cmdMatch) return cmdMatch[1] + (json.includes(cmdMatch[0] + '"') ? '' : '...');
      
      return undefined;
    }
  }

  /** Convert tool type to activity type */
  private toolToActivityType(toolType: string): string {
    switch (toolType) {
      case 'file_read': return 'file_read';
      case 'file_change': return 'file_write';
      case 'command_execution': return 'command';
      default: return 'tool';
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
