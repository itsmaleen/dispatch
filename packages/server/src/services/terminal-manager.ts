/**
 * Terminal Manager Service
 *
 * Manages PTY (pseudo-terminal) processes for real shell access.
 * Provides:
 * - Terminal creation/destruction
 * - Process lifecycle management
 * - Output buffering for agent access
 * - Event emission for real-time updates
 */

import * as pty from 'node-pty';
import { EventEmitter } from 'events';
import { randomUUID } from 'crypto';
import { existsSync } from 'fs';
import type {
  TerminalInstance,
  CreateTerminalOptions,
  TerminalBufferConfig,
  DEFAULT_TERMINAL_BUFFER_CONFIG,
} from '@acc/contracts';

// ============================================================================
// TYPES
// ============================================================================

interface ManagedTerminal {
  instance: TerminalInstance;
  ptyProcess: pty.IPty;
  outputBuffer: string[];
  outputBytes: number;
  bufferConfig: TerminalBufferConfig;
  attachedClients: Set<string>;
}

export interface TerminalManagerEvents {
  'terminal:created': (terminal: TerminalInstance) => void;
  'terminal:output': (terminalId: string, data: string) => void;
  'terminal:exit': (terminalId: string, code: number, signal?: string) => void;
  'terminal:closed': (terminalId: string) => void;
  'terminal:error': (terminalId: string, error: Error) => void;
}

// ============================================================================
// TERMINAL MANAGER
// ============================================================================

export class TerminalManager extends EventEmitter {
  private terminals: Map<string, ManagedTerminal> = new Map();
  private defaultShell: string;
  private defaultCwd: string;

  constructor(options?: { defaultCwd?: string }) {
    super();
    this.defaultShell = this.detectDefaultShell();
    this.defaultCwd = options?.defaultCwd || process.env.HOME || '/';
  }

  /**
   * Detect the user's default shell
   */
  private detectDefaultShell(): string {
    if (process.platform === 'win32') {
      return process.env.COMSPEC || 'cmd.exe';
    }

    // Try SHELL env var first
    const shell = process.env.SHELL;
    if (shell && existsSync(shell)) {
      return shell;
    }

    // Fallback to common shells
    const fallbacks = ['/bin/zsh', '/bin/bash', '/bin/sh'];
    for (const fallback of fallbacks) {
      if (existsSync(fallback)) {
        console.log(`[TerminalManager] Using fallback shell: ${fallback}`);
        return fallback;
      }
    }

    return '/bin/bash';
  }

  /**
   * Generate a unique terminal name
   */
  private generateName(index: number): string {
    return `Terminal ${index + 1}`;
  }

