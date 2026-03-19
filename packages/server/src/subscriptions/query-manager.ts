/**
 * Query Subscription Manager
 *
 * Inspired by Convex's reactive queries:
 * - Clients subscribe to named queries with parameters
 * - Server tracks which data each query depends on
 * - When data changes, only affected queries are re-run and pushed
 *
 * This enables efficient real-time updates where clients only receive
 * data they're actually subscribed to.
 */

import { getTaskStore } from '../persistence/task-store';
import type { Task } from '../persistence/task-store';
import type { Goal, ActiveSession, ConsoleThread } from '@acc/contracts';

// ============================================================================
// Types
// ============================================================================

export interface QuerySubscription {
  clientId: string;
  queryName: string;
  params: Record<string, unknown>;
  subscriptionId: string;
  lastResultHash?: string;
}

export interface QueryDefinition<T = unknown> {
  name: string;
  execute: (params: Record<string, unknown>) => T;
  /** Tables this query reads from - used for dependency tracking */
  dependencies: string[];
}

export interface QueryResult<T = unknown> {
  type: 'query.result';
  queryName: string;
  subscriptionId: string;
  params: Record<string, unknown>;
  data: T;
  timestamp: string;
}

export interface QueryError {
  type: 'query.error';
  queryName: string;
  subscriptionId: string;
  error: string;
  timestamp: string;
}

/** Function to send data to a specific client */
export type ClientSender = (clientId: string, data: QueryResult | QueryError) => void;

// ============================================================================
// QuerySubscriptionManager
// ============================================================================

export class QuerySubscriptionManager {
  private subscriptions = new Map<string, QuerySubscription[]>(); // queryName -> subscriptions
  private clientSubscriptions = new Map<string, Set<string>>(); // clientId -> subscriptionIds
  private queries = new Map<string, QueryDefinition>();
  private sender: ClientSender;

  constructor(sender: ClientSender) {
    this.sender = sender;
    this.registerDefaultQueries();
  }

  // --------------------------------------------------------------------------
  // Query Registration
  // --------------------------------------------------------------------------

