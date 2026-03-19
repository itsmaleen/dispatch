/**
 * Agent Console Launcher
 *
 * Orchestrates launching agent consoles in isolated worktrees.
 * Ties together WorktreeManager and SessionManager.
 *
 * Flow:
 * 1. Create worktree for the task (WorktreeManager)
 * 2. Create session in that worktree (SessionManager)
 * 3. Track the agent console state
 */

import { EventEmitter } from 'events';
import { WorktreeManager, getWorktreeManager } from './worktree-manager';
import { getSessionManager, type SessionManager, type Session } from '../adapters/session-manager';
import type {
  WorktreeInfo,
  CreateWorktreeOptions,
  AgentConsole,
  AgentConsoleStatus,
  LaunchAgentOptions,
  LaunchResult,
} from '@acc/contracts';

// Re-export types for convenience
export type { AgentConsole, AgentConsoleStatus, LaunchAgentOptions, LaunchResult };

/** Events emitted by AgentConsoleLauncher */
export interface AgentConsoleLauncherEvents {
  'console:created': (console: AgentConsole) => void;
  'console:started': (consoleId: string) => void;
  'console:completed': (consoleId: string) => void;
  'console:failed': (consoleId: string, error: string) => void;
  'console:status_changed': (consoleId: string, status: AgentConsoleStatus) => void;
  'console:removed': (consoleId: string) => void;
}

// ============================================================================
// AGENT CONSOLE LAUNCHER
// ============================================================================

export class AgentConsoleLauncher extends EventEmitter {
  private worktreeManager: WorktreeManager;
  private sessionManager: SessionManager;
  private consoles: Map<string, AgentConsole> = new Map();

  constructor(repoPath: string) {
    super();
    this.worktreeManager = getWorktreeManager(repoPath);
    this.sessionManager = getSessionManager();

    // Listen to session events to update console status
    this.setupSessionListeners();
  }

  /**
   * Launch a new agent console in an isolated worktree
   */
  async launch(options: LaunchAgentOptions): Promise<LaunchResult> {
    const {
      task,
      title = this.generateTitle(task),
      branch = this.generateBranchName(title),
      baseBranch = 'main',
      autoStart = false,
    } = options;

    const consoleId = crypto.randomUUID();
    const threadId = crypto.randomUUID();

    // Create initial console state
    const agentConsole: AgentConsole = {
      id: consoleId,
      title,
      task,
      status: 'initializing',
      branch,
      baseBranch,
      worktreePath: '', // Will be set after worktree creation
      threadId,
      createdAt: new Date(),
    };

    this.consoles.set(consoleId, agentConsole);

    try {
      // 1. Create worktree
      const worktreeResult = await this.worktreeManager.create({
        branch,
        baseBranch,
      });

      if (!worktreeResult.success || !worktreeResult.worktree) {
        throw new Error(worktreeResult.error || 'Failed to create worktree');
      }

      agentConsole.worktreePath = worktreeResult.worktree.path;

      // 2. Create session in the worktree
      await this.sessionManager.createSession({
        threadId,
        cwd: worktreeResult.worktree.path,
        name: title,
        worktreePath: worktreeResult.worktree.path,
      });

      // 3. Update status to ready
      agentConsole.status = 'ready';
      this.emit('console:created', agentConsole);
      this.emit('console:status_changed', consoleId, 'ready');

      // 4. Auto-start if requested
      if (autoStart) {
        await this.start(consoleId);
      }

      return {
        success: true,
        console: agentConsole,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);

      agentConsole.status = 'failed';
      agentConsole.error = errorMessage;

      this.emit('console:failed', consoleId, errorMessage);

      // Clean up worktree if it was created
      if (agentConsole.worktreePath) {
        try {
          await this.worktreeManager.remove(branch, true);
        } catch {
          // Ignore cleanup errors
        }
      }

      return {
        success: false,
        error: errorMessage,
      };
    }
  }

  /**
   * Start an agent console (send the task to the agent)
   */
  async start(consoleId: string): Promise<void> {
    const agentConsole = this.consoles.get(consoleId);
    if (!agentConsole) {
      throw new Error(`Console not found: ${consoleId}`);
    }

    if (agentConsole.status !== 'ready' && agentConsole.status !== 'paused') {
      throw new Error(`Console not ready to start: ${agentConsole.status}`);
    }

    agentConsole.status = 'running';
    agentConsole.startedAt = new Date();

    this.emit('console:started', consoleId);
    this.emit('console:status_changed', consoleId, 'running');

    // Send the task to the agent
    await this.sessionManager.send(agentConsole.threadId, {
      message: agentConsole.task,
    });
  }

  /**
   * Send a follow-up message to an agent console
   */
  async sendMessage(consoleId: string, message: string): Promise<void> {
    const agentConsole = this.consoles.get(consoleId);
    if (!agentConsole) {
      throw new Error(`Console not found: ${consoleId}`);
    }

    if (agentConsole.status !== 'ready' && agentConsole.status !== 'running') {
      throw new Error(`Console not ready for messages: ${agentConsole.status}`);
    }

    agentConsole.status = 'running';
    this.emit('console:status_changed', consoleId, 'running');

    await this.sessionManager.send(agentConsole.threadId, { message });
  }

  /**
   * Get an agent console by ID
   */
  get(consoleId: string): AgentConsole | undefined {
    return this.consoles.get(consoleId);
  }

