/**
 * Git Utilities
 *
 * Low-level git operations used by WorktreeManager and other services.
 * All operations are async and spawn git subprocesses.
 */

import { spawn } from 'child_process';
import * as path from 'path';
import * as fs from 'fs/promises';
import type { FileChange, FileStatus } from '@acc/contracts';

// ============================================================================
// TYPES
// ============================================================================

export interface GitExecResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

export interface GitExecOptions {
  cwd?: string;
  timeout?: number;
}

// ============================================================================
// GIT COMMAND EXECUTION
// ============================================================================

/**
 * Execute a git command and return the result
 */
export async function gitExec(
  args: string[],
  options: GitExecOptions = {}
): Promise<GitExecResult> {
  const { cwd = process.cwd(), timeout = 30000 } = options;

  return new Promise((resolve, reject) => {
    const proc = spawn('git', args, {
      cwd,
      env: process.env,
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';

    proc.stdout.on('data', (data) => {
      stdout += data.toString();
    });

    proc.stderr.on('data', (data) => {
      stderr += data.toString();
    });

    const timeoutId = setTimeout(() => {
      proc.kill('SIGTERM');
      reject(new Error(`Git command timed out after ${timeout}ms: git ${args.join(' ')}`));
    }, timeout);

    proc.on('close', (exitCode) => {
      clearTimeout(timeoutId);
      resolve({
        stdout: stdout.trim(),
        stderr: stderr.trim(),
        exitCode: exitCode ?? 1,
      });
    });

    proc.on('error', (err) => {
      clearTimeout(timeoutId);
      reject(new Error(`Failed to execute git command: ${err.message}`));
    });
  });
}

/**
 * Execute a git command and throw on non-zero exit
 */
export async function git(args: string[], options: GitExecOptions = {}): Promise<string> {
  const result = await gitExec(args, options);

  if (result.exitCode !== 0) {
    throw new GitError(
      `Git command failed: git ${args.join(' ')}\n${result.stderr || result.stdout}`,
      result.exitCode,
      args
    );
  }

  return result.stdout;
}

// ============================================================================
// GIT ERROR
// ============================================================================

export class GitError extends Error {
  constructor(
    message: string,
    public exitCode: number,
    public args: string[]
  ) {
    super(message);
    this.name = 'GitError';
  }

  /** Check if this is a merge conflict error */
  isConflict(): boolean {
    return this.message.includes('CONFLICT') || this.message.includes('Merge conflict');
  }

  /** Check if this is a "not a git repository" error */
  isNotRepo(): boolean {
    return this.message.includes('not a git repository');
  }

  /** Check if this is a "branch already exists" error */
  isBranchExists(): boolean {
    return this.message.includes('already exists');
  }
}

// ============================================================================
// REPOSITORY OPERATIONS
// ============================================================================

/**
 * Check if a directory is a git repository
 */
export async function isGitRepo(dir: string): Promise<boolean> {
  try {
    await git(['rev-parse', '--git-dir'], { cwd: dir });
    return true;
  } catch {
    return false;
  }
}

/**
 * Get the root directory of a git repository
 */
export async function getRepoRoot(dir: string): Promise<string> {
  const result = await git(['rev-parse', '--show-toplevel'], { cwd: dir });
  return result;
}

/**
 * Get the repository name (directory name of repo root)
 */
export async function getRepoName(dir: string): Promise<string> {
  const root = await getRepoRoot(dir);
  return path.basename(root);
}

/**
 * Get the current branch name
 */
export async function getCurrentBranch(dir: string): Promise<string> {
  const result = await git(['branch', '--show-current'], { cwd: dir });
  return result || 'HEAD'; // Detached HEAD returns empty string
}

/**
 * Get the HEAD commit SHA
 */
export async function getHeadCommit(dir: string): Promise<string> {
  const result = await git(['rev-parse', 'HEAD'], { cwd: dir });
  return result;
}

/**
 * Get the default branch (main or master)
 */
export async function getDefaultBranch(dir: string): Promise<string> {
  try {
    // Try to get from remote
    const result = await git(['symbolic-ref', 'refs/remotes/origin/HEAD'], { cwd: dir });
    return result.replace('refs/remotes/origin/', '');
  } catch {
    // Fallback: check if main exists, else master
    try {
      await git(['rev-parse', '--verify', 'main'], { cwd: dir });
      return 'main';
    } catch {
      return 'master';
    }
  }
}

// ============================================================================
// BRANCH OPERATIONS
// ============================================================================

/** A branch entry with metadata */
export interface BranchEntry {
  name: string;
  isCurrent: boolean;
  isRemote: boolean;
}

/**
 * List all branches (local and remote) in a repository
 */
export async function listBranches(dir: string): Promise<BranchEntry[]> {
  const result = await git(['branch', '-a', '--no-color'], { cwd: dir });

  if (!result) {
    return [];
  }

  const branches: BranchEntry[] = [];
  const seenRemotes = new Set<string>();

  for (const line of result.split('\n')) {
    if (!line.trim()) continue;

    const isCurrent = line.startsWith('*');
    const branchName = line.replace(/^\*?\s+/, '').trim();

    // Skip HEAD pointer entries like "remotes/origin/HEAD -> origin/main"
    if (branchName.includes('->')) continue;

    // Check if it's a remote branch
    const isRemote = branchName.startsWith('remotes/');

    if (isRemote) {
      // Extract remote branch name (e.g., "remotes/origin/main" -> "origin/main")
      const remoteBranch = branchName.replace(/^remotes\//, '');

      // Skip if we've already seen this remote branch name
      // (can happen with multiple remotes)
      if (seenRemotes.has(remoteBranch)) continue;
      seenRemotes.add(remoteBranch);

      branches.push({
        name: remoteBranch,
        isCurrent: false,
        isRemote: true,
      });
    } else {
      branches.push({
        name: branchName,
        isCurrent,
        isRemote: false,
      });
    }
  }

  // Sort: local branches first, then remote, both alphabetically
  return branches.sort((a, b) => {
    if (a.isRemote !== b.isRemote) {
      return a.isRemote ? 1 : -1;
    }
    return a.name.localeCompare(b.name);
  });
}

/**
 * Check if a branch exists
 */
export async function branchExists(dir: string, branch: string): Promise<boolean> {
  try {
    await git(['rev-parse', '--verify', branch], { cwd: dir });
    return true;
  } catch {
    return false;
  }
}

/**
 * Create a new branch from a base
 */
export async function createBranch(
  dir: string,
  branch: string,
  baseBranch?: string
): Promise<void> {
  const args = ['branch', branch];
  if (baseBranch) {
    args.push(baseBranch);
  }
  await git(args, { cwd: dir });
}

/**
 * Delete a branch
 */
export async function deleteBranch(
  dir: string,
  branch: string,
  force: boolean = false
): Promise<void> {
  const flag = force ? '-D' : '-d';
  await git(['branch', flag, branch], { cwd: dir });
}

/**
 * Checkout a branch
 */
export async function checkout(dir: string, branch: string): Promise<void> {
  await git(['checkout', branch], { cwd: dir });
}

// ============================================================================
// WORKTREE OPERATIONS
// ============================================================================

export interface WorktreeListEntry {
  path: string;
  head: string;
  branch: string | null;
  isLocked: boolean;
  lockReason?: string;
  isBare: boolean;
}

/**
 * List all worktrees in a repository
 */
export async function listWorktrees(dir: string): Promise<WorktreeListEntry[]> {
  const result = await git(['worktree', 'list', '--porcelain'], { cwd: dir });

  if (!result) {
    return [];
  }

  const entries: WorktreeListEntry[] = [];
  let current: Partial<WorktreeListEntry> = {};

  for (const line of result.split('\n')) {
    if (line.startsWith('worktree ')) {
      // Start of new entry
      if (current.path) {
        entries.push(current as WorktreeListEntry);
      }
      current = {
        path: line.substring('worktree '.length),
        isLocked: false,
        isBare: false,
      };
    } else if (line.startsWith('HEAD ')) {
      current.head = line.substring('HEAD '.length);
    } else if (line.startsWith('branch ')) {
      // Format: branch refs/heads/branch-name
      current.branch = line.substring('branch refs/heads/'.length);
    } else if (line === 'detached') {
      current.branch = null;
    } else if (line === 'bare') {
      current.isBare = true;
    } else if (line === 'locked') {
      current.isLocked = true;
    } else if (line.startsWith('locked ')) {
      current.isLocked = true;
      current.lockReason = line.substring('locked '.length);
    }
  }

  // Don't forget the last entry
  if (current.path) {
    entries.push(current as WorktreeListEntry);
  }

  return entries;
}

/**
 * Add a new worktree
 */
export async function addWorktree(
  repoDir: string,
  worktreePath: string,
  branch: string,
  options: {
    createBranch?: boolean;
    baseBranch?: string;
  } = {}
): Promise<void> {
  const args = ['worktree', 'add'];

  if (options.createBranch) {
    args.push('-b', branch);
    args.push(worktreePath);
    if (options.baseBranch) {
      args.push(options.baseBranch);
    }
  } else {
    args.push(worktreePath, branch);
  }

  await git(args, { cwd: repoDir });
}

/**
 * Remove a worktree
 */
export async function removeWorktree(
  repoDir: string,
  worktreePath: string,
  force: boolean = false
): Promise<void> {
  const args = ['worktree', 'remove'];
  if (force) {
    args.push('--force');
  }
  args.push(worktreePath);

  await git(args, { cwd: repoDir });
}

/**
 * Lock a worktree
 */
export async function lockWorktree(
  repoDir: string,
  worktreePath: string,
  reason?: string
): Promise<void> {
  const args = ['worktree', 'lock'];
  if (reason) {
    args.push('--reason', reason);
  }
  args.push(worktreePath);

  await git(args, { cwd: repoDir });
}

/**
 * Unlock a worktree
 */
export async function unlockWorktree(repoDir: string, worktreePath: string): Promise<void> {
  await git(['worktree', 'unlock', worktreePath], { cwd: repoDir });
}

/**
 * Prune stale worktree entries
 */
export async function pruneWorktrees(repoDir: string): Promise<void> {
  await git(['worktree', 'prune'], { cwd: repoDir });
}

// ============================================================================
// STATUS OPERATIONS
// ============================================================================

/**
 * Check if the working directory is clean (no uncommitted changes)
 */
export async function isClean(dir: string): Promise<boolean> {
  const result = await git(['status', '--porcelain'], { cwd: dir });
  return result === '';
}

/**
 * Get the list of changed files
 */
export async function getChangedFiles(dir: string): Promise<FileChange[]> {
  const result = await git(['status', '--porcelain'], { cwd: dir });

  if (!result) {
    return [];
  }

  const changes: FileChange[] = [];

  for (const line of result.split('\n')) {
    if (!line) continue;

    const statusCode = line.substring(0, 2);
    const filePath = line.substring(3);

    // Handle renamed files (R  old -> new)
    let finalPath = filePath;
    let originalPath: string | undefined;

    if (filePath.includes(' -> ')) {
      const [old, newPath] = filePath.split(' -> ');
      originalPath = old;
      finalPath = newPath;
    }

    const status = parseStatusCode(statusCode);
    changes.push({
      path: finalPath,
      status,
      originalPath,
    });
  }

  return changes;
}

function parseStatusCode(code: string): FileStatus {
  const index = code[0];
  const workTree = code[1];

  // Check index status first, then work tree
  const char = index !== ' ' && index !== '?' ? index : workTree;

  switch (char) {
    case 'M':
      return 'modified';
    case 'A':
      return 'added';
    case 'D':
      return 'deleted';
    case 'R':
      return 'renamed';
    case 'C':
      return 'copied';
    case '?':
      return 'untracked';
    case '!':
      return 'ignored';
    default:
      return 'modified';
  }
}

/** Stats for a file diff */
export interface DiffStats {
  path: string;
  additions: number;
  deletions: number;
}

/**
 * Get diff stats (additions/deletions per file) for uncommitted changes
 */
export async function getDiffStats(dir: string): Promise<DiffStats[]> {
  const stats: DiffStats[] = [];

  // Get stats for staged + unstaged changes on tracked files
  const result = await git(['diff', '--numstat', 'HEAD'], { cwd: dir });

  if (result) {
    for (const line of result.split('\n')) {
      if (!line) continue;

      const parts = line.split('\t');
      if (parts.length < 3) continue;

      const [adds, dels, filePath] = parts;
      // Binary files show '-' for additions/deletions
      stats.push({
        path: filePath,
        additions: adds === '-' ? 0 : parseInt(adds, 10) || 0,
        deletions: dels === '-' ? 0 : parseInt(dels, 10) || 0,
      });
    }
  }

  // Also get stats for untracked files (new files not yet staged)
  // These won't appear in git diff, so we need to count lines separately
  const statusResult = await git(['status', '--porcelain'], { cwd: dir });
  if (statusResult) {
    const fs = await import('fs/promises');
    const pathMod = await import('path');

    for (const line of statusResult.split('\n')) {
      if (!line) continue;

      const statusCode = line.substring(0, 2);
      const filePath = line.substring(3);

      // Untracked files have ?? status
      if (statusCode === '??') {
        // Count lines in untracked file
        try {
          const fullPath = pathMod.join(dir, filePath);
          const content = await fs.readFile(fullPath, 'utf-8');
          const lineCount = content.split('\n').length;
          stats.push({
            path: filePath,
            additions: lineCount,
            deletions: 0,
          });
        } catch {
          // File might be binary or unreadable, skip it
          stats.push({
            path: filePath,
            additions: 0,
            deletions: 0,
          });
        }
      }
    }
  }

  return stats;
}

/**
 * Get diff stats comparing a branch to its base
 */
export async function getDiffStatsBranch(
  dir: string,
  branch: string,
  baseBranch: string
): Promise<DiffStats[]> {
  const result = await git(['diff', '--numstat', `${baseBranch}...${branch}`], { cwd: dir });

  if (!result) {
    return [];
  }

  const stats: DiffStats[] = [];

  for (const line of result.split('\n')) {
    if (!line) continue;

    const parts = line.split('\t');
    if (parts.length < 3) continue;

    const [adds, dels, path] = parts;
    stats.push({
      path,
      additions: adds === '-' ? 0 : parseInt(adds, 10) || 0,
      deletions: dels === '-' ? 0 : parseInt(dels, 10) || 0,
    });
  }

  return stats;
}

/**
 * Get the number of commits a branch is ahead of another
 */
export async function commitsAhead(
  dir: string,
  branch: string,
  baseBranch: string
): Promise<number> {
  try {
    const result = await git(
      ['rev-list', '--count', `${baseBranch}..${branch}`],
      { cwd: dir }
    );
    return parseInt(result, 10) || 0;
  } catch {
    return 0;
  }
}

// ============================================================================
// COMMIT OPERATIONS
// ============================================================================

/**
 * Stage all changes and commit
 * @returns The commit SHA, or null if there was nothing to commit
 */
export async function commitAll(
  dir: string,
  message: string
): Promise<string | null> {
  // Check if there are any changes to commit
  const clean = await isClean(dir);
  if (clean) {
    return null; // Nothing to commit
  }

  // Stage all changes (including untracked files)
  await git(['add', '-A'], { cwd: dir });

  // Commit
  await git(['commit', '-m', message], { cwd: dir });

  // Return the commit SHA
  return getHeadCommit(dir);
}

// ============================================================================
// MERGE OPERATIONS
// ============================================================================

/**
 * Merge a branch into the current branch
 */
export async function merge(
  dir: string,
  branch: string,
  options: {
    message?: string;
    noFf?: boolean;
  } = {}
): Promise<string> {
  const args = ['merge', branch];

  if (options.noFf) {
    args.push('--no-ff');
  }

  if (options.message) {
    args.push('-m', options.message);
  }

  await git(args, { cwd: dir });

  // Return the new HEAD commit
  return getHeadCommit(dir);
}

/**
 * Get files with merge conflicts
 */
export async function getConflictedFiles(dir: string): Promise<string[]> {
  const result = await git(['diff', '--name-only', '--diff-filter=U'], { cwd: dir });

  if (!result) {
    return [];
  }

  return result.split('\n').filter(Boolean);
}

/**
 * Abort a merge in progress
 */
export async function abortMerge(dir: string): Promise<void> {
  await git(['merge', '--abort'], { cwd: dir });
}

// ============================================================================
// DIRECTORY UTILITIES
// ============================================================================

/**
 * Ensure a directory exists
 */
export async function ensureDir(dir: string): Promise<void> {
  await fs.mkdir(dir, { recursive: true });
}

/**
 * Check if a directory exists
 */
export async function dirExists(dir: string): Promise<boolean> {
  try {
    const stat = await fs.stat(dir);
    return stat.isDirectory();
  } catch {
    return false;
  }
}

/**
 * Sanitize a branch name for use as a directory name
 * Replaces slashes with hyphens
 */
export function sanitizeBranchName(branch: string): string {
  return branch.replace(/\//g, '-');
}
