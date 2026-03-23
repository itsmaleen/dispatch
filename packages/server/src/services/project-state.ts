/**
 * Project State Service
 *
 * Manages per-project workspace state persistence.
 * Saves and restores terminals, consoles, layout, and UI state.
 *
 * State files are stored in ~/.merry/project-states/<hash>.json
 * where hash is a SHA-256 of the project path (first 16 chars).
 */

import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import type { ProjectState } from '@acc/contracts';

// ============================================================================
// CONFIGURATION
// ============================================================================

const STATE_DIR = process.env.ACC_STATE_DIR || path.join(process.env.HOME || '~', '.merry');
const PROJECT_STATES_DIR = path.join(STATE_DIR, 'project-states');

// ============================================================================
// PROJECT STATE SERVICE
// ============================================================================

export class ProjectStateService {
  private statesDir: string;

  constructor(statesDir: string = PROJECT_STATES_DIR) {
    this.statesDir = statesDir;
    this.ensureDirectory();
  }

  /**
   * Ensure the project-states directory exists
   */
  private ensureDirectory(): void {
    if (!fs.existsSync(this.statesDir)) {
      fs.mkdirSync(this.statesDir, { recursive: true });
    }
  }

  /**
   * Generate a hash-based filename for a project path.
   * Uses SHA-256, truncated to 16 chars for filesystem safety.
   */
  private hashProjectPath(projectPath: string): string {
    // Normalize the path for consistent hashing
    const normalized = path.resolve(projectPath);
    const hash = crypto.createHash('sha256').update(normalized).digest('hex');
    return hash.slice(0, 16);
  }

  /**
   * Get the file path for a project's state file
   */
  private getStateFilePath(projectPath: string): string {
    const hash = this.hashProjectPath(projectPath);
    return path.join(this.statesDir, `${hash}.json`);
  }

  /**
   * Save project state to disk.
   * Uses atomic write (write to temp, then rename) for crash safety.
   */
  async save(projectPath: string, state: ProjectState): Promise<void> {
    const filePath = this.getStateFilePath(projectPath);
    const tempPath = `${filePath}.tmp.${Date.now()}`;

    // Ensure state has current timestamp
    const stateToSave: ProjectState = {
      ...state,
      projectPath: path.resolve(projectPath),
      savedAt: new Date().toISOString(),
    };

    try {
      // Write to temp file
      const content = JSON.stringify(stateToSave, null, 2);
      await fs.promises.writeFile(tempPath, content, 'utf-8');

      // Atomic rename
      await fs.promises.rename(tempPath, filePath);

      console.log(`[ProjectStateService] Saved state for: ${projectPath}`);
    } catch (error) {
      // Clean up temp file on error
      try {
        await fs.promises.unlink(tempPath);
      } catch {
        // Ignore cleanup errors
      }
      throw error;
    }
  }

  /**
   * Load project state from disk.
   * Returns null if no state file exists or if it's invalid.
   */
  async load(projectPath: string): Promise<ProjectState | null> {
    const filePath = this.getStateFilePath(projectPath);

    if (!fs.existsSync(filePath)) {
      return null;
    }

    try {
      const content = await fs.promises.readFile(filePath, 'utf-8');
      const state = JSON.parse(content) as ProjectState;

      // Validate and migrate if needed
      const migrated = this.migrateState(state);

      // Verify project path matches (in case of hash collision)
      const normalizedPath = path.resolve(projectPath);
      if (migrated.projectPath !== normalizedPath) {
        console.warn(
          `[ProjectStateService] Hash collision detected: ${projectPath} -> ${migrated.projectPath}`
        );
        return null;
      }

      return migrated;
    } catch (error) {
      console.error(`[ProjectStateService] Failed to load state for: ${projectPath}`, error);
      return null;
    }
  }

  /**
   * Check if a state file exists for a project
   */
  async exists(projectPath: string): Promise<boolean> {
    const filePath = this.getStateFilePath(projectPath);
    return fs.existsSync(filePath);
  }