  /**
   * Get an agent console by thread ID
   */
  getByThreadId(threadId: string): AgentConsole | undefined {
    for (const console of this.consoles.values()) {
      if (console.threadId === threadId) {
        return console;
      }
    }
    return undefined;
  }

  /**
   * List all agent consoles
   */
  list(): AgentConsole[] {
    return Array.from(this.consoles.values());
  }

  /**
   * List active (non-completed, non-merged) agent consoles
   */
  listActive(): AgentConsole[] {
    return this.list().filter(
      (c) => c.status !== 'completed' && c.status !== 'merged' && c.status !== 'failed'
    );
  }

  /**
   * Remove an agent console and clean up its worktree
   */
  async remove(consoleId: string, force: boolean = false): Promise<void> {
    const agentConsole = this.consoles.get(consoleId);
    if (!agentConsole) {
      throw new Error(`Console not found: ${consoleId}`);
    }

    // Don't allow removing running consoles unless forced
    if (agentConsole.status === 'running' && !force) {
      throw new Error('Cannot remove running console. Stop it first or use force.');
    }

    // Close the session
    await this.sessionManager.closeSession(agentConsole.threadId);

    // Remove the worktree
    await this.worktreeManager.remove(agentConsole.branch, force);

    // Remove from our map
    this.consoles.delete(consoleId);

    this.emit('console:removed', consoleId);
  }

  /**
   * Get worktree info for an agent console
   */
  async getWorktreeInfo(consoleId: string): Promise<WorktreeInfo | null> {
    const agentConsole = this.consoles.get(consoleId);
    if (!agentConsole) {
      return null;
    }

    return this.worktreeManager.get(agentConsole.branch);
  }

  /**
   * Get changes made by an agent console
   */
  async getChanges(consoleId: string) {
    const agentConsole = this.consoles.get(consoleId);
    if (!agentConsole) {
      return null;
    }

    return this.worktreeManager.getChanges(agentConsole.branch);
  }

  /**
   * Merge an agent console's work into the target branch
   */
  async merge(
    consoleId: string,
    options: {
      targetBranch?: string;
      message?: string;
      removeAfterMerge?: boolean;
    } = {}
  ) {
    const agentConsole = this.consoles.get(consoleId);
    if (!agentConsole) {
      throw new Error(`Console not found: ${consoleId}`);
    }

    if (agentConsole.status !== 'completed' && agentConsole.status !== 'ready') {
      throw new Error(`Console not ready for merge: ${agentConsole.status}`);
    }

    const result = await this.worktreeManager.merge(agentConsole.branch, {
      targetBranch: options.targetBranch || agentConsole.baseBranch,
      message: options.message || `Merge ${agentConsole.title}`,
      removeWorktree: options.removeAfterMerge,
      deleteBranch: options.removeAfterMerge,
    });

    if (result.success && options.removeAfterMerge) {
      agentConsole.status = 'merged';
      this.emit('console:status_changed', consoleId, 'merged');

      // Clean up session
      await this.sessionManager.closeSession(agentConsole.threadId);
      this.consoles.delete(consoleId);
      this.emit('console:removed', consoleId);
    }

    return result;
  }

  /**
   * Setup listeners for session manager events
   */
  private setupSessionListeners(): void {
    // When a turn completes, check if we should update console status
    this.sessionManager.on('turn.completed', (threadId: string) => {
      const agentConsole = this.getByThreadId(threadId);
      if (agentConsole && agentConsole.status === 'running') {
        // Agent finished this turn - mark as ready for more input or completed
        agentConsole.status = 'ready';
        agentConsole.completedAt = new Date();
        this.emit('console:completed', agentConsole.id);
        this.emit('console:status_changed', agentConsole.id, 'ready');
      }
    });

    this.sessionManager.on('turn.error', (threadId: string, _turnId: string, error: Error) => {
      const agentConsole = this.getByThreadId(threadId);
      if (agentConsole) {
        agentConsole.status = 'failed';
        agentConsole.error = error.message;
        this.emit('console:failed', agentConsole.id, error.message);
        this.emit('console:status_changed', agentConsole.id, 'failed');
      }
    });
  }

  /**
   * Generate a title from a task description
   */
  private generateTitle(task: string): string {
    // Take first line or first 50 chars
    const firstLine = task.split('\n')[0].trim();
    if (firstLine.length <= 50) {
      return firstLine;
    }
    return firstLine.slice(0, 47) + '...';
  }

  /**
   * Generate a branch name from a title
   */
  private generateBranchName(title: string): string {
    const slug = title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 30);

    const timestamp = Date.now().toString(36);
    return `agent/${slug}-${timestamp}`;
  }
}

// ============================================================================
// SINGLETON MANAGEMENT
// ============================================================================

const launchers: Map<string, AgentConsoleLauncher> = new Map();

/**
 * Get or create an AgentConsoleLauncher for a repository
 */
export function getAgentConsoleLauncher(repoPath: string): AgentConsoleLauncher {
  let launcher = launchers.get(repoPath);
  if (!launcher) {
    launcher = new AgentConsoleLauncher(repoPath);
    launchers.set(repoPath, launcher);
  }
  return launcher;
}

/**
 * Clear all cached AgentConsoleLauncher instances
 */
export function clearAgentConsoleLaunchers(): void {
  launchers.clear();
}
