# Real-Time Sync Implementation Plan

## Problem Statement

The Tasks Widget has inconsistent synchronization between the database and UI:
- Database changes from REST API endpoints don't trigger WebSocket events
- Multiple clients viewing the same data won't see updates from other clients
- The UI relies on manual refetching or local state updates that can become stale

## Inspiration: Convex Architecture

[Convex](https://www.convex.dev/) uses a reactive database pattern where:
1. **Queries are subscriptions** - The `useQuery` hook automatically updates when data changes
2. **Dependency tracking** - The backend knows which queries depend on which data
3. **Mutations trigger updates** - Every database change automatically reruns affected queries and pushes to subscribers
4. **Single source of truth** - No manual cache invalidation needed

Sources:
- [Convex Overview](https://docs.convex.dev/understanding/)
- [Real-Time Database Guide](https://stack.convex.dev/real-time-database)

## Current Architecture Gaps

### Events Working ✓
| Feature | DB Update | WS Event | Client Handler |
|---------|-----------|----------|----------------|
| Prompt started | ✓ | ✓ | ✓ |
| Prompt completed | ✓ | ✓ | ✓ |
| AI summary update | ✓ | ✓ | ✓ |
| Auto-extracted tasks | ✓ | ✓ | ✓ |

### Events Broken ✗
| Feature | DB Update | WS Event | Client Handler |
|---------|-----------|----------|----------------|
| Dismiss task | ✓ | ✗ | N/A |
| Complete task | ✓ | ✗ | N/A |
| Start task | ✓ | ✗ | N/A |
| Move to goal | ✓ | ✗ | N/A |
| Create goal | ✓ | ✗ | ✓ (waiting) |
| Update goal | ✓ | ✗ | ✓ (waiting) |
| Archive goal | ✓ | ✗ | N/A |
| Dismiss session | ✓ | ✗ | N/A |

## Implementation Plan

### Phase 1: Add Missing WebSocket Events (Quick Fix)

Add `broadcastRaw` calls after every database mutation in REST endpoints.

**File: `/packages/server/src/server.ts`**

#### 1.1 Task Status Changes
After each task status update endpoint, broadcast the updated task list:

```typescript
// After: store.dismissTask(id) / completeTask(id) / startTask(id)
this.broadcastRaw({
  type: 'event',
  event: {
    type: 'tasks.updated',
    payload: getTaskStore().listTasks({ limit: 50, includeCompleted: true }),
    timestamp: new Date().toISOString(),
  },
});
```

**Endpoints to update:**
- `POST /extracted-tasks/:id/dismiss` (line ~558)
- `POST /extracted-tasks/:id/complete` (line ~566)
- `POST /extracted-tasks/:id/start` (line ~574)
- `PATCH /extracted-tasks/:id` (line ~552)
- `POST /extracted-tasks/:id/move-to-goal` (line ~583)

#### 1.2 Goal Operations
Emit specific goal events for fine-grained updates:

```typescript
// After: store.createGoal(...)
const goal = store.createGoal({ ... });
this.broadcastRaw({
  type: 'event',
  event: {
    type: 'goal.created',
    payload: goal,
    timestamp: new Date().toISOString(),
  },
});

// After: store.updateGoal(...)
this.broadcastRaw({
  type: 'event',
  event: {
    type: 'goal.updated',
    payload: store.getGoal(id),
    timestamp: new Date().toISOString(),
  },
});

// After: store.archiveGoal(...)
this.broadcastRaw({
  type: 'event',
  event: {
    type: 'goal.archived',
    payload: { goalId: id },
    timestamp: new Date().toISOString(),
  },
});
```

**Endpoints to update:**
- `POST /goals` (line ~608)
- `PATCH /goals/:id` (line ~634)
- `DELETE /goals/:id` (line ~642)

#### 1.3 Session Operations

```typescript
// After: store.dismissSession(id)
this.broadcastRaw({
  type: 'event',
  event: {
    type: 'session.dismissed',
    payload: { sessionId: id },
    timestamp: new Date().toISOString(),
  },
});
```

**Endpoints to update:**
- `POST /sessions/:id/dismiss` (line ~675)
- `DELETE /sessions/:id` (line ~687)

### Phase 2: Unified Event Emitter Pattern

Create a centralized event emission pattern to ensure consistency.

**File: `/packages/server/src/events/sync-events.ts` (NEW)**

```typescript
/**
 * Centralized sync event emitter
 * Ensures every database mutation triggers appropriate WebSocket broadcasts
 */

import { getTaskStore } from '../persistence/task-store';

export type SyncEventType =
  | 'tasks.updated'
  | 'task.created'
  | 'task.updated'
  | 'task.deleted'
  | 'goals.updated'
  | 'goal.created'
  | 'goal.updated'
  | 'goal.archived'
  | 'sessions.updated'
  | 'session.dismissed';

export interface SyncEvent {
  type: SyncEventType;
  payload: unknown;
  timestamp: string;
  // For dependency tracking (Phase 3)
  affectedQueries?: string[];
}

export class SyncEventEmitter {
  private broadcaster: (event: SyncEvent) => void;

  constructor(broadcaster: (event: SyncEvent) => void) {
    this.broadcaster = broadcaster;
  }

  // Task events
  emitTasksChanged() {
    const store = getTaskStore();
    this.broadcaster({
      type: 'tasks.updated',
      payload: store.listTasks({ limit: 100, includeCompleted: true }),
      timestamp: new Date().toISOString(),
      affectedQueries: ['tasks.list', 'tasks.inbox'],
    });
  }

  emitTaskCreated(task: Task) {
    this.broadcaster({
      type: 'task.created',
      payload: task,
      timestamp: new Date().toISOString(),
    });
    this.emitTasksChanged(); // Also emit full list for simplicity
  }

  emitTaskUpdated(task: Task) {
    this.broadcaster({
      type: 'task.updated',
      payload: task,
      timestamp: new Date().toISOString(),
    });
    this.emitTasksChanged();
  }

  // Goal events
  emitGoalCreated(goal: Goal) {
    this.broadcaster({
      type: 'goal.created',
      payload: goal,
      timestamp: new Date().toISOString(),
    });
  }

  emitGoalUpdated(goal: Goal) {
    this.broadcaster({
      type: 'goal.updated',
      payload: goal,
      timestamp: new Date().toISOString(),
    });
  }

  emitGoalArchived(goalId: string) {
    this.broadcaster({
      type: 'goal.archived',
      payload: { goalId },
      timestamp: new Date().toISOString(),
    });
  }

  // Session events
  emitSessionDismissed(sessionId: string) {
    this.broadcaster({
      type: 'session.dismissed',
      payload: { sessionId },
      timestamp: new Date().toISOString(),
    });
  }
}
```

### Phase 3: Query Subscriptions (Convex-Inspired)

Create a subscription system where clients subscribe to specific "queries" and receive updates only when relevant data changes.

**File: `/packages/server/src/subscriptions/query-manager.ts` (NEW)**

```typescript
/**
 * Query Subscription Manager
 *
 * Inspired by Convex's reactive queries:
 * - Clients subscribe to named queries with parameters
 * - Server tracks which data each query depends on
 * - When data changes, only affected queries are re-run and pushed
 */

interface QuerySubscription {
  clientId: string;
  queryName: string;
  params: Record<string, unknown>;
  lastResult?: unknown;
  lastResultHash?: string;
}

interface QueryDefinition {
  name: string;
  execute: (params: Record<string, unknown>) => unknown;
  dependencies: string[]; // e.g., ['tasks', 'goals']
}

export class QuerySubscriptionManager {
  private subscriptions = new Map<string, QuerySubscription[]>();
  private queries = new Map<string, QueryDefinition>();
  private broadcaster: (clientId: string, data: unknown) => void;

  constructor(broadcaster: (clientId: string, data: unknown) => void) {
    this.broadcaster = broadcaster;
    this.registerDefaultQueries();
  }

  private registerDefaultQueries() {
    // Active sessions query
    this.registerQuery({
      name: 'sessions.active',
      execute: () => getTaskStore().getActiveSessions(),
      dependencies: ['active_sessions'],
    });

    // Recent sessions query
    this.registerQuery({
      name: 'sessions.recent',
      execute: ({ limit = 10 }) => getTaskStore().getRecentlyCompletedSessions(limit as number),
      dependencies: ['active_sessions'],
    });

    // Tasks list query
    this.registerQuery({
      name: 'tasks.list',
      execute: ({ status, goalId, limit = 50 }) =>
        getTaskStore().listTasks({ status, goalId, limit: limit as number }),
      dependencies: ['tasks'],
    });

    // Inbox tasks query
    this.registerQuery({
      name: 'tasks.inbox',
      execute: () => getTaskStore().getUnassignedTasks(),
      dependencies: ['tasks'],
    });

    // Goals query
    this.registerQuery({
      name: 'goals.list',
      execute: ({ status }) => getTaskStore().listGoals({ status }),
      dependencies: ['goals', 'tasks'], // tasks affect goal counts
    });
  }

  registerQuery(query: QueryDefinition) {
    this.queries.set(query.name, query);
  }

  subscribe(clientId: string, queryName: string, params: Record<string, unknown> = {}) {
    const query = this.queries.get(queryName);
    if (!query) return;

    const subscription: QuerySubscription = {
      clientId,
      queryName,
      params,
    };

    // Execute initial query and send result
    const result = query.execute(params);
    subscription.lastResult = result;
    subscription.lastResultHash = this.hashResult(result);

    this.broadcaster(clientId, {
      type: 'query.result',
      queryName,
      params,
      data: result,
    });

    // Store subscription
    const subs = this.subscriptions.get(queryName) || [];
    subs.push(subscription);
    this.subscriptions.set(queryName, subs);
  }

  unsubscribe(clientId: string, queryName?: string) {
    if (queryName) {
      const subs = this.subscriptions.get(queryName) || [];
      this.subscriptions.set(queryName, subs.filter(s => s.clientId !== clientId));
    } else {
      // Unsubscribe from all
      for (const [name, subs] of this.subscriptions) {
        this.subscriptions.set(name, subs.filter(s => s.clientId !== clientId));
      }
    }
  }

  // Called when data changes - re-runs affected queries
  notifyDataChanged(tableName: string) {
    for (const [queryName, query] of this.queries) {
      if (!query.dependencies.includes(tableName)) continue;

      const subs = this.subscriptions.get(queryName) || [];
      for (const sub of subs) {
        const result = query.execute(sub.params);
        const hash = this.hashResult(result);

        // Only send if result actually changed
        if (hash !== sub.lastResultHash) {
          sub.lastResult = result;
          sub.lastResultHash = hash;

          this.broadcaster(sub.clientId, {
            type: 'query.result',
            queryName,
            params: sub.params,
            data: result,
          });
        }
      }
    }
  }

  private hashResult(result: unknown): string {
    return JSON.stringify(result);
  }
}
```

### Phase 4: Client-Side Query Hooks (Convex-Inspired)

Create React hooks that automatically subscribe to queries and update when data changes.

**File: `/packages/ui/src/hooks/useRealtimeQuery.ts` (NEW)**

```typescript
/**
 * useRealtimeQuery - Convex-inspired reactive query hook
 *
 * Usage:
 *   const tasks = useRealtimeQuery('tasks.list', { status: 'doing' });
 *   const goals = useRealtimeQuery('goals.list');
 *
 * The hook automatically:
 * - Subscribes to the query on mount
 * - Updates when server pushes new data
 * - Unsubscribes on unmount
 * - Handles reconnection
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { getWsUrl } from '../stores/app';

interface QueryState<T> {
  data: T | undefined;
  isLoading: boolean;
  error: Error | null;
}

export function useRealtimeQuery<T>(
  queryName: string,
  params: Record<string, unknown> = {}
): QueryState<T> {
  const [state, setState] = useState<QueryState<T>>({
    data: undefined,
    isLoading: true,
    error: null,
  });

  const wsRef = useRef<WebSocket | null>(null);
  const paramsKey = JSON.stringify(params);

  useEffect(() => {
    const ws = new WebSocket(getWsUrl());
    wsRef.current = ws;

    ws.onopen = () => {
      // Subscribe to query
      ws.send(JSON.stringify({
        type: 'subscribe',
        queryName,
        params,
      }));
    };

    ws.onmessage = (event) => {
      try {
        const message = JSON.parse(event.data);
        if (message.type === 'query.result' && message.queryName === queryName) {
          setState({
            data: message.data as T,
            isLoading: false,
            error: null,
          });
        }
      } catch (err) {
        // Ignore parse errors
      }
    };

    ws.onerror = (error) => {
      setState(prev => ({
        ...prev,
        isLoading: false,
        error: new Error('WebSocket error'),
      }));
    };

    ws.onclose = () => {
      // Attempt reconnection
      // TODO: Implement exponential backoff
    };

    return () => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({
          type: 'unsubscribe',
          queryName,
        }));
      }
      ws.close();
    };
  }, [queryName, paramsKey]);

  return state;
}

// Convenience hooks for common queries
export function useActiveSessions() {
  return useRealtimeQuery<ActiveSession[]>('sessions.active');
}

export function useRecentSessions(limit = 10) {
  return useRealtimeQuery<ActiveSession[]>('sessions.recent', { limit });
}

export function useTasks(options: { status?: string; goalId?: string } = {}) {
  return useRealtimeQuery<ExtractedTask[]>('tasks.list', options);
}

export function useInboxTasks() {
  return useRealtimeQuery<ExtractedTask[]>('tasks.inbox');
}

export function useGoals(options: { status?: string } = {}) {
  return useRealtimeQuery<Goal[]>('goals.list', options);
}
```

### Phase 5: TaskStore with Auto-Emit

Wrap TaskStore methods to automatically emit events on every mutation.

**File: `/packages/server/src/persistence/reactive-task-store.ts` (NEW)**

```typescript
/**
 * Reactive Task Store Wrapper
 *
 * Wraps TaskStore to automatically emit sync events on every mutation.
 * This ensures no database change can happen without triggering an update.
 */

import { TaskStore, getTaskStore as getBaseTaskStore } from './task-store';
import { SyncEventEmitter } from '../events/sync-events';

export class ReactiveTaskStore {
  private store: TaskStore;
  private emitter: SyncEventEmitter;

  constructor(store: TaskStore, emitter: SyncEventEmitter) {
    this.store = store;
    this.emitter = emitter;
  }

  // Wrap task mutations
  createTask(input: CreateTaskInput) {
    const task = this.store.createTask(input);
    if (task) {
      this.emitter.emitTaskCreated(task);
    }
    return task;
  }

  updateStatus(id: string, status: string) {
    this.store.updateStatus(id, status);
    const task = this.store.getTask(id);
    if (task) {
      this.emitter.emitTaskUpdated(task);
    }
  }

  completeTask(id: string) {
    this.store.completeTask(id);
    this.emitter.emitTasksChanged();
  }

  dismissTask(id: string) {
    this.store.dismissTask(id);
    this.emitter.emitTasksChanged();
  }

  moveTaskToGoal(taskId: string, goalId: string | null) {
    this.store.moveTaskToGoal(taskId, goalId);
    this.emitter.emitTasksChanged();
    // Also emit goal update for count changes
    if (goalId) {
      const goal = this.store.getGoal(goalId);
      if (goal) this.emitter.emitGoalUpdated(goal);
    }
  }

  // Wrap goal mutations
  createGoal(input: CreateGoalInput) {
    const goal = this.store.createGoal(input);
    this.emitter.emitGoalCreated(goal);
    return goal;
  }

  updateGoal(id: string, updates: Partial<Goal>) {
    this.store.updateGoal(id, updates);
    const goal = this.store.getGoal(id);
    if (goal) this.emitter.emitGoalUpdated(goal);
  }

  archiveGoal(id: string) {
    this.store.archiveGoal(id);
    this.emitter.emitGoalArchived(id);
  }

  // Wrap session mutations
  dismissSession(id: string) {
    this.store.dismissSession(id);
    this.emitter.emitSessionDismissed(id);
  }

  // Delegate read operations directly
  getTask(id: string) { return this.store.getTask(id); }
  listTasks(options?: any) { return this.store.listTasks(options); }
  getGoal(id: string) { return this.store.getGoal(id); }
  listGoals(options?: any) { return this.store.listGoals(options); }
  // ... etc
}
```

## Implementation Order

### Sprint 1: Quick Fixes (1-2 hours) ✅ COMPLETED
1. ✅ Add `broadcastRaw` calls to all task/goal/session endpoints in server.ts
2. ✅ Add `goal.archived` and `session.dismissed` event handlers to TasksWidgetContainer
3. ✅ Test that all mutations now trigger UI updates
4. ✅ Fix session ID parsing in `parseActiveSession` (sessionId → id mapping)
5. ✅ Fix task status update timing (emit before prompt.completed)

### Sprint 2: Centralized Events (2-3 hours) ✅ COMPLETED
1. ✅ Create SyncEventEmitter class (`/packages/server/src/events/sync-events.ts`)
2. ✅ Refactor server.ts endpoints to use SyncEventEmitter
3. ✅ Increase task limit from 20 to 100 in events

### Sprint 3: Query Subscriptions (4-6 hours) ✅ COMPLETED
1. ✅ Create QuerySubscriptionManager (`/packages/server/src/subscriptions/query-manager.ts`)
2. ✅ Add WebSocket message handling for subscribe/unsubscribe in server.ts
3. ✅ Implement dependency tracking (queries declare which tables they depend on)
4. ✅ Create useRealtimeQuery hook (`/packages/ui/src/hooks/useRealtimeQuery.ts`)
5. ✅ Create convenience hooks (useActiveSessions, useTasks, useGoals, etc.)
6. ✅ Migrate TasksWidgetContainer to use reactive hooks

### Sprint 4: Reactive Store (2-3 hours) ✅ COMPLETED
1. ✅ Create ReactiveTaskStore wrapper (`/packages/server/src/persistence/reactive-task-store.ts`)
2. ✅ Replace direct TaskStore usage in mutation endpoints with ReactiveTaskStore
3. ✅ Remove all manual broadcast calls (now automatic via ReactiveTaskStore)

## Success Criteria

1. **Immediate**: Any task/goal/session change updates all connected clients within 100ms
2. **Consistent**: No database state can change without triggering a sync event
3. **Efficient**: Only affected queries receive updates (dependency tracking)
4. **Resilient**: Clients can recover from missed messages via query re-subscription
5. **Simple**: Developers use `useRealtimeQuery` hook, no manual sync logic

## Future Enhancements

1. **Optimistic Updates**: Apply changes locally before server confirmation
2. **Conflict Resolution**: Handle concurrent edits gracefully
3. **Event Sourcing**: Store event log for replay and debugging
4. **Offline Support**: Queue mutations when disconnected
5. **Selective Sync**: Only sync data user is actively viewing
