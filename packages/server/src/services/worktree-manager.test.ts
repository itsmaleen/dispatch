/**
 * WorktreeManager Tests
 *
 * Integration tests for worktree management.
 * These tests create actual git worktrees in a temporary directory.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import * as path from 'path';
import * as fs from 'fs/promises';
import * as os from 'os';
import { WorktreeManager } from './worktree-manager';
import * as git from './git';

// ============================================================================
// TEST UTILITIES
// ============================================================================

interface TestRepo {
  path: string;
  cleanup: () => Promise<void>;
}

/**
 * Create a temporary git repository for testing
 */
async function createTestRepo(): Promise<TestRepo> {
  const tempDir = path.join(os.tmpdir(), `acc-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  await fs.mkdir(tempDir, { recursive: true });

  // Initialize git repo
  await git.git(['init'], { cwd: tempDir });
  await git.git(['config', 'user.email', 'test@example.com'], { cwd: tempDir });
  await git.git(['config', 'user.name', 'Test User'], { cwd: tempDir });

  // Create initial commit (git worktree requires at least one commit)
  const readmePath = path.join(tempDir, 'README.md');
  await fs.writeFile(readmePath, '# Test Repository\n');
  await git.git(['add', '.'], { cwd: tempDir });
  await git.git(['commit', '-m', 'Initial commit'], { cwd: tempDir });

  // Create main branch (some git versions default to 'master')
  try {
    await git.git(['branch', '-M', 'main'], { cwd: tempDir });
  } catch {
    // Branch might already be named main
  }

  return {
    path: tempDir,
    cleanup: async () => {
      try {
        await fs.rm(tempDir, { recursive: true, force: true });
      } catch {
        // Ignore cleanup errors
      }
    },
  };
}

// ============================================================================
// GIT UTILITIES TESTS
// ============================================================================

describe('git utilities', () => {
  let testRepo: TestRepo;

  beforeAll(async () => {
    testRepo = await createTestRepo();
  });

  afterAll(async () => {
    await testRepo.cleanup();
  });

  describe('isGitRepo', () => {
    it('should return true for a git repository', async () => {
      const result = await git.isGitRepo(testRepo.path);
      expect(result).toBe(true);
    });

    it('should return false for a non-git directory', async () => {
      const result = await git.isGitRepo(os.tmpdir());
      expect(result).toBe(false);
    });
  });

  describe('getRepoRoot', () => {
    it('should return the repository root', async () => {
      const root = await git.getRepoRoot(testRepo.path);
      // On macOS, /var is a symlink to /private/var, so we normalize both
      const normalizedRoot = await fs.realpath(root);
      const normalizedTestPath = await fs.realpath(testRepo.path);
      expect(normalizedRoot).toBe(normalizedTestPath);
    });
  });

  describe('getRepoName', () => {
    it('should return the repository name', async () => {
      const name = await git.getRepoName(testRepo.path);
      expect(name).toMatch(/^acc-test-/);
    });
  });

  describe('getCurrentBranch', () => {
    it('should return the current branch name', async () => {
      const branch = await git.getCurrentBranch(testRepo.path);
      expect(branch).toBe('main');
    });
  });

  describe('branchExists', () => {
    it('should return true for existing branch', async () => {
      const exists = await git.branchExists(testRepo.path, 'main');
      expect(exists).toBe(true);
    });

    it('should return false for non-existing branch', async () => {
      const exists = await git.branchExists(testRepo.path, 'non-existent-branch');
      expect(exists).toBe(false);
    });
  });

  describe('sanitizeBranchName', () => {
    it('should replace slashes with hyphens', () => {
      expect(git.sanitizeBranchName('feature/auth')).toBe('feature-auth');
      expect(git.sanitizeBranchName('feature/nested/branch')).toBe('feature-nested-branch');
    });

    it('should leave simple names unchanged', () => {
      expect(git.sanitizeBranchName('main')).toBe('main');
      expect(git.sanitizeBranchName('develop')).toBe('develop');
    });
  });
});

// ============================================================================
// WORKTREE MANAGER TESTS
// ============================================================================

describe('WorktreeManager', () => {
  let testRepo: TestRepo;
  let manager: WorktreeManager;
  let worktreesDir: string;

  beforeAll(async () => {
    testRepo = await createTestRepo();
    worktreesDir = path.join(os.tmpdir(), `acc-worktrees-${Date.now()}`);
  });

  afterAll(async () => {
    await testRepo.cleanup();
    try {
      await fs.rm(worktreesDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  beforeEach(() => {
    manager = new WorktreeManager({
      repoPath: testRepo.path,
      worktreesBaseDir: worktreesDir,
    });
  });

  describe('getRepoPath', () => {
    it('should return the repository path', () => {
      expect(manager.getRepoPath()).toBe(testRepo.path);
    });
  });

  describe('create', () => {
    afterEach(async () => {
      // Clean up any worktrees created during tests
      try {
        await manager.remove('feature/test-1', true);
      } catch {
        // Ignore if worktree doesn't exist
      }
    });

    it('should create a new worktree with a new branch', async () => {
      const result = await manager.create({
        branch: 'feature/test-1',
        baseBranch: 'main',
      });

      expect(result.success).toBe(true);
      expect(result.worktree).toBeDefined();
      expect(result.worktree!.branch).toBe('feature/test-1');
      expect(result.worktree!.baseBranch).toBe('main');
      expect(result.worktree!.isMain).toBe(false);
    });

    it('should fail if branch already has a worktree', async () => {
      // Create first worktree
      await manager.create({ branch: 'feature/test-1' });

      // Try to create another with the same branch
      const result = await manager.create({ branch: 'feature/test-1' });

      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
    });
  });

  describe('list', () => {
    beforeEach(async () => {
      // Create a test worktree
      await manager.create({ branch: 'feature/list-test' });
    });

    afterEach(async () => {
      try {
        await manager.remove('feature/list-test', true);
      } catch {
        // Ignore
      }
    });

    it('should list all worktrees including main', async () => {
      const worktrees = await manager.list();

      // Should have at least main + our test worktree
      expect(worktrees.length).toBeGreaterThanOrEqual(2);

      const main = worktrees.find((w) => w.isMain);
      expect(main).toBeDefined();

      const testWorktree = worktrees.find((w) => w.branch === 'feature/list-test');
      expect(testWorktree).toBeDefined();
    });
  });

  describe('get', () => {
    beforeEach(async () => {
      await manager.create({ branch: 'feature/get-test' });
    });

    afterEach(async () => {
      try {
        await manager.remove('feature/get-test', true);
      } catch {
        // Ignore
      }
    });

    it('should return worktree info for existing branch', async () => {
      const info = await manager.get('feature/get-test');

      expect(info).not.toBeNull();
      expect(info!.branch).toBe('feature/get-test');
    });

    it('should return null for non-existing branch', async () => {
      const info = await manager.get('non-existent-branch');
      expect(info).toBeNull();
    });
  });

  describe('exists', () => {
    beforeEach(async () => {
      await manager.create({ branch: 'feature/exists-test' });
    });

    afterEach(async () => {
      try {
        await manager.remove('feature/exists-test', true);
      } catch {
        // Ignore
      }
    });

    it('should return true for existing worktree', async () => {
      const exists = await manager.exists('feature/exists-test');
      expect(exists).toBe(true);
    });

    it('should return false for non-existing worktree', async () => {
      const exists = await manager.exists('non-existent-branch');
      expect(exists).toBe(false);
    });
  });

  describe('remove', () => {
    it('should remove an existing worktree', async () => {
      await manager.create({ branch: 'feature/remove-test' });

      const result = await manager.remove('feature/remove-test');

      expect(result.success).toBe(true);
      expect(await manager.exists('feature/remove-test')).toBe(false);
    });

    it('should fail when removing non-existing worktree', async () => {
      const result = await manager.remove('non-existent-branch');

      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
    });
  });

  describe('lock/unlock', () => {
    beforeEach(async () => {
      await manager.create({ branch: 'feature/lock-test' });
    });

    afterEach(async () => {
      try {
        await manager.unlock('feature/lock-test');
        await manager.remove('feature/lock-test', true);
      } catch {
        // Ignore
      }
    });

    it('should lock a worktree', async () => {
      await manager.lock('feature/lock-test', 'Testing lock');

      const info = await manager.get('feature/lock-test');
      expect(info!.isLocked).toBe(true);
      expect(info!.lockReason).toBe('Testing lock');
    });

    it('should unlock a worktree', async () => {
      await manager.lock('feature/lock-test');
      await manager.unlock('feature/lock-test');

      const info = await manager.get('feature/lock-test');
      expect(info!.isLocked).toBe(false);
    });
  });

  describe('getChanges', () => {
    beforeEach(async () => {
      await manager.create({ branch: 'feature/changes-test' });
    });

    afterEach(async () => {
      try {
        await manager.remove('feature/changes-test', true);
      } catch {
        // Ignore
      }
    });

    it('should return empty changes for clean worktree', async () => {
      const changes = await manager.getChanges('feature/changes-test');

      expect(changes).not.toBeNull();
      expect(changes!.files).toHaveLength(0);
      expect(changes!.hasUncommittedChanges).toBe(false);
    });

    it('should detect file changes', async () => {
      const info = await manager.get('feature/changes-test');
      const filePath = path.join(info!.path, 'test-file.txt');
      await fs.writeFile(filePath, 'test content');

      const changes = await manager.getChanges('feature/changes-test');

      expect(changes!.hasUncommittedChanges).toBe(true);
      expect(changes!.files.length).toBeGreaterThan(0);
    });
  });

  describe('merge', () => {
    it('should auto-commit uncommitted changes before merge', async () => {
      // Create a worktree
      await manager.create({ branch: 'feature/merge-test' });
      const info = await manager.get('feature/merge-test');

      // Create an uncommitted file
      const filePath = path.join(info!.path, 'merge-test-file.txt');
      await fs.writeFile(filePath, 'test content for merge');

      // Verify the file is uncommitted
      const changesBefore = await manager.getChanges('feature/merge-test');
      expect(changesBefore!.hasUncommittedChanges).toBe(true);

      // Merge (this should auto-commit first)
      const result = await manager.merge('feature/merge-test', {
        targetBranch: 'main',
        removeWorktree: true,
      });

      expect(result.success).toBe(true);

      // Verify the file exists in the main repo after merge
      const mainRepoFilePath = path.join(manager.getRepoPath(), 'merge-test-file.txt');
      const fileExists = await fs.access(mainRepoFilePath).then(() => true).catch(() => false);
      expect(fileExists).toBe(true);

      // Clean up the test file from main
      await fs.unlink(mainRepoFilePath);
      // Commit the deletion
      const git = await import('./git');
      await git.commitAll(manager.getRepoPath(), 'Clean up merge test file');
    });
  });

  describe('events', () => {
    it('should emit worktree:created event', async () => {
      const events: any[] = [];
      manager.on('worktree:created', (worktree) => events.push(worktree));

      await manager.create({ branch: 'feature/event-test' });

      expect(events).toHaveLength(1);
      expect(events[0].branch).toBe('feature/event-test');

      // Cleanup
      await manager.remove('feature/event-test', true);
    });

    it('should emit worktree:removed event', async () => {
      await manager.create({ branch: 'feature/remove-event-test' });

      const events: any[] = [];
      manager.on('worktree:removed', (branch, path) => events.push({ branch, path }));

      await manager.remove('feature/remove-event-test');

      expect(events).toHaveLength(1);
      expect(events[0].branch).toBe('feature/remove-event-test');
    });
  });
});
