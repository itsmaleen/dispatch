/**
 * Worktree Manager Service
 *
 * Manages git worktrees for isolated agent execution.
 * Each agent gets its own worktree with a dedicated branch.
 *
 * Worktree location: ~/.acc/worktrees/{repo-name}/{branch-name}/
 */

import { EventEmitter } from 'events';
import * as path from 'path';
import * as os from 'os';
import type {
  WorktreeInfo,
  CreateWorktreeOptions,
  CreateWorktreeResult,
  RemoveWorktreeResult,
  IWorktreeManager,
  WorktreeEvent,
  WorktreeChanges,
  MergeResult,
  MergeOptions,
} from '@acc/contracts';
import * as git from './git';

// ============================================================================
// TYPES
// ============================================================================

export interface WorktreeManagerOptions {
  /** Path to the git repository */
  repoPath: string;

  /** Base directory for worktrees (default: ~/.acc/worktrees) */
  worktreesBaseDir?: string;
}

export interface WorktreeManagerEvents {
  'worktree:created': (worktree: WorktreeInfo) => void;
  'worktree:removed': (branch: string, path: string) => void;
  'worktree:locked': (branch: string, reason?: string) => void;
  'worktree:unlocked': (branch: string) => void;
  'worktree:error': (branch: string, error: string) => void;
}

// ============================================================================
// WORKTREE MANAGER
// ============================================================================

export class WorktreeManager extends EventEmitter implements IWorktreeManager {
  private repoPath: string;
  private repoName: string | null = null;
  private worktreesBaseDir: string;
  private initialized: boolean = false;

  constructor(options: WorktreeManagerOptions) {
    super();
    this.repoPath = options.repoPath;
    this.worktreesBaseDir =
      options.worktreesBaseDir || path.join(os.homedir(), '.acc', 'worktrees');
  }

  /**
   * Initialize the manager (validates repo, gets repo name)
   */
  private async ensureInitialized(): Promise<void> {
    if (this.initialized) return;

    // Verify this is a git repository
    const isRepo = await git.isGitRepo(this.repoPath);
    if (!isRepo) {
      throw new Error(`Not a git repository: ${this.repoPath}`);
    }

    // Get the repo root (in case repoPath is a subdirectory)
    this.repoPath = await git.getRepoRoot(this.repoPath);

    // Get repo name for worktree directory structure
    this.repoName = await git.getRepoName(this.repoPath);

    // Ensure worktrees directory exists
    await git.ensureDir(this.getWorktreesDir());

    this.initialized = true;
  }

  /**
   * Get the repository root path
   */
  getRepoPath(): string {
    return this.repoPath;
  }

  /**
   * Get the worktrees directory for this repository
   */
  getWorktreesDir(): string {
    return path.join(this.worktreesBaseDir, this.repoName || 'unknown');
  }

  /**
   * Get the path where a worktree for a branch would be created
   */
  private getWorktreePath(branch: string): string {
    const sanitizedBranch = git.sanitizeBranchName(branch);
    return path.join(this.getWorktreesDir(), sanitizedBranch);
  }