  /**
   * Create a new terminal
   */
  create(options: CreateTerminalOptions = {}): TerminalInstance {
    const id = randomUUID();
    const name = options.name || this.generateName(this.terminals.size);
    let shell = options.shell || this.defaultShell;
    const cwd = options.cwd || this.defaultCwd;
    const cols = options.cols || 80;
    const rows = options.rows || 24;

    // Ensure HOME is set (may be missing in Electron context)
    const HOME = process.env.HOME || process.env.USERPROFILE || '/tmp';

    // Merge environment variables, ensuring critical ones are set
    const env = {
      ...process.env,
      HOME,
      USER: process.env.USER || process.env.USERNAME || 'user',
      PATH: process.env.PATH || '/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin',
      TERM: 'xterm-256color',
      COLORTERM: 'truecolor',
      LANG: process.env.LANG || 'en_US.UTF-8',
      ...options.env,
    };

    // Validate cwd exists, fallback to HOME
    let validCwd = cwd;
    try {
      if (!existsSync(cwd)) {
        console.warn(`[TerminalManager] CWD does not exist: ${cwd}, using HOME`);
        validCwd = HOME;
      }
    } catch {
      validCwd = HOME;
    }

    // Validate shell exists
    if (!existsSync(shell)) {
      console.error(`[TerminalManager] Shell does not exist: ${shell}`);
      // Try to find an alternative
      const alternatives = ['/bin/zsh', '/bin/bash', '/bin/sh'];
      let foundShell: string | null = null;
      for (const alt of alternatives) {
        if (existsSync(alt)) {
          foundShell = alt;
          break;
        }
      }
      if (!foundShell) {
        throw new Error(`Shell not found: ${shell} and no alternatives available`);
      }
      console.log(`[TerminalManager] Using alternative shell: ${foundShell}`);
      shell = foundShell;
    }

    console.log(`[TerminalManager] Spawning shell: ${shell}, cwd: ${validCwd}, platform: ${process.platform}, arch: ${process.arch}`);

    // Spawn the PTY process
    let ptyProcess: pty.IPty;
    let lastError: Error | null = null;

    // Try spawning with different shell options
    const shellsToTry = [shell];
    if (shell !== '/bin/zsh' && existsSync('/bin/zsh')) shellsToTry.push('/bin/zsh');
    if (shell !== '/bin/bash' && existsSync('/bin/bash')) shellsToTry.push('/bin/bash');
    if (shell !== '/bin/sh' && existsSync('/bin/sh')) shellsToTry.push('/bin/sh');

    for (const tryShell of shellsToTry) {
      try {
        console.log(`[TerminalManager] Trying shell: ${tryShell}`);
        ptyProcess = pty.spawn(tryShell, [], {
          name: 'xterm-256color',
          cols,
          rows,
          cwd: validCwd,
          env: env as Record<string, string>,
        });
        console.log(`[TerminalManager] Successfully spawned with: ${tryShell}`);
        shell = tryShell; // Update shell for the instance record
        break;
      } catch (err) {
        lastError = err instanceof Error ? err : new Error(String(err));
        console.error(`[TerminalManager] Failed to spawn PTY with ${tryShell}:`, lastError.message);
      }
    }

    // If we couldn't spawn with any shell
    if (!ptyProcess!) {
      console.error(`[TerminalManager] All shell attempts failed. Debug info:`, {
        shellsAttempted: shellsToTry,
        cwd: validCwd,
        platform: process.platform,
        arch: process.arch,
        HOME: env.HOME,
        PATH: env.PATH?.substring(0, 100) + '...',
        electronVersion: process.versions.electron,
        nodeVersion: process.versions.node,
      });

      const errorMsg = lastError?.message || 'Unknown error';
      if (errorMsg.includes('posix_spawnp')) {
        throw new Error(
          `Failed to spawn terminal: ${errorMsg}. ` +
          `This may indicate a node-pty native module compatibility issue. ` +
          `The native module may need to be rebuilt for Electron. ` +
          `Try: npx @electron/rebuild -m node_modules/node-pty`
        );
      }

      throw new Error(`Failed to spawn terminal: ${errorMsg}`);
    }

    const instance: TerminalInstance = {
      id,
      name,
      pid: ptyProcess.pid,
      cwd,
      shell,
      env: options.env || {},
      cols,
      rows,
      createdAt: new Date(),
      createdBy: options.createdBy || 'user',
      agentId: options.agentId,
      sessionId: options.sessionId,
      status: 'running',
      labels: options.labels,
    };

    const managed: ManagedTerminal = {
      instance,
      ptyProcess,
      outputBuffer: [],
      outputBytes: 0,
      bufferConfig: {
        maxLines: 10000,
        maxBytes: 5 * 1024 * 1024,
      },
      attachedClients: new Set(),
    };

    // Handle PTY output
    ptyProcess.onData((data: string) => {
      this.appendToBuffer(managed, data);
      this.emit('terminal:output', id, data);
    });

    // Handle PTY exit
    ptyProcess.onExit(({ exitCode, signal }) => {
      managed.instance.status = 'exited';
      managed.instance.exitCode = exitCode;
      managed.instance.exitSignal = signal !== undefined ? String(signal) : undefined;
      this.emit('terminal:exit', id, exitCode, signal !== undefined ? String(signal) : undefined);
    });

    this.terminals.set(id, managed);
    this.emit('terminal:created', instance);

    // Send initial command if provided
    if (options.initialCommand) {
      setTimeout(() => {
        this.write(id, options.initialCommand + '\n');
      }, 100);
    }

    return instance;
  }

  /**
   * Append data to the output buffer, respecting limits
   */
  private appendToBuffer(managed: ManagedTerminal, data: string): void {
    const lines = data.split('\n');

    for (const line of lines) {
      managed.outputBuffer.push(line);
      managed.outputBytes += line.length;
    }

    // Trim buffer if it exceeds limits
    while (
      managed.outputBuffer.length > managed.bufferConfig.maxLines ||
      managed.outputBytes > managed.bufferConfig.maxBytes
    ) {
      const removed = managed.outputBuffer.shift();
      if (removed) {
        managed.outputBytes -= removed.length;
      }
    }
  }

  /**
   * Write data to a terminal
   */
  write(terminalId: string, data: string): boolean {
    const managed = this.terminals.get(terminalId);
    if (!managed || managed.instance.status !== 'running') {
      return false;
    }

    managed.ptyProcess.write(data);
    return true;
  }

