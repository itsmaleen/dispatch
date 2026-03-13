/**
 * Claude Code Adapter
 * 
 * Subprocess-based control of Claude Code CLI.
 * Uses child_process.spawn instead of PTY for Node 24 compatibility.
 */

import { spawn, type ChildProcess } from 'child_process';
import type { 
  AdapterConfig, 
  AdapterState, 
  AdapterCapabilities,
  SendOptions,
} from '@acc/contracts';
import type { AdapterContext, AdapterImplementation } from './types';

interface ClaudeCodeConfig extends AdapterConfig {
  options?: {
    /** Path to claude binary (default: 'claude') */
    binaryPath?: string;
    /** Model to use */
    model?: string;
    /**
     * Enable auto-accept for safe operations (--dangerously-skip-permissions).
     * Set to true for headless/non-TTY use to avoid approval prompts that can hang.
     */
    autoAccept?: boolean;
    /** Use --print mode for single-shot execution */
    printMode?: boolean;
    /** Per-turn timeout in ms; no timeout if unset. Prevents adapter staying "running" forever. */
    turnTimeoutMs?: number;
  };
}

export class ClaudeCodeAdapter implements AdapterImplementation {
  private ctx!: AdapterContext;
  private config: ClaudeCodeConfig;
  private process: ChildProcess | null = null;
  private state: AdapterState = {
    status: 'disconnected',
  };
  private outputBuffer = '';
  private currentTurnId: string | null = null;
  private turnStartTime: number = 0;
  private turnTimeoutId: ReturnType<typeof setTimeout> | null = null;
  private hasReceivedOutputThisTurn = false;

  constructor(config: ClaudeCodeConfig) {
    this.config = config;
  }

