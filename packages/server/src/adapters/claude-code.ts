/**
 * Claude Code Adapter
 * 
 * PTY-based control of Claude Code CLI.
 * Spawns claude-code process, streams output, handles interactions.
 */

import type { IPty } from 'node-pty';
import type { 
  AdapterConfig, 
  AdapterState, 
  AdapterCapabilities,
  SendOptions,
  RuntimeEvent 
} from '@acc/contracts';
import type { AdapterContext, AdapterImplementation } from './types';

interface ClaudeCodeConfig extends AdapterConfig {
  options?: {
    /** Path to claude binary (default: 'claude') */
    binaryPath?: string;
    /** Model to use */
    model?: string;
    /** Enable auto-accept for safe operations */
    autoAccept?: boolean;
  };
}

export class ClaudeCodeAdapter implements AdapterImplementation {
  private ctx!: AdapterContext;
  private config: ClaudeCodeConfig;
  private pty: IPty | null = null;
  private state: AdapterState = {
    status: 'disconnected',
  };
  private outputBuffer = '';
  private currentTurnId: string | null = null;

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
      // Dynamic import node-pty (native module)
      const pty = await import('node-pty');
      
      const binaryPath = this.config.options?.binaryPath ?? 'claude';
      const args: string[] = [];
      
      if (this.config.cwd) {
        args.push('--project', this.config.cwd);
      }
      
      if (this.config.options?.model) {
        args.push('--model', this.config.options.model);
      }

      this.pty = pty.spawn(binaryPath, args, {
        name: 'xterm-256color',
        cols: 120,
        rows: 40,
        cwd: this.config.cwd ?? process.cwd(),
        env: process.env as Record<string, string>,
      });

      this.pty.onData((data) => {
        this.handleOutput(data);
      });

      this.pty.onExit(({ exitCode }) => {
        this.ctx.log.info(`Claude Code exited with code ${exitCode}`);
        this.updateState({ status: 'disconnected' });
        this.ctx.emitEvent({
          type: 'session.ended',
          threadId: this.state.activeThreadId,
          reason: `Process exited with code ${exitCode}`,
        });
      });

      // Wait for ready signal
      await this.waitForReady();
      
      this.updateState({ 
        status: 'ready',
        activeThreadId: crypto.randomUUID(),
      });

      this.ctx.emitEvent({
        type: 'session.started',
        threadId: this.state.activeThreadId!,
      });

      this.ctx.log.info('Claude Code connected and ready');

    } catch (error) {
      this.updateState({ 
        status: 'error', 
        lastError: error instanceof Error ? error.message : 'Connection failed' 
      });
      throw error;
    }
  }

  async disconnect(): Promise<void> {
    if (this.pty) {
      this.pty.kill();
      this.pty = null;
    }
    this.updateState({ status: 'disconnected' });
    this.ctx.log.info('Claude Code disconnected');
  }

  async send(options: SendOptions): Promise<{ turnId: string }> {
    if (!this.pty || this.state.status !== 'ready') {
      throw new Error('Not connected');
    }

    const turnId = crypto.randomUUID();
    this.currentTurnId = turnId;
    this.updateState({ status: 'running', activeTurnId: turnId });

    this.ctx.emitEvent({
      type: 'turn.started',
      threadId: this.state.activeThreadId!,
      turnId,
    });

    // Inject context if provided
    let message = options.message;
    if (options.context) {
      message = `Context:\n${options.context}\n\nTask:\n${message}`;
    }

    // Send to PTY
    this.pty.write(message + '\n');
    
    this.ctx.log.info(`Sent message to Claude Code (turn: ${turnId})`);

    return { turnId };
  }

  async interrupt(): Promise<void> {
    if (!this.pty) return;
    
    // Send Ctrl+C
    this.pty.write('\x03');
    
    if (this.currentTurnId) {
      this.ctx.emitEvent({
        type: 'turn.completed',
        threadId: this.state.activeThreadId!,
        turnId: this.currentTurnId,
        status: 'interrupted',
        durationMs: 0,
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

  private updateState(partial: Partial<AdapterState>): void {
    this.state = { ...this.state, ...partial };
    this.ctx.emitEvent({
      type: 'session.state.changed',
      threadId: this.state.activeThreadId,
      payload: { state: this.state.status },
    });
  }

  private handleOutput(data: string): void {
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
    // Detect completion
    if (data.includes('╭─') || data.includes('❯')) {
      // Claude Code shows prompt when ready for input
      if (this.state.status === 'running' && this.currentTurnId) {
        this.ctx.emitEvent({
          type: 'turn.completed',
          threadId: this.state.activeThreadId!,
          turnId: this.currentTurnId,
          status: 'completed',
          durationMs: 0, // TODO: track actual duration
        });
        this.updateState({ status: 'ready', activeTurnId: undefined });
        this.currentTurnId = null;
      }
    }

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

    // Detect approval requests
    if (data.includes('Allow?') || data.includes('[y/N]')) {
      this.ctx.emitEvent({
        type: 'approval.requested',
        threadId: this.state.activeThreadId!,
        turnId: this.currentTurnId!,
        payload: {
          requestId: crypto.randomUUID(),
          requestType: 'command_execution',
          detail: data,
        },
      });
    }

    // Detect tool usage
    const toolMatch = data.match(/Running:\s+(.+)/);
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
  }

  private waitForReady(): Promise<void> {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('Timeout waiting for Claude Code to be ready'));
      }, 30000);

      const checkReady = (data: string) => {
        // Look for ready indicators
        if (data.includes('╭─') || data.includes('❯') || data.includes('Claude')) {
          clearTimeout(timeout);
          resolve();
        }
      };

      // Temporary listener
      const onData = this.pty!.onData(checkReady);
      
      // Cleanup after resolved
      setTimeout(() => {
        onData.dispose();
      }, 30000);
    });
  }
}

export function createClaudeCodeAdapter(config: AdapterConfig): ClaudeCodeAdapter {
  return new ClaudeCodeAdapter(config as ClaudeCodeConfig);
}