  /**
   * Resize a terminal
   */
  resize(terminalId: string, cols: number, rows: number): boolean {
    const managed = this.terminals.get(terminalId);
    if (!managed || managed.instance.status !== 'running') {
      return false;
    }

    managed.ptyProcess.resize(cols, rows);
    managed.instance.cols = cols;
    managed.instance.rows = rows;
    return true;
  }

  /**
   * Get a terminal by ID
   */
  get(terminalId: string): TerminalInstance | null {
    const managed = this.terminals.get(terminalId);
    return managed?.instance || null;
  }

  /**
   * Get a terminal by name
   */
  getByName(name: string): TerminalInstance | null {
    for (const managed of this.terminals.values()) {
      if (managed.instance.name === name) {
        return managed.instance;
      }
    }
    return null;
  }

  /**
   * List all terminals
   */
  list(): TerminalInstance[] {
    return Array.from(this.terminals.values()).map((m) => m.instance);
  }

  /**
   * Get recent output from a terminal
   */
  getRecentOutput(terminalId: string, lines: number = 50): string | null {
    const managed = this.terminals.get(terminalId);
    if (!managed) {
      return null;
    }

    const recentLines = managed.outputBuffer.slice(-lines);
    return recentLines.join('\n');
  }

  /**
   * Wait for a pattern to appear in terminal output
   */
  async waitForOutput(
    terminalId: string,
    pattern: RegExp | string,
    timeout: number = 30000
  ): Promise<{ matched: boolean; output: string }> {
    const managed = this.terminals.get(terminalId);
    if (!managed) {
      return { matched: false, output: '' };
    }

    const regex = typeof pattern === 'string' ? new RegExp(pattern) : pattern;
    const startTime = Date.now();
    let accumulatedOutput = '';

    return new Promise((resolve) => {
      // Check existing buffer first
      const existingOutput = managed.outputBuffer.join('\n');
      if (regex.test(existingOutput)) {
        resolve({ matched: true, output: existingOutput });
        return;
      }

      const checkOutput = (data: string) => {
        accumulatedOutput += data;
        if (regex.test(accumulatedOutput)) {
          cleanup();
          resolve({ matched: true, output: accumulatedOutput });
        }
      };

      const timeoutId = setTimeout(() => {
        cleanup();
        resolve({ matched: false, output: accumulatedOutput });
      }, timeout);

      const cleanup = () => {
        clearTimeout(timeoutId);
        this.off('terminal:output', onOutput);
      };

      const onOutput = (id: string, data: string) => {
        if (id === terminalId) {
          checkOutput(data);
        }
      };

      this.on('terminal:output', onOutput);
    });
  }

  /**
   * Close a terminal
   */
  close(terminalId: string): boolean {
    const managed = this.terminals.get(terminalId);
    if (!managed) {
      return false;
    }

    // Kill the process if still running
    if (managed.instance.status === 'running') {
      managed.ptyProcess.kill();
    }

    this.terminals.delete(terminalId);
    this.emit('terminal:closed', terminalId);
    return true;
  }

  /**
   * Attach a client to receive terminal output
   */
  attachClient(terminalId: string, clientId: string): boolean {
    const managed = this.terminals.get(terminalId);
    if (!managed) {
      return false;
    }

    managed.attachedClients.add(clientId);
    return true;
  }

  /**
   * Detach a client from a terminal
   */
  detachClient(terminalId: string, clientId: string): boolean {
    const managed = this.terminals.get(terminalId);
    if (!managed) {
      return false;
    }

    managed.attachedClients.delete(clientId);
    return true;
  }

  /**
   * Check if a client is attached to a terminal
   */
  isClientAttached(terminalId: string, clientId: string): boolean {
    const managed = this.terminals.get(terminalId);
    return managed?.attachedClients.has(clientId) || false;
  }

  /**
   * Get all clients attached to a terminal
   */
  getAttachedClients(terminalId: string): string[] {
    const managed = this.terminals.get(terminalId);
    return managed ? Array.from(managed.attachedClients) : [];
  }

  /**
   * Cleanup all terminals
   */
  cleanup(): void {
    for (const [id] of this.terminals) {
      this.close(id);
    }
  }
}

// Singleton instance
let terminalManagerInstance: TerminalManager | null = null;

export function getTerminalManager(options?: { defaultCwd?: string }): TerminalManager {
  if (!terminalManagerInstance) {
    terminalManagerInstance = new TerminalManager(options);
  }
  return terminalManagerInstance;
}

export function resetTerminalManager(): void {
  if (terminalManagerInstance) {
    terminalManagerInstance.cleanup();
    terminalManagerInstance = null;
  }
}