  private registerDefaultQueries(): void {
    // Active sessions (currently running prompts)
    // Pass projectPath to filter by workspace
    this.registerQuery({
      name: 'sessions.active',
      execute: (params) => {
        const projectPath = params.projectPath as string | undefined;
        return getTaskStore().getActiveSessions(projectPath);
      },
      dependencies: ['active_sessions'],
    });

    // Recently completed sessions
    this.registerQuery({
      name: 'sessions.recent',
      execute: (params) => {
        const limit = typeof params.limit === 'number' ? params.limit : 10;
        const projectPath = params.projectPath as string | undefined;
        return getTaskStore().getRecentlyCompletedSessions(limit, projectPath);
      },
      dependencies: ['active_sessions'],
    });

    // Tasks list with filters
    this.registerQuery({
      name: 'tasks.list',
      execute: (params) => {
        return getTaskStore().listTasks({
          status: params.status as Task['status'] | undefined,
          goalId: params.goalId as string | undefined,
          projectPath: params.projectPath as string | undefined,
          limit: typeof params.limit === 'number' ? params.limit : 100,
          includeCompleted: params.includeCompleted === true,
        });
      },
      dependencies: ['tasks'],
    });

    // Active tasks (status = 'doing')
    this.registerQuery({
      name: 'tasks.active',
      execute: (params) => {
        const projectPath = params.projectPath as string | undefined;
        return getTaskStore().getActiveTasks(projectPath);
      },
      dependencies: ['tasks'],
    });

    // Pending tasks
    this.registerQuery({
      name: 'tasks.pending',
      execute: (params) => {
        const projectPath = params.projectPath as string | undefined;
        return getTaskStore().getPendingTasks(projectPath);
      },
      dependencies: ['tasks'],
    });

    // Inbox tasks (no goal assigned)
    this.registerQuery({
      name: 'tasks.inbox',
      execute: (params) => {
        const projectPath = params.projectPath as string | undefined;
        return getTaskStore().getUnassignedTasks(projectPath);
      },
      dependencies: ['tasks'],
    });

    // Tasks by goal
    this.registerQuery({
      name: 'tasks.byGoal',
      execute: (params) => {
        const goalId = params.goalId as string;
        const projectPath = params.projectPath as string | undefined;
        if (!goalId) return [];
        return getTaskStore().getTasksByGoal(goalId, projectPath);
      },
      dependencies: ['tasks'],
    });

    // Goals list
    this.registerQuery({
      name: 'goals.list',
      execute: (params) => {
        const status = params.status as Goal['status'] | undefined;
        const projectPath = params.projectPath as string | undefined;
        return getTaskStore().listGoals({ status, projectPath });
      },
      dependencies: ['goals', 'tasks'], // tasks affect goal counts
    });

    // Single goal with tasks
    this.registerQuery({
      name: 'goals.get',
      execute: (params) => {
        const goalId = params.goalId as string;
        const projectPath = params.projectPath as string | undefined;
        if (!goalId) return null;
        const goal = getTaskStore().getGoal(goalId);
        if (!goal) return null;
        const tasks = getTaskStore().getTasksByGoal(goalId, projectPath);
        return { ...goal, tasks };
      },
      dependencies: ['goals', 'tasks'],
    });

    // Task counts by status
    this.registerQuery({
      name: 'tasks.counts',
      execute: (params) => {
        const projectPath = params.projectPath as string | undefined;
        return getTaskStore().getCounts(projectPath);
      },
      dependencies: ['tasks'],
    });

    // Console threads list (Phase 1)
    this.registerQuery({
      name: 'threads.list',
      execute: (params) => {
        const consoleId = params.consoleId as string | undefined;
        const status = params.status as 'active' | 'completed' | 'abandoned' | undefined;
        const projectPath = params.projectPath as string | undefined;
        return getTaskStore().listConsoleThreads({ consoleId, status, projectPath });
      },
      dependencies: ['console_threads'],
    });

    // Active thread for a specific console (Phase 1)
    this.registerQuery({
      name: 'threads.active',
      execute: (params) => {
        const consoleId = params.consoleId as string;
        const projectPath = params.projectPath as string | undefined;
        if (!consoleId) return null;
        return getTaskStore().getActiveThreadForConsole(consoleId, projectPath);
      },
      dependencies: ['console_threads'],
    });
  }

  registerQuery<T>(query: QueryDefinition<T>): void {
    this.queries.set(query.name, query as QueryDefinition);
  }

  // --------------------------------------------------------------------------
  // Subscription Management
  // --------------------------------------------------------------------------

