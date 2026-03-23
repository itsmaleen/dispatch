/**
 * Project State Contracts
 *
 * Types for persisting and restoring workspace state per project.
 * Allows users to resume exactly where they left off when reopening a project folder.
 */

import type { LayoutNode } from './widget';

// ============================================================================
// SAVED STATE TYPES
// ============================================================================

/**
 * Saved terminal state for restoration.
 * Contains enough info to recreate a terminal with the same configuration.
 */
export interface SavedTerminalState {
  /** Original terminal ID (for layout tree mapping) */
  id: string;

  /** Human-readable name */
  name: string;

  /** Working directory (relative to project root, or absolute if outside) */
  cwd: string;

  /** Initial command to run on restore (for auto-restart terminals like dev servers) */
  initialCommand?: string;

  /** User-defined labels */
  labels?: Record<string, string>;

  /** Who created this terminal */
  createdBy?: 'user' | 'agent';
}

/**
 * Saved console state for restoration.
 * Contains enough info to reconnect to an existing session or create a fresh one.
 */
export interface SavedConsoleState {
  /** Original console ID (for layout tree mapping) */
  id: string;

  /** Thread ID for session resume */
  threadId?: string;

  /** Claude Code SDK session ID for session resume */
  sessionId?: string;

  /** Human-readable label */
  label?: string;

  /** Accent color for visual identification */
  accentColor?: string;

  /** Working directory override */
  cwd?: string;

  /** Git worktree path (if using isolated worktree) */
  worktreePath?: string;

  /** Git worktree branch name */
  worktreeBranch?: string;
}

/**
 * Complete project state snapshot.
 * Serialized to JSON and stored in ~/.dispatch/project-states/<hash>.json
 */
export interface ProjectState {
  /** Schema version for future migrations */
  version: 1;

  /** Canonical absolute path to the project */
  projectPath: string;

  /** ISO timestamp of when this state was saved */
  savedAt: string;

  /** Saved terminal configurations */
  terminals: SavedTerminalState[];

  /** Saved console configurations */
  consoles: SavedConsoleState[];

  /** Layout tree (panel arrangement) */
  layoutTree: LayoutNode | null;

  /** Currently focused widget ID */
  focusedWidgetId: string | null;

  /** Whether the tasks panel is visible */
  tasksVisible: boolean;

  /** Whether the agent status bar is visible */
  showAgentStatus: boolean;
}

// ============================================================================
// ID MAPPING (for restoration)
// ============================================================================

/**
 * Maps old widget IDs to new IDs after restoration.
 * Used to update layout tree references.
 */
export interface StateRestorationResult {
  /** Terminal ID mapping: old ID -> new ID */
  terminalIdMap: Map<string, string>;

  /** Console ID mapping: old ID -> new ID */
  consoleIdMap: Map<string, string>;

  /** Terminals that failed to restore */
  failedTerminals: Array<{ id: string; reason: string }>;

  /** Consoles that failed to restore */
  failedConsoles: Array<{ id: string; reason: string }>;
}

// ============================================================================
// REST API TYPES
// ============================================================================

/** Response from GET /api/project-state */
export interface GetProjectStateResponse {
  ok: true;
  state: ProjectState | null;
}

/** Request body for PUT /api/project-state */
export interface SaveProjectStateRequest {
  projectPath: string;
  state: ProjectState;
}

/** Response from PUT /api/project-state */
export interface SaveProjectStateResponse {
  ok: true;
}

/** Response from DELETE /api/project-state */
export interface DeleteProjectStateResponse {
  ok: true;
}

/** Response from GET /api/project-states (list all) */
export interface ListProjectStatesResponse {
  ok: true;
  projects: Array<{
    projectPath: string;
    savedAt: string;
  }>;
}
