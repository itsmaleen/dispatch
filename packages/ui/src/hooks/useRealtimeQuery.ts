/**
 * useRealtimeQuery - Convex-inspired reactive query hook
 *
 * Usage:
 *   const { data: tasks, isLoading } = useRealtimeQuery('tasks.list', { status: 'doing' });
 *   const { data: goals } = useRealtimeQuery('goals.list');
 *
 * The hook automatically:
 * - Subscribes to the query on mount
 * - Updates when server pushes new data
 * - Unsubscribes on unmount
 * - Handles reconnection
 *
 * Available queries (defined in QuerySubscriptionManager):
 * - sessions.active: Currently running prompts
 * - sessions.recent: Recently completed prompts (params: { limit?: number })
 * - tasks.list: All tasks with filters (params: { status?, goalId?, limit?, includeCompleted? })
 * - tasks.active: Tasks with status 'doing'
 * - tasks.pending: Tasks with status 'pending'
 * - tasks.inbox: Tasks without a goal assigned
 * - tasks.byGoal: Tasks for a specific goal (params: { goalId: string })
 * - tasks.counts: Task counts by status
 * - goals.list: All goals (params: { status?: 'active' | 'completed' | 'archived' })
 * - goals.get: Single goal with tasks (params: { goalId: string })
 */

import { useState, useEffect, useCallback, useRef } from 'react';

// ============================================================================
// Types
// ============================================================================

export interface QueryState<T> {
  data: T | undefined;
  isLoading: boolean;
  error: Error | null;
  subscriptionId: string | null;
}

interface QueryResultMessage<T = unknown> {
  type: 'query.result';
  queryName: string;
  subscriptionId: string;
  params: Record<string, unknown>;
  data: T;
  timestamp: string;
}

interface QueryErrorMessage {
  type: 'query.error';
  queryName: string;
  subscriptionId: string;
  error: string;
  timestamp: string;
}

interface SubscribedMessage {
  type: 'subscribed';
  queryName: string;
  subscriptionId: string;
}

type ServerMessage<T = unknown> = QueryResultMessage<T> | QueryErrorMessage | SubscribedMessage;

// ============================================================================
// Hook Implementation
// ============================================================================

export function useRealtimeQuery<T>(
  ws: WebSocket | null,
  queryName: string,
  params: Record<string, unknown> = {}
): QueryState<T> {
  const [state, setState] = useState<QueryState<T>>({
    data: undefined,
    isLoading: true,
    error: null,
    subscriptionId: null,
  });

  // Track params as a stable string for dependency comparison
  const paramsKey = JSON.stringify(params);
  const paramsRef = useRef(params);
  paramsRef.current = params;

  // Track subscription ID for cleanup
  const subscriptionIdRef = useRef<string | null>(null);

  useEffect(() => {
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      // Wait for WebSocket to be ready
      return;
    }

    // Reset state when query changes
    setState({
      data: undefined,
      isLoading: true,
      error: null,
      subscriptionId: null,
    });

    // Handle messages from server
    const handleMessage = (event: MessageEvent) => {
      try {
        const msg = JSON.parse(event.data) as ServerMessage<T>;

        // Handle subscription confirmation
        if (msg.type === 'subscribed' && msg.queryName === queryName) {
          subscriptionIdRef.current = msg.subscriptionId;
          setState(prev => ({
            ...prev,
            subscriptionId: msg.subscriptionId,
          }));
        }

        // Handle query result
        if (msg.type === 'query.result' && msg.queryName === queryName) {
          // Verify this is for our subscription (in case of multiple subscriptions)
          if (subscriptionIdRef.current && msg.subscriptionId !== subscriptionIdRef.current) {
            return;
          }
          setState({
            data: msg.data,
            isLoading: false,
            error: null,
            subscriptionId: msg.subscriptionId,
          });
        }

        // Handle query error
        if (msg.type === 'query.error' && msg.queryName === queryName) {
          if (subscriptionIdRef.current && msg.subscriptionId !== subscriptionIdRef.current) {
            return;
          }
          setState(prev => ({
            ...prev,
            isLoading: false,
            error: new Error(msg.error),
          }));
        }
      } catch {
        // Ignore non-JSON messages or messages for other purposes
      }
    };

    ws.addEventListener('message', handleMessage);

    // Subscribe to query
    ws.send(JSON.stringify({
      type: 'subscribe',
      queryName,
      params: paramsRef.current,
    }));

    // Cleanup on unmount or when dependencies change
    return () => {
      ws.removeEventListener('message', handleMessage);

      // Unsubscribe if we have a subscription ID
      if (subscriptionIdRef.current && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({
          type: 'unsubscribe',
          subscriptionId: subscriptionIdRef.current,
        }));
      }
      subscriptionIdRef.current = null;
    };
  }, [ws, queryName, paramsKey]);

  return state;
}

