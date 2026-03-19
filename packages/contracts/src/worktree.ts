/**
 * Worktree Contracts
 *
 * Types and interfaces for git worktree management.
 * Worktrees provide isolated working directories for parallel agent execution.
 */

// ============================================================================
// WORKTREE INFO
// ============================================================================

/** Information about a git worktree */
export interface WorktreeInfo {
  /** Absolute path to the worktree directory */
  path: string;

  /** Branch name checked out in this worktree (e.g., "feature/auth") */
  branch: string;

  /** The base branch this was created from (e.g., "main") */
  baseBranch: string;

  /** HEAD commit SHA */
  commitSha: string;

  /** When this worktree was created */
  createdAt: Date;

  /** Whether there are uncommitted changes */
  isClean: boolean;

  /** Whether this is the main worktree (the original repo) */
  isMain: boolean;

  /** Whether this worktree is locked (prevents accidental deletion) */
  isLocked: boolean;

  /** Optional reason for locking */
  lockReason?: string;
}

/** Options for creating a new worktree */
export interface CreateWorktreeOptions {
  /** Branch name to create (e.g., "feature/auth") */
  branch: string;

  /** Base branch to branch from (default: current branch or "main") */
  baseBranch?: string;

  /** Custom path for the worktree (default: ~/.acc/worktrees/{repo}/{branch}) */
  path?: string;

  /** Whether to lock the worktree after creation */
  lock?: boolean;

  /** Reason for locking (if lock is true) */
  lockReason?: string;
}

/** Result of creating a worktree */
export interface CreateWorktreeResult {
  success: boolean;
  worktree?: WorktreeInfo;
  error?: string;
}

/** Result of removing a worktree */
export interface RemoveWorktreeResult {
  success: boolean;
  error?: string;
}

// ============================================================================
// WORKTREE EVENTS
// ============================================================================

/** Events emitted by WorktreeManager */
export type WorktreeEvent =
  | { type: 'worktree:created'; worktree: WorktreeInfo }
  | { type: 'worktree:removed'; branch: string; path: string }
  | { type: 'worktree:locked'; branch: string; reason?: string }
  | { type: 'worktree:unlocked'; branch: string }
  | { type: 'worktree:error'; branch: string; error: string };

// ============================================================================
// WORKTREE MANAGER INTERFACE
// ============================================================================

/** Interface for worktree management operations */
export interface IWorktreeManager {
  /**
   * Create a new worktree for isolated agent work
   * @param options - Worktree creation options
   * @returns Result with worktree info or error
   */
  create(options: CreateWorktreeOptions): Promise<CreateWorktreeResult>;

  /**
   * Remove a worktree (after merge or discard)
   * @param branch - Branch name of the worktree to remove
   * @param force - Force removal even if there are uncommitted changes
   * @returns Result indicating success or error
   */
  remove(branch: string, force?: boolean): Promise<RemoveWorktreeResult>;

  /**
   * List all worktrees for the current repository
   * @returns Array of worktree info
   */
  list(): Promise<WorktreeInfo[]>;

  /**
   * Get information about a specific worktree
   * @param branch - Branch name to look up
   * @returns Worktree info or null if not found
   */
  get(branch: string): Promise<WorktreeInfo | null>;

  /**
   * Check if a worktree exists for a branch
   * @param branch - Branch name to check
   * @returns True if worktree exists
   */
  exists(branch: string): Promise<boolean>;

  /**
   * Lock a worktree to prevent accidental deletion
   * @param branch - Branch name of the worktree to lock
   * @param reason - Optional reason for locking
   */
  lock(branch: string, reason?: string): Promise<void>;

  /**
   * Unlock a previously locked worktree
   * @param branch - Branch name of the worktree to unlock
   */
  unlock(branch: string): Promise<void>;

  /**
   * Prune stale worktree references
   * Removes worktree entries that point to non-existent directories
   */
  prune(): Promise<void>;

  /**
   * Get the repository root path
   */
  getRepoPath(): string;

  /**
   * Get the worktrees base directory
   * Default: ~/.acc/worktrees/{repo-name}/
   */
  getWorktreesDir(): string;
}

// ============================================================================
// GIT STATUS TYPES
// ============================================================================

/** Status of a file in the working tree */
export type FileStatus =
  | 'modified'
  | 'added'
  | 'deleted'
  | 'renamed'
  | 'copied'
  | 'untracked'
  | 'ignored';

/** A file with its status */
export interface FileChange {
  path: string;
  status: FileStatus;
  /** For renamed/copied files, the original path */
  originalPath?: string;
  /** Number of lines added (from diff stats) */
  additions?: number;
  /** Number of lines deleted (from diff stats) */
  deletions?: number;
}

/** Summary statistics for changes */
export interface ChangesSummary {
  /** Number of files changed */
  filesChanged: number;
  /** Total lines added */
  insertions: number;
  /** Total lines deleted */
  deletions: number;
}

/** Summary of changes in a worktree */
export interface WorktreeChanges {
  /** Branch name */
  branch: string;
  /** Files that have been modified */
  files: FileChange[];
  /** Number of commits ahead of base branch */
  commitsAhead: number;
  /** Whether there are uncommitted changes */
  hasUncommittedChanges: boolean;
  /** Summary statistics */
  summary: ChangesSummary;
}

// ============================================================================
// MERGE TYPES
// ============================================================================

/** Result of attempting to merge a branch */
export interface MergeResult {
  success: boolean;
  /** Commit SHA of the merge commit (if successful) */
  mergeCommit?: string;
  /** Whether the merge has conflicts */
  hasConflicts?: boolean;
  /** Files with conflicts (if merge failed) */
  conflictedFiles?: string[];
  /** Human-readable message about the merge result */
  message?: string;
  /** Error message (if merge failed) */
  error?: string;
}

/** Options for merging a worktree branch */
export interface MergeOptions {
  /** Target branch to merge into (default: base branch) */
  targetBranch?: string;
  /** Commit message for the merge */
  message?: string;
  /** Whether to delete the branch after successful merge */
  deleteBranch?: boolean;
  /** Whether to remove the worktree after successful merge */
  removeWorktree?: boolean;
}
