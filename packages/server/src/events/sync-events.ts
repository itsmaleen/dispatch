/**
 * Centralized Sync Event Emitter
 *
 * Ensures every database mutation triggers appropriate WebSocket broadcasts.
 * This provides a single point of control for all real-time sync events,
 * inspired by Convex's reactive database pattern.
 */

import { getTaskStore, type Task } from '../persistence/task-store';
import type { Goal, ActiveSession } from '@acc/contracts';

// ============================================================================
// Event Types
// ============================================================================

export type SyncEventType =
  // Task events
  | 'tasks.updated'
  | 'task.created'
  | 'task.updated'
  | 'task.deleted'
  // Goal events
  | 'goal.created'
  | 'goal.updated'
  | 'goal.archived'
  // Session events
  | 'session.started'
  | 'session.completed'
  | 'session.dismissed'
  | 'session.deleted'
  | 'session.summary_updated'
  // Prompt events (alias for session, kept for compatibility)
  | 'prompt.started'
  | 'prompt.completed'
  | 'prompt.summary_updated';

export interface SyncEvent<T = unknown> {
  type: SyncEventType;
  payload: T;
  timestamp: string;
  /** Tables affected by this event (for future dependency tracking) */
  affectedTables?: string[];
}

// ============================================================================
// Payload Types
// ============================================================================

export interface TasksUpdatedPayload {
  tasks: Task[];
}

export interface GoalPayload {
  goal: Goal;
}

export interface GoalArchivedPayload {
  goalId: string;
}

export interface SessionPayload {
  sessionId: string;
  agentId?: string;
  agentName?: string;
  summary?: string;
  promptText?: string;
  status?: string;
  durationMs?: number;
}

// ============================================================================
// Broadcaster Type
// ============================================================================

/** Function that sends events to all connected WebSocket clients */
export type Broadcaster = (event: SyncEvent) => void;

// ============================================================================
// SyncEventEmitter Class
// ============================================================================

export class SyncEventEmitter {
  private broadcaster: Broadcaster;
  private taskLimit: number;

  constructor(broadcaster: Broadcaster, options?: { taskLimit?: number }) {
    this.broadcaster = broadcaster;
    this.taskLimit = options?.taskLimit ?? 100;
  }

  // --------------------------------------------------------------------------
  // Private Helpers
  // --------------------------------------------------------------------------

  private emit<T>(type: SyncEventType, payload: T, affectedTables?: string[]): void {
    this.broadcaster({
      type,
      payload,
      timestamp: new Date().toISOString(),
      affectedTables,
    });
  }

  // --------------------------------------------------------------------------
  // Task Events
  // --------------------------------------------------------------------------

  /** Emit full task list update (use after any task mutation) */
  emitTasksUpdated(): void {
    const store = getTaskStore();
    const tasks = store.listTasks({ limit: this.taskLimit, includeCompleted: true });
    this.emit('tasks.updated', tasks, ['tasks']);
  }

  /** Emit when a new task is created */
  emitTaskCreated(task: Task): void {
    this.emit('task.created', task, ['tasks']);
    // Also emit full list for simplicity (clients can use either)
    this.emitTasksUpdated();
  }

  /** Emit when a task is updated (status change, moved to goal, etc.) */
  emitTaskUpdated(task: Task): void {
    this.emit('task.updated', task, ['tasks']);
    this.emitTasksUpdated();
  }

  /** Emit when a task is deleted/dismissed */
  emitTaskDeleted(taskId: string): void {
    this.emit('task.deleted', { taskId }, ['tasks']);
    this.emitTasksUpdated();
  }

  // --------------------------------------------------------------------------
  // Goal Events
  // --------------------------------------------------------------------------

  /** Emit when a goal is created */
  emitGoalCreated(goal: Goal): void {
    this.emit('goal.created', goal, ['goals']);
  }

  /** Emit when a goal is updated */
  emitGoalUpdated(goal: Goal): void {
    this.emit('goal.updated', goal, ['goals']);
  }

  /** Emit when a goal is archived/deleted */
  emitGoalArchived(goalId: string): void {
    this.emit('goal.archived', { goalId }, ['goals']);
  }

  // --------------------------------------------------------------------------
  // Session/Prompt Events
  // --------------------------------------------------------------------------

  /** Emit when a prompt/session starts */
  emitPromptStarted(data: {
    sessionId: string;
    agentId: string;
    agentName: string;
    summary: string;
    promptText: string;
  }): void {
    this.emit('prompt.started', data, ['active_sessions']);
  }

  /** Emit when a prompt/session completes */
  emitPromptCompleted(data: {
    sessionId: string;
    status: 'completed' | 'failed';
    durationMs: number;
  }): void {
    this.emit('prompt.completed', data, ['active_sessions']);
  }

  /** Emit when a session's AI summary is updated */
  emitPromptSummaryUpdated(data: {
    sessionId: string;
    summary: string;
  }): void {
    this.emit('prompt.summary_updated', data, ['active_sessions']);
  }

  /** Emit when a session is dismissed from recently completed */
  emitSessionDismissed(sessionId: string): void {
    this.emit('session.dismissed', { sessionId }, ['active_sessions']);
  }

  /** Emit when a session is deleted/stopped */
  emitSessionDeleted(sessionId: string): void {
    this.emit('session.deleted', { sessionId }, ['active_sessions']);
  }

  // --------------------------------------------------------------------------
  // Convenience Methods
  // --------------------------------------------------------------------------

  /** Emit both task update and goal update (for task-to-goal moves) */
  emitTaskMovedToGoal(task: Task, goal: Goal | null): void {
    this.emitTasksUpdated();
    if (goal) {
      this.emitGoalUpdated(goal);
    }
  }
}

// ============================================================================
// Singleton Factory
// ============================================================================

let _emitter: SyncEventEmitter | null = null;

/** Initialize the global sync event emitter with a broadcaster function */
export function initSyncEventEmitter(broadcaster: Broadcaster, options?: { taskLimit?: number }): SyncEventEmitter {
  _emitter = new SyncEventEmitter(broadcaster, options);
  return _emitter;
}

/** Get the global sync event emitter (must be initialized first) */
export function getSyncEventEmitter(): SyncEventEmitter {
  if (!_emitter) {
    throw new Error('SyncEventEmitter not initialized. Call initSyncEventEmitter first.');
  }
  return _emitter;
}
