/**
 * Reactive Task Store Wrapper
 *
 * Wraps TaskStore to automatically emit sync events on every mutation.
 * This ensures no database change can happen without triggering an update.
 *
 * Benefits:
 * - Single source of truth for event emission
 * - Impossible to forget to broadcast after a mutation
 * - Cleaner endpoint code (no manual broadcast calls)
 * - Consistent event payloads
 *
 * Usage:
 *   import { getReactiveTaskStore } from './persistence/reactive-task-store';
 *   const store = getReactiveTaskStore();
 *   store.dismissTask(id); // Automatically broadcasts tasks.updated
 */

import { getTaskStore, type Task, type TaskStore } from './task-store';
import { getSyncEventEmitter } from '../events/sync-events';
import { getQueryManager } from '../subscriptions/query-manager';
import type { Goal, GoalCreatedVia } from '@acc/contracts';

// ============================================================================
// Reactive Task Store
// ============================================================================

export class ReactiveTaskStore {
  private store: TaskStore;

  constructor(store: TaskStore) {
    this.store = store;
  }

  // --------------------------------------------------------------------------
  // Private Helpers
  // --------------------------------------------------------------------------

  private notifyTasksChanged(): void {
    getSyncEventEmitter().emitTasksUpdated();
    getQueryManager().notifyDataChanged('tasks');
  }

  private notifyGoalsChanged(): void {
    getQueryManager().notifyDataChanged('goals');
  }

  private notifySessionsChanged(): void {
    getQueryManager().notifyDataChanged('active_sessions');
  }

  // --------------------------------------------------------------------------
  // Task Mutations (auto-emit events)
  // --------------------------------------------------------------------------

  /** Create a new task */
  createTask(input: Parameters<TaskStore['createTask']>[0]): Task | null {
    const task = this.store.createTask(input);
    if (task) {
      this.notifyTasksChanged();
    }
    return task;
  }

  /** Update task status */
  updateStatus(taskId: string, status: Task['status']): void {
    this.store.updateStatus(taskId, status);
    this.notifyTasksChanged();
  }

  /** Dismiss a task */
  dismissTask(taskId: string): void {
    this.store.dismissTask(taskId);
    this.notifyTasksChanged();
  }

  /** Complete a task */
  completeTask(taskId: string): void {
    this.store.completeTask(taskId);
    this.notifyTasksChanged();
  }

  /** Start a task (set status to 'doing') */
  startTask(taskId: string): void {
    this.store.startTask(taskId);
    this.notifyTasksChanged();
  }

  /** Move task to a goal */
  moveTaskToGoal(taskId: string, goalId: string | null): void {
    this.store.moveTaskToGoal(taskId, goalId);
    this.notifyTasksChanged();
    // Also notify goals since task counts change
    this.notifyGoalsChanged();
  }

  // Note: updateTask is not available on TaskStore - use updateStatus for status changes

  /** Complete active tasks for a thread/agent */
  completeActiveTasks(threadId: string, agentId: string): string[] {
    const completedIds = this.store.completeActiveTasks(threadId, agentId);
    if (completedIds.length > 0) {
      this.notifyTasksChanged();
    }
    return completedIds;
  }

  // --------------------------------------------------------------------------
  // Goal Mutations (auto-emit events)
  // --------------------------------------------------------------------------

  /** Create a new goal */
  createGoal(input: { title: string; description?: string; createdVia: GoalCreatedVia; projectPath?: string }): Goal {
    const goal = this.store.createGoal(input);
    getSyncEventEmitter().emitGoalCreated(goal);
    this.notifyGoalsChanged();
    return goal;
  }

  /** Update a goal */
  updateGoal(goalId: string, updates: Partial<Goal>): void {
    this.store.updateGoal(goalId, updates);
    const goal = this.store.getGoal(goalId);
    if (goal) {
      getSyncEventEmitter().emitGoalUpdated(goal);
    }
    this.notifyGoalsChanged();
  }

  /** Archive a goal */
  archiveGoal(goalId: string): void {
    this.store.archiveGoal(goalId);
    getSyncEventEmitter().emitGoalArchived(goalId);
    this.notifyGoalsChanged();
  }

  // --------------------------------------------------------------------------
  // Session Mutations (auto-emit events)
  // --------------------------------------------------------------------------

  /** Start tracking an active session */
  startSession(input: Parameters<TaskStore['startSession']>[0]): void {
    this.store.startSession(input);
    this.notifySessionsChanged();
  }

  /** Complete an active session */
  completeSession(sessionId: string, status: 'completed' | 'failed'): void {
    this.store.completeSession(sessionId, status);
    this.notifySessionsChanged();
  }

  /** Dismiss a session from recently completed */
  dismissSession(sessionId: string): void {
    this.store.dismissSession(sessionId);
    getSyncEventEmitter().emitSessionDismissed(sessionId);
    this.notifySessionsChanged();
  }

  /** Delete a session (dismisses and emits deleted event) */
  deleteSession(sessionId: string): void {
    // TaskStore doesn't have a separate delete - we dismiss and emit the deleted event
    this.store.dismissSession(sessionId);
    getSyncEventEmitter().emitSessionDeleted(sessionId);
    this.notifySessionsChanged();
  }

  /** Update session summary */
  updateSessionSummary(sessionId: string, summary: string): void {
    this.store.updateSessionSummary(sessionId, summary);
    this.notifySessionsChanged();
  }

  // --------------------------------------------------------------------------
  // Read Operations (pass-through, no events)
  // --------------------------------------------------------------------------

  // Tasks
  getTask(id: string) { return this.store.getTask(id); }
  listTasks(options?: Parameters<TaskStore['listTasks']>[0]) { return this.store.listTasks(options); }
  getActiveTasks(projectPath?: string) { return this.store.getActiveTasks(projectPath); }
  getPendingTasks(projectPath?: string) { return this.store.getPendingTasks(projectPath); }
  getUnassignedTasks(projectPath?: string) { return this.store.getUnassignedTasks(projectPath); }
  getTasksByGoal(goalId: string, projectPath?: string) { return this.store.getTasksByGoal(goalId, projectPath); }
  getCounts(projectPath?: string) { return this.store.getCounts(projectPath); }
  getSuggestedTasks(projectPath?: string) { return this.store.getSuggestedTasks(projectPath); }
  getRecentlyCompleted(limit?: number, projectPath?: string) { return this.store.getRecentlyCompleted(limit, projectPath); }

  // Goals
  getGoal(id: string) { return this.store.getGoal(id); }
  listGoals(options?: Parameters<TaskStore['listGoals']>[0]) { return this.store.listGoals(options); }

  // Sessions
  getSession(id: string) { return this.store.getSession(id); }
  getActiveSessions(projectPath?: string) { return this.store.getActiveSessions(projectPath); }
  getRecentlyCompletedSessions(limit?: number, projectPath?: string) { return this.store.getRecentlyCompletedSessions(limit, projectPath); }
}

// ============================================================================
// Singleton
// ============================================================================

let _reactiveStore: ReactiveTaskStore | null = null;

/**
 * Get the reactive task store (auto-emits events on mutations)
 * Use this in server endpoints instead of getTaskStore()
 */
export function getReactiveTaskStore(): ReactiveTaskStore {
  if (!_reactiveStore) {
    _reactiveStore = new ReactiveTaskStore(getTaskStore());
  }
  return _reactiveStore;
}