  /**
   * Delete a project's state file
   */
  async delete(projectPath: string): Promise<boolean> {
    const filePath = this.getStateFilePath(projectPath);

    if (!fs.existsSync(filePath)) {
      return false;
    }

    try {
      await fs.promises.unlink(filePath);
      console.log(`[ProjectStateService] Deleted state for: ${projectPath}`);
      return true;
    } catch (error) {
      console.error(`[ProjectStateService] Failed to delete state for: ${projectPath}`, error);
      return false;
    }
  }

  /**
   * List all saved project states
   */
  async list(): Promise<Array<{ projectPath: string; savedAt: string }>> {
    const result: Array<{ projectPath: string; savedAt: string }> = [];

    try {
      const files = await fs.promises.readdir(this.statesDir);

      for (const file of files) {
        if (!file.endsWith('.json')) continue;

        const filePath = path.join(this.statesDir, file);
        try {
          const content = await fs.promises.readFile(filePath, 'utf-8');
          const state = JSON.parse(content) as ProjectState;
          result.push({
            projectPath: state.projectPath,
            savedAt: state.savedAt,
          });
        } catch {
          // Skip invalid files
          console.warn(`[ProjectStateService] Skipping invalid state file: ${file}`);
        }
      }

      // Sort by savedAt (most recent first)
      result.sort((a, b) => b.savedAt.localeCompare(a.savedAt));

      return result;
    } catch (error) {
      console.error('[ProjectStateService] Failed to list states:', error);
      return [];
    }
  }

  /**
   * Migrate older state versions to current format.
   * This ensures backwards compatibility as the schema evolves.
   */
  private migrateState(state: unknown): ProjectState {
    // Type guard: ensure it's an object
    if (typeof state !== 'object' || state === null) {
      throw new Error('Invalid state: not an object');
    }

    const obj = state as Record<string, unknown>;

    // Handle missing version (pre-versioning state files)
    if (!obj.version) {
      (obj as { version: number }).version = 1;
    }

    // Future migrations go here:
    // if (obj.version === 1) {
    //   // Migrate v1 -> v2
    //   obj.version = 2;
    // }

    // Ensure required fields have defaults
    const migrated: ProjectState = {
      version: 1,
      projectPath: obj.projectPath as string || '',
      savedAt: obj.savedAt as string || new Date().toISOString(),
      terminals: Array.isArray(obj.terminals) ? obj.terminals : [],
      consoles: Array.isArray(obj.consoles) ? obj.consoles : [],
      layoutTree: (obj.layoutTree as ProjectState['layoutTree']) ?? null,
      focusedWidgetId: (obj.focusedWidgetId as string) ?? null,
      tasksVisible: typeof obj.tasksVisible === 'boolean' ? obj.tasksVisible : true,
      showAgentStatus: typeof obj.showAgentStatus === 'boolean' ? obj.showAgentStatus : true,
    };

    return migrated;
  }

  /**
   * Clean up stale state files (for projects that no longer exist).
   * Optional maintenance operation.
   */
  async cleanupStale(): Promise<number> {
    let cleaned = 0;
    const states = await this.list();

    for (const { projectPath } of states) {
      if (!fs.existsSync(projectPath)) {
        console.log(`[ProjectStateService] Cleaning up stale state: ${projectPath}`);
        await this.delete(projectPath);
        cleaned++;
      }
    }

    return cleaned;
  }
}

// ============================================================================
// SINGLETON
// ============================================================================

let projectStateServiceInstance: ProjectStateService | null = null;

export function getProjectStateService(): ProjectStateService {
  if (!projectStateServiceInstance) {
    projectStateServiceInstance = new ProjectStateService();
  }
  return projectStateServiceInstance;
}

export function resetProjectStateService(): void {
  projectStateServiceInstance = null;
}