// ============================================================================
// Convenience Hooks
// All hooks accept an optional projectPath (workspacePath) to filter by workspace
// ============================================================================

import type { ActiveSession, ExtractedTask, Goal, ConsoleThread } from '@acc/contracts';

/**
 * Subscribe to active sessions (currently running prompts)
 * @param ws - WebSocket connection
 * @param projectPath - Optional workspace path to filter by
 */
export function useActiveSessions(ws: WebSocket | null, projectPath?: string) {
  return useRealtimeQuery<ActiveSession[]>(ws, 'sessions.active', { projectPath });
}

/**
 * Subscribe to recently completed sessions
 * @param ws - WebSocket connection
 * @param limit - Max number of sessions to return (default 10)
 * @param projectPath - Optional workspace path to filter by
 */
export function useRecentSessions(ws: WebSocket | null, limit = 10, projectPath?: string) {
  return useRealtimeQuery<ActiveSession[]>(ws, 'sessions.recent', { limit, projectPath });
}

/**
 * Subscribe to tasks list with optional filters
 */
export function useTasks(
  ws: WebSocket | null,
  options: {
    status?: ExtractedTask['status'];
    goalId?: string;
    projectPath?: string;
    limit?: number;
    includeCompleted?: boolean;
  } = {}
) {
  return useRealtimeQuery<ExtractedTask[]>(ws, 'tasks.list', options);
}

/**
 * Subscribe to active tasks (status = 'doing')
 * @param ws - WebSocket connection
 * @param projectPath - Optional workspace path to filter by
 */
export function useActiveTasks(ws: WebSocket | null, projectPath?: string) {
  return useRealtimeQuery<ExtractedTask[]>(ws, 'tasks.active', { projectPath });
}

/**
 * Subscribe to pending tasks
 * @param ws - WebSocket connection
 * @param projectPath - Optional workspace path to filter by
 */
export function usePendingTasks(ws: WebSocket | null, projectPath?: string) {
  return useRealtimeQuery<ExtractedTask[]>(ws, 'tasks.pending', { projectPath });
}

/**
 * Subscribe to inbox tasks (no goal assigned)
 * @param ws - WebSocket connection
 * @param projectPath - Optional workspace path to filter by
 */
export function useInboxTasks(ws: WebSocket | null, projectPath?: string) {
  return useRealtimeQuery<ExtractedTask[]>(ws, 'tasks.inbox', { projectPath });
}

/**
 * Subscribe to tasks for a specific goal
 * @param ws - WebSocket connection
 * @param goalId - Goal ID to filter by
 * @param projectPath - Optional workspace path to filter by
 */
export function useTasksByGoal(ws: WebSocket | null, goalId: string, projectPath?: string) {
  return useRealtimeQuery<ExtractedTask[]>(ws, 'tasks.byGoal', { goalId, projectPath });
}

/**
 * Subscribe to task counts by status
 * @param ws - WebSocket connection
 * @param projectPath - Optional workspace path to filter by
 */
export function useTaskCounts(ws: WebSocket | null, projectPath?: string) {
  return useRealtimeQuery<Record<ExtractedTask['status'], number>>(ws, 'tasks.counts', { projectPath });
}

/**
 * Subscribe to goals list
 * @param ws - WebSocket connection
 * @param options - Filter options including status and projectPath
 */
export function useGoals(
  ws: WebSocket | null,
  options: { status?: Goal['status']; projectPath?: string } = {}
) {
  return useRealtimeQuery<Goal[]>(ws, 'goals.list', options);
}

/**
 * Subscribe to a single goal with its tasks
 * @param ws - WebSocket connection
 * @param goalId - Goal ID to fetch
 * @param projectPath - Optional workspace path to filter by
 */
export function useGoal(ws: WebSocket | null, goalId: string, projectPath?: string) {
  return useRealtimeQuery<Goal & { tasks: ExtractedTask[] }>(ws, 'goals.get', { goalId, projectPath });
}

/**
 * Subscribe to console threads list
 * @param ws - WebSocket connection
 * @param options - Filter options including consoleId, status, and projectPath
 */
export function useConsoleThreads(
  ws: WebSocket | null,
  options: { consoleId?: string; status?: ConsoleThread['status']; projectPath?: string } = {}
) {
  return useRealtimeQuery<ConsoleThread[]>(ws, 'threads.list', options);
}

/**
 * Subscribe to active thread for a specific console
 * @param ws - WebSocket connection
 * @param consoleId - Console ID to get thread for
 * @param projectPath - Optional workspace path to filter by
 */
export function useActiveThreadForConsole(ws: WebSocket | null, consoleId: string, projectPath?: string) {
  return useRealtimeQuery<ConsoleThread | null>(ws, 'threads.active', { consoleId, projectPath });
}