  async init(ctx: AdapterContext): Promise<void> {
    this.ctx = ctx;
    this.ctx.log.info('Claude Code adapter initialized');
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
    this.ctx.log.info('Connecting to Claude Code...');

    try {
      const binaryPath = this.config.options?.binaryPath ?? 'claude';
      
      // Verify binary exists
      const { execSync } = await import('child_process');
      try {
        execSync(`which ${binaryPath}`, { encoding: 'utf-8' });
      } catch {
        throw new Error(`Claude Code binary not found: ${binaryPath}`);
      }

      // We're ready - actual process spawns per-message in print mode
      // or as interactive session
      this.updateState({ 
        status: 'ready',
        activeThreadId: crypto.randomUUID(),
      });

      this.ctx.emitEvent({
        type: 'session.started',
        threadId: this.state.activeThreadId!,
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
    this.clearTurnTimeout();
    if (this.process) {
      this.process.kill('SIGTERM');
      this.process = null;
    }
    this.currentTurnId = null;
    this.updateState({ status: 'disconnected' });
    this.ctx.log.info('Claude Code disconnected');
  }

  async send(options: SendOptions): Promise<{ turnId: string }> {
    if (this.state.status !== 'ready') {
      const msg =
        this.state.status === 'running'
          ? 'Adapter is busy with another task - wait for it to finish'
          : this.state.status === 'disconnected'
            ? 'Not ready - call connect() first'
            : this.state.status === 'connecting'
              ? 'Still connecting - try again in a moment'
              : this.state.status === 'error'
                ? `Adapter error: ${this.state.lastError ?? 'unknown'}`
                : 'Not ready';
      throw new Error(msg);
    }

    const turnId = crypto.randomUUID();
    this.currentTurnId = turnId;
    this.turnStartTime = Date.now();
    this.outputBuffer = '';
    this.hasReceivedOutputThisTurn = false;
    this.updateState({ status: 'running', activeTurnId: turnId });

    this.ctx.emitEvent({
      type: 'turn.started',
      threadId: this.state.activeThreadId!,
      turnId,
    });

    // Build command args
    const binaryPath = this.config.options?.binaryPath ?? 'claude';
    const args: string[] = ['-p']; // --print mode for single-shot
    
    if (this.config.options?.model) {
      args.push('--model', this.config.options.model);
    }

    if (this.config.options?.autoAccept) {
      args.push('--dangerously-skip-permissions');
    }

    // Build the full message with context
    let message = options.message;
    if (options.context) {
      message = `Context:\n${options.context}\n\nTask:\n${message}`;
    }

    // NOTE: We pass message via stdin (piped), not as CLI arg
    // CLI args have length limits and escaping issues
    // claude -p reads from stdin when no message arg provided

    this.ctx.log.info(`Spawning Claude Code: ${binaryPath} ${args.join(' ')} (message via stdin, ${message.length} chars)`);

    // Spawn the process
    this.process = spawn(binaryPath, args, {
      cwd: this.config.cwd ?? process.cwd(),
      env: { ...process.env, FORCE_COLOR: '0' }, // Disable colors for cleaner parsing
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    // Write message to stdin, then close to signal EOF
    this.process.stdin?.write(message);
    this.process.stdin?.end();
    this.ctx.log.info('Claude Code process spawned, message written to stdin');

    // Stream stdout
    this.process.stdout?.on('data', (chunk: Buffer) => {
      const data = chunk.toString('utf-8');
      this.handleOutput(data);
    });

    // Stream stderr
    this.process.stderr?.on('data', (chunk: Buffer) => {
      const data = chunk.toString('utf-8');
      this.ctx.log.warn(`Claude Code stderr: ${data}`);
      // Still emit as content (some tools write to stderr)
      this.handleOutput(data);
    });

    // Per-turn timeout so we eventually complete and do not stay "running" forever
    const turnTimeoutMs = this.config.options?.turnTimeoutMs;
    if (turnTimeoutMs != null && turnTimeoutMs > 0) {
      this.turnTimeoutId = setTimeout(() => {
        this.turnTimeoutId = null;
        if (!this.process || !this.currentTurnId) return;
        this.ctx.log.warn(`Claude Code turn timed out after ${turnTimeoutMs}ms`);
        this.process.kill('SIGTERM');
        this.ctx.emitEvent({
          type: 'turn.completed',
          threadId: this.state.activeThreadId!,
          turnId: this.currentTurnId,
          status: 'failed',
          reason: 'Turn timed out',
          durationMs: Date.now() - this.turnStartTime,
        });
        this.updateState({ status: 'ready', activeTurnId: undefined });
        this.currentTurnId = null;
        this.process = null;
      }, turnTimeoutMs);
    }

    // Handle completion
    this.process.on('close', (code) => {
      this.clearTurnTimeout();
      const turnId = this.currentTurnId;
      if (turnId == null) return; // Already completed (e.g. by timeout)
      const durationMs = Date.now() - this.turnStartTime;

      this.ctx.log.info(`Claude Code exited with code ${code} (${durationMs}ms)`);

      this.ctx.emitEvent({
        type: 'turn.completed',
        threadId: this.state.activeThreadId!,
        turnId,
        status: code === 0 ? 'completed' : 'failed',
        durationMs,
      });

      this.updateState({ status: 'ready', activeTurnId: undefined });
      this.currentTurnId = null;
      this.process = null;
    });

    this.process.on('error', (err) => {
      this.clearTurnTimeout();
      const turnId = this.currentTurnId;
      if (turnId == null) return;
      this.ctx.log.error(`Claude Code process error: ${err.message}`);
      this.ctx.emitEvent({
        type: 'turn.completed',
        threadId: this.state.activeThreadId!,
        turnId,
        status: 'failed',
        reason: err.message,
        durationMs: Date.now() - this.turnStartTime,
      });
      this.updateState({ status: 'error', lastError: err.message });
    });

    return { turnId };
  }

  async interrupt(): Promise<void> {
    if (!this.process) return;
    
    // Send SIGINT (Ctrl+C equivalent)
    this.process.kill('SIGINT');
    
    if (this.currentTurnId) {
      this.ctx.emitEvent({
        type: 'turn.completed',
        threadId: this.state.activeThreadId!,
        turnId: this.currentTurnId,
        status: 'interrupted',
        durationMs: Date.now() - this.turnStartTime,
      });
    }
    
    this.updateState({ status: 'ready', activeTurnId: undefined });
    this.currentTurnId = null;
    this.ctx.log.info('Claude Code interrupted');
  }

  async destroy(): Promise<void> {
    await this.disconnect();
  }

  // ============ Private Methods ============

  private clearTurnTimeout(): void {
    if (this.turnTimeoutId != null) {
      clearTimeout(this.turnTimeoutId);
      this.turnTimeoutId = null;
    }
  }

  private updateState(partial: Partial<AdapterState>): void {
    this.state = { ...this.state, ...partial };
    this.ctx.emitEvent({
      type: 'session.state.changed',
      threadId: this.state.activeThreadId,
      payload: { state: this.state.status },
    });
  }

  private handleOutput(data: string): void {
    if (data.length > 0 && !this.hasReceivedOutputThisTurn) {
      this.hasReceivedOutputThisTurn = true;
      const elapsedMs = Date.now() - this.turnStartTime;
      this.ctx.log.info(`Claude Code first output received (${elapsedMs}ms)`);
    }
    this.outputBuffer += data;

    // Stream content delta
    this.ctx.emitEvent({
      type: 'content.delta',
      threadId: this.state.activeThreadId!,
      turnId: this.currentTurnId!,
      payload: {
        streamKind: 'assistant_text',
        delta: data,
      },
    });

    // Parse for special events
    this.parseOutput(data);
  }

  private parseOutput(data: string): void {
    // Detect file changes
    const fileChangeMatch = data.match(/(?:Created|Modified|Deleted):\s+(.+)/);
    if (fileChangeMatch) {
      const path = fileChangeMatch[1].trim();
      const kind = data.includes('Created') ? 'created' : 
                   data.includes('Deleted') ? 'deleted' : 'modified';
      
      this.ctx.emitEvent({
        type: 'file.changed',
        threadId: this.state.activeThreadId!,
        turnId: this.currentTurnId!,
        payload: { path, kind },
      });
    }

    // Detect tool usage
    const toolMatch = data.match(/(?:Running|Executing):\s+(.+)/);
    if (toolMatch) {
      this.ctx.emitEvent({
        type: 'item.started',
        threadId: this.state.activeThreadId!,
        turnId: this.currentTurnId!,
        payload: {
          itemId: crypto.randomUUID(),
          itemType: 'command_execution',
          title: toolMatch[1],
        },
      });
    }

    // Detect thinking/reasoning
    if (data.includes('Thinking...') || data.includes('reasoning')) {
      this.ctx.emitEvent({
        type: 'content.delta',
        threadId: this.state.activeThreadId!,
        turnId: this.currentTurnId!,
        payload: {
          streamKind: 'reasoning',
          delta: data,
        },
      });
    }
  }
}

export function createClaudeCodeAdapter(config: AdapterConfig): ClaudeCodeAdapter {
  return new ClaudeCodeAdapter(config as ClaudeCodeConfig);
}