  /**
   * Subscribe a client to a query
   * Returns the subscription ID
   */
  subscribe(
    clientId: string,
    queryName: string,
    params: Record<string, unknown> = {}
  ): string {
    const query = this.queries.get(queryName);
    if (!query) {
      const error: QueryError = {
        type: 'query.error',
        queryName,
        subscriptionId: '',
        error: `Unknown query: ${queryName}`,
        timestamp: new Date().toISOString(),
      };
      this.sender(clientId, error);
      return '';
    }

    // Generate subscription ID
    const subscriptionId = `sub-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    const subscription: QuerySubscription = {
      clientId,
      queryName,
      params,
      subscriptionId,
    };

    // Execute initial query and send result
    try {
      const result = query.execute(params);
      const hash = this.hashResult(result);
      subscription.lastResultHash = hash;

      this.sender(clientId, {
        type: 'query.result',
        queryName,
        subscriptionId,
        params,
        data: result,
        timestamp: new Date().toISOString(),
      });
    } catch (err) {
      this.sender(clientId, {
        type: 'query.error',
        queryName,
        subscriptionId,
        error: err instanceof Error ? err.message : 'Query execution failed',
        timestamp: new Date().toISOString(),
      });
      return '';
    }

    // Store subscription
    const querySubs = this.subscriptions.get(queryName) || [];
    querySubs.push(subscription);
    this.subscriptions.set(queryName, querySubs);

    // Track client's subscriptions for cleanup
    const clientSubs = this.clientSubscriptions.get(clientId) || new Set();
    clientSubs.add(subscriptionId);
    this.clientSubscriptions.set(clientId, clientSubs);

    console.log(`[QueryManager] Client ${clientId} subscribed to ${queryName} (${subscriptionId})`);
    return subscriptionId;
  }

  /**
   * Unsubscribe from a specific subscription
   */
  unsubscribe(clientId: string, subscriptionId: string): void {
    // Find and remove the subscription
    for (const [queryName, subs] of this.subscriptions) {
      const index = subs.findIndex(
        s => s.clientId === clientId && s.subscriptionId === subscriptionId
      );
      if (index >= 0) {
        subs.splice(index, 1);
        console.log(`[QueryManager] Client ${clientId} unsubscribed from ${queryName} (${subscriptionId})`);
        break;
      }
    }

    // Remove from client tracking
    const clientSubs = this.clientSubscriptions.get(clientId);
    if (clientSubs) {
      clientSubs.delete(subscriptionId);
      if (clientSubs.size === 0) {
        this.clientSubscriptions.delete(clientId);
      }
    }
  }

  /**
   * Unsubscribe a client from all queries (on disconnect)
   */
  unsubscribeAll(clientId: string): void {
    const clientSubs = this.clientSubscriptions.get(clientId);
    if (!clientSubs) return;

    // Remove all subscriptions for this client
    for (const [queryName, subs] of this.subscriptions) {
      const filtered = subs.filter(s => s.clientId !== clientId);
      if (filtered.length !== subs.length) {
        this.subscriptions.set(queryName, filtered);
      }
    }

    this.clientSubscriptions.delete(clientId);
    console.log(`[QueryManager] Client ${clientId} unsubscribed from all queries`);
  }

  // --------------------------------------------------------------------------
  // Data Change Notifications
  // --------------------------------------------------------------------------

  /**
   * Called when data in a table changes
   * Re-runs affected queries and pushes updates to subscribers
   */
  notifyDataChanged(tableName: string): void {
    for (const [queryName, query] of this.queries) {
      // Skip queries that don't depend on this table
      if (!query.dependencies.includes(tableName)) continue;

      const subs = this.subscriptions.get(queryName) || [];
      if (subs.length === 0) continue;

      // Re-run query for each subscription
      for (const sub of subs) {
        try {
          const result = query.execute(sub.params);
          const hash = this.hashResult(result);

          // Only send if result actually changed
          if (hash !== sub.lastResultHash) {
            sub.lastResultHash = hash;

            this.sender(sub.clientId, {
              type: 'query.result',
              queryName,
              subscriptionId: sub.subscriptionId,
              params: sub.params,
              data: result,
              timestamp: new Date().toISOString(),
            });
          }
        } catch (err) {
          console.error(`[QueryManager] Failed to re-run ${queryName}:`, err);
        }
      }
    }
  }

  /**
   * Convenience method to notify changes to multiple tables
   */
  notifyTablesChanged(tableNames: string[]): void {
    for (const table of tableNames) {
      this.notifyDataChanged(table);
    }
  }

  // --------------------------------------------------------------------------
  // Helpers
  // --------------------------------------------------------------------------

  private hashResult(result: unknown): string {
    // Simple JSON hash - could be optimized with a proper hash function
    return JSON.stringify(result);
  }

  /**
   * Get stats about current subscriptions (for debugging)
   */
  getStats(): { totalSubscriptions: number; byQuery: Record<string, number>; clients: number } {
    const byQuery: Record<string, number> = {};
    let total = 0;

    for (const [queryName, subs] of this.subscriptions) {
      byQuery[queryName] = subs.length;
      total += subs.length;
    }

    return {
      totalSubscriptions: total,
      byQuery,
      clients: this.clientSubscriptions.size,
    };
  }
}

// ============================================================================
// Singleton
// ============================================================================

let _manager: QuerySubscriptionManager | null = null;

export function initQueryManager(sender: ClientSender): QuerySubscriptionManager {
  _manager = new QuerySubscriptionManager(sender);
  return _manager;
}

export function getQueryManager(): QuerySubscriptionManager {
  if (!_manager) {
    throw new Error('QuerySubscriptionManager not initialized. Call initQueryManager first.');
  }
  return _manager;
}