  /**
   * Create a new worktree for isolated agent work
   */
  async create(options: CreateWorktreeOptions): Promise<CreateWorktreeResult> {
    await this.ensureInitialized();

    const { branch, baseBranch, lock, lockReason } = options;

    try {
      // Determine the base branch
      const resolvedBaseBranch = baseBranch || (await git.getDefaultBranch(this.repoPath));

      // Check if branch already exists
      const branchExists = await git.branchExists(this.repoPath, branch);

      // Determine worktree path
      const worktreePath = options.path || this.getWorktreePath(branch);

      // Check if worktree already exists at this path
      if (await git.dirExists(worktreePath)) {
        return {
          success: false,
          error: `Worktree directory already exists: ${worktreePath}`,
        };
      }

      // Create the worktree
      await git.addWorktree(this.repoPath, worktreePath, branch, {
        createBranch: !branchExists,
        baseBranch: resolvedBaseBranch,
      });

      // Lock if requested
      if (lock) {
        await git.lockWorktree(this.repoPath, worktreePath, lockReason);
      }

      // Get worktree info
      const worktree = await this.getWorktreeInfo(worktreePath, branch, resolvedBaseBranch);

      if (!worktree) {
        return {
          success: false,
          error: 'Failed to get worktree info after creation',
        };
      }

      // Emit event
      this.emit('worktree:created', worktree);

      return {
        success: true,
        worktree,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.emit('worktree:error', branch, errorMessage);

      return {
        success: false,
        error: errorMessage,
      };
    }
  }

  /**
   * Remove a worktree
   */
  async remove(branch: string, force: boolean = false): Promise<RemoveWorktreeResult> {
    await this.ensureInitialized();

    try {
      const worktreePath = this.getWorktreePath(branch);

      // Check if worktree exists
      const exists = await git.dirExists(worktreePath);
      if (!exists) {
        return {
          success: false,
          error: `Worktree not found: ${worktreePath}`,
        };
      }

      // Remove the worktree
      await git.removeWorktree(this.repoPath, worktreePath, force);

      // Emit event
      this.emit('worktree:removed', branch, worktreePath);

      return { success: true };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.emit('worktree:error', branch, errorMessage);

      return {
        success: false,
        error: errorMessage,
      };
    }
  }

  /**
   * List all worktrees for the current repository
   */
  async list(): Promise<WorktreeInfo[]> {
    await this.ensureInitialized();

    const entries = await git.listWorktrees(this.repoPath);
    const worktrees: WorktreeInfo[] = [];

    for (const entry of entries) {
      // Skip bare repositories
      if (entry.isBare) continue;

      const isMain = entry.path === this.repoPath;
      const branch = entry.branch || 'HEAD';

      // For non-main worktrees, try to determine the base branch
      // This is a simplification - we assume main/master as base
      const baseBranch = isMain ? branch : await git.getDefaultBranch(this.repoPath);

      const worktree = await this.getWorktreeInfo(entry.path, branch, baseBranch, entry);

      if (worktree) {
        worktrees.push(worktree);
      }
    }

    return worktrees;
  }

  /**
   * Get information about a specific worktree
   */
  async get(branch: string): Promise<WorktreeInfo | null> {
    await this.ensureInitialized();

    const worktreePath = this.getWorktreePath(branch);

    // Check if it exists
    if (!(await git.dirExists(worktreePath))) {
      return null;
    }

    const baseBranch = await git.getDefaultBranch(this.repoPath);
    return this.getWorktreeInfo(worktreePath, branch, baseBranch);
  }

  /**
   * Check if a worktree exists for a branch
   */
  async exists(branch: string): Promise<boolean> {
    await this.ensureInitialized();
    const worktreePath = this.getWorktreePath(branch);
    return git.dirExists(worktreePath);
  }

  /**
   * Lock a worktree to prevent accidental deletion
   */
  async lock(branch: string, reason?: string): Promise<void> {
    await this.ensureInitialized();
    const worktreePath = this.getWorktreePath(branch);
    await git.lockWorktree(this.repoPath, worktreePath, reason);
    this.emit('worktree:locked', branch, reason);
  }

  /**
   * Unlock a previously locked worktree
   */
  async unlock(branch: string): Promise<void> {
    await this.ensureInitialized();
    const worktreePath = this.getWorktreePath(branch);
    await git.unlockWorktree(this.repoPath, worktreePath);
    this.emit('worktree:unlocked', branch);
  }

  /**
   * Prune stale worktree references
   */
  async prune(): Promise<void> {
    await this.ensureInitialized();
    await git.pruneWorktrees(this.repoPath);
  }

  /**
   * Get detailed info about a worktree
   */
  private async getWorktreeInfo(
    worktreePath: string,
    branch: string,
    baseBranch: string,
    entry?: git.WorktreeListEntry
  ): Promise<WorktreeInfo | null> {
    try {
      const isMain = worktreePath === this.repoPath;
      const commitSha = entry?.head || (await git.getHeadCommit(worktreePath));
      const isClean = await git.isClean(worktreePath);

      // Get lock status from entry or check directly
      let isLocked = false;
      let lockReason: string | undefined;

      if (entry) {
        isLocked = entry.isLocked;
        lockReason = entry.lockReason;
      } else {
        // Check lock status by listing worktrees
        const entries = await git.listWorktrees(this.repoPath);
        // Normalize paths for comparison (handles macOS /private symlink)
        const fsMod = await import('fs/promises');
        let normalizedWorktreePath: string;
        try {
          normalizedWorktreePath = await fsMod.realpath(worktreePath);
        } catch {
          normalizedWorktreePath = worktreePath;
        }
        for (const e of entries) {
          let normalizedEntryPath: string;
          try {
            normalizedEntryPath = await fsMod.realpath(e.path);
          } catch {
            normalizedEntryPath = e.path;
          }
          if (normalizedEntryPath === normalizedWorktreePath) {
            isLocked = e.isLocked;
            lockReason = e.lockReason;
            break;
          }
        }
      }

      // Get creation time from directory stat
      const fs = await import('fs/promises');
      let createdAt = new Date();
      try {
        const stat = await fs.stat(worktreePath);
        createdAt = stat.birthtime;
      } catch {
        // Fallback to current time if stat fails
      }

      return {
        path: worktreePath,
        branch,
        baseBranch,
        commitSha,
        createdAt,
        isClean,
        isMain,
        isLocked,
        lockReason,
      };
    } catch {
      return null;
    }
  }

  /**
   * Get changes in a worktree compared to its base branch
   */
  async getChanges(branch: string): Promise<WorktreeChanges | null> {
    await this.ensureInitialized();

    const worktreePath = this.getWorktreePath(branch);

    if (!(await git.dirExists(worktreePath))) {
      return null;
    }

    const baseBranch = await git.getDefaultBranch(this.repoPath);
    const files = await git.getChangedFiles(worktreePath);
    const ahead = await git.commitsAhead(worktreePath, branch, baseBranch);
    const hasUncommitted = !(await git.isClean(worktreePath));

    // Get diff stats for each file
    const diffStats = await git.getDiffStats(worktreePath);
    const branchStats = await git.getDiffStatsBranch(worktreePath, branch, baseBranch);

    // Merge stats into file info
    const statsMap = new Map<string, { additions: number; deletions: number }>();
    for (const stat of [...diffStats, ...branchStats]) {
      const existing = statsMap.get(stat.path);
      if (existing) {
        existing.additions += stat.additions;
        existing.deletions += stat.deletions;
      } else {
        statsMap.set(stat.path, { additions: stat.additions, deletions: stat.deletions });
      }
    }

    // Enrich files with stats
    const enrichedFiles = files.map((f) => {
      const stat = statsMap.get(f.path);
      return {
        ...f,
        additions: stat?.additions ?? 0,
        deletions: stat?.deletions ?? 0,
      };
    });

    // Calculate summary
    let totalInsertions = 0;
    let totalDeletions = 0;
    for (const stat of statsMap.values()) {
      totalInsertions += stat.additions;
      totalDeletions += stat.deletions;
    }

    return {
      branch,
      files: enrichedFiles,
      commitsAhead: ahead,
      hasUncommittedChanges: hasUncommitted,
      summary: {
        filesChanged: enrichedFiles.length,
        insertions: totalInsertions,
        deletions: totalDeletions,
      },
    };
  }

  /**
   * Merge a worktree branch into the target branch
   */
  async merge(branch: string, options: MergeOptions = {}): Promise<MergeResult> {
    await this.ensureInitialized();

    const { targetBranch, message, deleteBranch, removeWorktree } = options;

    try {
      // Determine target branch
      const target = targetBranch || (await git.getDefaultBranch(this.repoPath));

      // Get the worktree path
      const worktreePath = this.getWorktreePath(branch);

      // Auto-commit any uncommitted changes in the worktree before merging
      const hasUncommitted = !(await git.isClean(worktreePath));
      if (hasUncommitted) {
        const commitMessage = `Auto-commit before merge: ${message || `Merge branch '${branch}'`}`;
        await git.commitAll(worktreePath, commitMessage);
        console.log(`[WorktreeManager] Auto-committed uncommitted changes in ${branch}`);
      }

      // Checkout target branch in the main repo
      await git.checkout(this.repoPath, target);

      // Merge the branch
      const mergeMessage = message || `Merge branch '${branch}'`;
      const mergeCommit = await git.merge(this.repoPath, branch, {
        message: mergeMessage,
        noFf: true,
      });

      // Clean up if requested
      if (removeWorktree) {
        await this.remove(branch, true);
      }

      if (deleteBranch) {
        await git.deleteBranch(this.repoPath, branch, true);
      }

      return {
        success: true,
        mergeCommit,
        hasConflicts: false,
        message: `Successfully merged '${branch}' into '${target}'`,
      };
    } catch (error) {
      if (error instanceof git.GitError && error.isConflict()) {
        const conflictedFiles = await git.getConflictedFiles(this.repoPath);
        return {
          success: false,
          hasConflicts: true,
          conflictedFiles,
          message: `Merge conflicts detected in ${conflictedFiles.length} file(s)`,
          error: 'Merge conflict detected',
        };
      }

      return {
        success: false,
        hasConflicts: false,
        message: error instanceof Error ? error.message : String(error),
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Abort a merge in progress
   */
  async abortMerge(): Promise<void> {
    await this.ensureInitialized();
    await git.abortMerge(this.repoPath);
  }
}

// ============================================================================
// SINGLETON MANAGEMENT
// ============================================================================

const managers: Map<string, WorktreeManager> = new Map();

/**
 * Get or create a WorktreeManager for a repository
 */
export function getWorktreeManager(repoPath: string): WorktreeManager {
  // Normalize the path
  const normalizedPath = path.resolve(repoPath);

  let manager = managers.get(normalizedPath);
  if (!manager) {
    manager = new WorktreeManager({ repoPath: normalizedPath });
    managers.set(normalizedPath, manager);
  }

  return manager;
}

/**
 * Clear all cached WorktreeManager instances
 */
export function clearWorktreeManagers(): void {
  managers.clear();
}
