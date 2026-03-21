/**
 * TasksWidgetContainer - State management wrapper for TasksWidget
 *
 * Uses Convex-inspired reactive queries via useRealtimeQuery hooks.
 * Data automatically updates when the server pushes changes.
 *
 * Handles:
 * - Reactive data subscriptions (sessions, tasks, goals)
 * - Legacy WebSocket events for prompt lifecycle (started/completed)
 * - Action dispatching (dismiss, complete, create goal, etc.)
 */

import { useState, useEffect, useCallback, useMemo } from 'react';
import { TasksWidget, type TasksTab } from './TasksWidget';
import { api } from '../../stores/app';
import {
  useActiveSessions,
  useRecentSessions,
  useTasks,
  useInboxTasks,
  useGoals,
  useConsoleThreads,
} from '../../hooks/useRealtimeQuery';
import type {
  ActiveSession,
  ExtractedTask,
  Goal,
  ConsoleThread,
} from '@acc/contracts';

// ============================================================================
// Helpers
// ============================================================================

// Convert server date strings to Date objects
function parseDate(dateStr: string | Date | undefined): Date {
  if (!dateStr) return new Date();
  if (dateStr instanceof Date) return dateStr;
  return new Date(dateStr);
}

function parseActiveSession(raw: any): ActiveSession {
  return {
    ...raw,
    // Handle both 'id' and 'sessionId' (event payload uses sessionId)
    id: raw.id ?? raw.sessionId,
    startedAt: parseDate(raw.startedAt ?? raw.started_at),
  };
}

function parseExtractedTask(raw: any): ExtractedTask {
  return {
    ...raw,
    summary: raw.summary || raw.text?.slice(0, 60) || '',
    fullText: raw.text || raw.fullText || '',
    createdAt: parseDate(raw.createdAt ?? raw.created_at),
    updatedAt: parseDate(raw.updatedAt ?? raw.updated_at),
    completedAt: raw.completedAt || raw.completed_at ? parseDate(raw.completedAt ?? raw.completed_at) : undefined,
  };
}

function parseGoal(raw: any): Goal {
  return {
    ...raw,
    taskIds: raw.taskIds || [],
    completedCount: raw.completedCount ?? raw.completed_count ?? 0,
    totalCount: raw.totalCount ?? raw.total_count ?? 0,
    createdAt: parseDate(raw.createdAt ?? raw.created_at),
    updatedAt: parseDate(raw.updatedAt ?? raw.updated_at),
    completedAt: raw.completedAt || raw.completed_at ? parseDate(raw.completedAt ?? raw.completed_at) : undefined,
  };
}

function parseConsoleThread(raw: any): ConsoleThread {
  return {
    ...raw,
    previousNames: raw.previousNames || raw.previous_names || [],
    sessionCount: raw.sessionCount ?? raw.session_count ?? 0,
    createdAt: parseDate(raw.createdAt ?? raw.created_at),
    updatedAt: parseDate(raw.updatedAt ?? raw.updated_at),
  };
}

// ============================================================================
// Props
// ============================================================================

export interface TasksWidgetContainerProps {
  // UI state (passed through to TasksWidget)
  panelId?: string;
  isFocused?: boolean;
  isHovered?: boolean;
  onFocus?: () => void;
  onClose?: () => void;
  onMaximize?: () => void;
  onMouseEnter?: () => void;
  onMouseLeave?: () => void;

  // WebSocket for real-time updates
  ws?: WebSocket | null;

  // Workspace path for filtering tasks/goals/sessions
  workspacePath?: string;

  // For sending tasks to console
  onSendToConsole?: (taskText: string, consoleId?: string) => void;

  // For highlighting/focusing a console by thread ID
  onHighlightConsole?: (threadId: string) => void;
}

// ============================================================================
// Component
// ============================================================================

export function TasksWidgetContainer({
  panelId,
  isFocused,
  isHovered,
  onFocus,
  onClose,
  onMaximize,
  onMouseEnter,
  onMouseLeave,
  ws,
  workspacePath,
  onSendToConsole,
  onHighlightConsole,
}: TasksWidgetContainerProps) {
  // Tab state - default to "active" per design decision
  const [activeTab, setActiveTab] = useState<TasksTab>('active');

  // ============================================================================
  // Reactive Queries (Convex-style)
  // These automatically update when data changes on the server
  // Pass workspacePath to filter data by current workspace
  // ============================================================================

  const { data: activeSessionsData } = useActiveSessions(ws ?? null, workspacePath);
  const { data: recentSessionsData } = useRecentSessions(ws ?? null, 10, workspacePath);
  const { data: tasksData } = useTasks(ws ?? null, { limit: 100, includeCompleted: true, projectPath: workspacePath });
  const { data: inboxTasksData } = useInboxTasks(ws ?? null, workspacePath);
  const { data: goalsData } = useGoals(ws ?? null, { projectPath: workspacePath });
  const { data: threadsData } = useConsoleThreads(ws ?? null, { status: 'active', projectPath: workspacePath });

  // Parse and memoize data with proper date handling
  const activeSessions = useMemo(() => {
    if (!activeSessionsData) return [];
    return activeSessionsData.map(parseActiveSession);
  }, [activeSessionsData]);

  const recentlyCompleted = useMemo(() => {
    if (!recentSessionsData) return [];
    return recentSessionsData.map(parseActiveSession);
  }, [recentSessionsData]);

  const workItems = useMemo(() => {
    if (!tasksData) return [];
    return tasksData.map(parseExtractedTask);
  }, [tasksData]);

  const inboxTasks = useMemo(() => {
    if (!inboxTasksData) return [];
    return inboxTasksData.map(parseExtractedTask);
  }, [inboxTasksData]);

  const goals = useMemo(() => {
    if (!goalsData) return [];
    return goalsData.map(parseGoal);
  }, [goalsData]);

  const threads = useMemo(() => {
    if (!threadsData) return [];
    return threadsData.map(parseConsoleThread);
  }, [threadsData]);

  // ============================================================================
  // Legacy Event Handling
  // Some events need special UI logic that can't be handled by reactive queries
  // (e.g., prompt.summary_updated for optimistic updates before query refreshes)
  // ============================================================================

  // Local state for optimistic updates and prompt lifecycle
  const [localActiveSessions, setLocalActiveSessions] = useState<ActiveSession[]>([]);
  const [localRecentlyCompleted, setLocalRecentlyCompleted] = useState<ActiveSession[]>([]);

  // Phase 4: Overlap warning state
  interface OverlapWarningState {
    newThreadId: string;
    newThreadName: string;
    newConsoleId: string;
    existingThreadId: string;
    existingThreadName: string;
    existingConsoleId: string;
    similarity: number;
  }
  const [overlapWarning, setOverlapWarning] = useState<OverlapWarningState | null>(null);

  // Phase 5: Evolution suggestion state
  interface EvolutionSuggestionState {
    threadId: string;
    currentName: string;
    suggestedName: string;
    evolutionType: 'evolution' | 'new_topic';
    confidence: number;
  }
  const [evolutionSuggestion, setEvolutionSuggestion] = useState<EvolutionSuggestionState | null>(null);

  // Merge reactive data with local overrides (deduplicated by id)
  const mergedActiveSessions = useMemo(() => {
    // If we have local sessions (from prompt.started before query updates), merge them
    const reactiveIds = new Set(activeSessions.map(s => s.id));
    const localOnly = localActiveSessions.filter(s => !reactiveIds.has(s.id));
    const merged = [...activeSessions, ...localOnly];
    // Deduplicate by id (keep first occurrence)
    const seen = new Set<string>();
    return merged.filter(s => {
      if (seen.has(s.id)) return false;
      seen.add(s.id);
      return true;
    });
  }, [activeSessions, localActiveSessions]);

  const mergedRecentlyCompleted = useMemo(() => {
    const reactiveIds = new Set(recentlyCompleted.map(s => s.id));
    const localOnly = localRecentlyCompleted.filter(s => !reactiveIds.has(s.id));
    const merged = [...recentlyCompleted, ...localOnly];
    // Deduplicate by id (keep first occurrence)
    const seen = new Set<string>();
    return merged.filter(s => {
      if (seen.has(s.id)) return false;
      seen.add(s.id);
      return true;
    });
  }, [recentlyCompleted, localRecentlyCompleted]);

  // Handle prompt lifecycle events (for optimistic UI updates)
  useEffect(() => {
    if (!ws) return;

    const handleMessage = (event: MessageEvent) => {
      try {
        const data = JSON.parse(event.data);
        if (data.type !== 'event') return;

        const evt = data.event;
        if (!evt) return;

        // Handle prompt.started for immediate UI feedback
        // (The reactive query will also update, but this is faster)
        if (evt.type === 'prompt.started') {
          const session = parseActiveSession(evt.payload);
          setLocalActiveSessions(prev => {
            const existing = prev.findIndex(s => s.id === session.id);
            if (existing >= 0) {
              const updated = [...prev];
              updated[existing] = session;
              return updated;
            }
            return [...prev, session];
          });
        }

        // Handle prompt.completed - move to recently completed
        if (evt.type === 'prompt.completed') {
          const { sessionId, status, durationMs } = evt.payload;
          setLocalActiveSessions(prev => {
            const session = prev.find(s => s.id === sessionId);
            if (session) {
              const completed: ActiveSession = {
                ...session,
                status,
                durationMs,
              };
              setLocalRecentlyCompleted(recent => [completed, ...recent.slice(0, 9)]);
            }
            return prev.filter(s => s.id !== sessionId);
          });
        }

        // Handle AI-generated summary updates (optimistic update)
        if (evt.type === 'prompt.summary_updated') {
          const { sessionId, summary } = evt.payload;
          setLocalActiveSessions(prev => prev.map(s =>
            s.id === sessionId ? { ...s, summary } : s
          ));
        }

        // Phase 4: Handle thread overlap warnings
        if (evt.type === 'thread.overlap_warning') {
          setOverlapWarning(evt.payload);
        }

        // Phase 5: Handle thread evolution suggestions
        if (evt.type === 'thread.evolution_suggested') {
          setEvolutionSuggestion(evt.payload);
        }

        // Clear local state when it's superseded by reactive updates
        // This keeps local state clean over time

      } catch {
        // Ignore parse errors
      }
    };

    ws.addEventListener('message', handleMessage);
    return () => ws.removeEventListener('message', handleMessage);
  }, [ws]);

  // Clean up local state when reactive data arrives
  useEffect(() => {
    // Remove local sessions that are now in reactive data
    const reactiveActiveIds = new Set(activeSessions.map(s => s.id));
    const reactiveRecentIds = new Set(recentlyCompleted.map(s => s.id));

    setLocalActiveSessions(prev => prev.filter(s => !reactiveActiveIds.has(s.id)));
    setLocalRecentlyCompleted(prev => prev.filter(s => !reactiveRecentIds.has(s.id)));
  }, [activeSessions, recentlyCompleted]);

  // Loading states
  const [isLoadingSuggestions, setIsLoadingSuggestions] = useState(false);

  // ============================================================================
  // Action Handlers
  // These call the API and rely on reactive queries to update the UI
  // ============================================================================

  const handleDismissSession = useCallback(async (sessionId: string) => {
    try {
      await api.post(`/sessions/${sessionId}/dismiss`);
      // Optimistic update - remove from local state
      setLocalRecentlyCompleted(prev => prev.filter(s => s.id !== sessionId));
    } catch (err) {
      console.error('[TasksWidgetContainer] Failed to dismiss session:', err);
    }
  }, []);

  const handleStopSession = useCallback(async (sessionId: string) => {
    try {
      // Use the stop endpoint for graceful interrupt
      // This stops the current turn but keeps the session active for continued chat
      const response = await api.post(`/sessions/${sessionId}/stop`);
      const data = await response.json();

      if (data.ok) {
        console.log(`[TasksWidgetContainer] Session ${sessionId} interrupted:`, data.message);
        // Session stays in active list - user can continue chatting
        // The isStreaming state will update automatically via WebSocket events
      } else {
        console.warn(`[TasksWidgetContainer] Failed to stop session:`, data.error || data.message);
      }
    } catch (err) {
      console.error('[TasksWidgetContainer] Failed to stop session:', err);
    }
  }, []);

  const handleDeleteSession = useCallback(async (sessionId: string) => {
    try {
      await api.delete(`/sessions/${sessionId}`);
      // Optimistic update
      setLocalActiveSessions(prev => prev.filter(s => s.id !== sessionId));
      setLocalRecentlyCompleted(prev => prev.filter(s => s.id !== sessionId));
    } catch (err) {
      console.error('[TasksWidgetContainer] Failed to delete session:', err);
    }
  }, []);

  const handleHighlightConsole = useCallback((sessionId: string) => {
    // The sessionId is the threadId which corresponds to a console
    onHighlightConsole?.(sessionId);
  }, [onHighlightConsole]);

  const handleDismissTask = useCallback(async (taskId: string) => {
    try {
      await api.post(`/extracted-tasks/${taskId}/dismiss`);
      // Reactive query will update automatically
    } catch (err) {
      console.error('[TasksWidgetContainer] Failed to dismiss task:', err);
    }
  }, []);

  const handleCompleteTask = useCallback(async (taskId: string) => {
    try {
      await api.post(`/extracted-tasks/${taskId}/complete`);
      // Reactive query will update automatically
    } catch (err) {
      console.error('[TasksWidgetContainer] Failed to complete task:', err);
    }
  }, []);

  const handleSendToConsole = useCallback((taskId: string, consoleId?: string) => {
    const task = workItems.find(t => t.id === taskId);
    if (task && onSendToConsole) {
      onSendToConsole(task.fullText || task.summary, consoleId);
    }
  }, [workItems, onSendToConsole]);

  const handleCreateGoal = useCallback(async (title: string) => {
    try {
      await api.post('/goals', {
        title,
        createdVia: 'manual',
        projectPath: workspacePath,
      });
      // Reactive query will update automatically
    } catch (err) {
      console.error('[TasksWidgetContainer] Failed to create goal:', err);
    }
  }, [workspacePath]);

  const handleArchiveGoal = useCallback(async (goalId: string) => {
    try {
      await api.delete(`/goals/${goalId}`);
      // Reactive query will update automatically
    } catch (err) {
      console.error('[TasksWidgetContainer] Failed to archive goal:', err);
    }
  }, []);

  const handleMoveToGoal = useCallback(async (taskId: string, goalId: string) => {
    try {
      await api.post(`/extracted-tasks/${taskId}/move-to-goal`, { goalId });
      // Reactive queries will update automatically
    } catch (err) {
      console.error('[TasksWidgetContainer] Failed to move task to goal:', err);
    }
  }, []);

  const handleSuggestGoalGroupings = useCallback(async () => {
    setIsLoadingSuggestions(true);
    try {
      const res = await api.post('/goals/suggest');
      if (res.ok) {
        const suggestions = await res.json();
        // TODO: Show suggestions in a modal/dropdown for user to review
        console.log('[TasksWidgetContainer] Goal suggestions:', suggestions);
      }
    } catch (err) {
      console.error('[TasksWidgetContainer] Failed to get suggestions:', err);
    } finally {
      setIsLoadingSuggestions(false);
    }
  }, []);

  // Phase 4: Dismiss overlap warning
  const handleDismissOverlapWarning = useCallback(() => {
    setOverlapWarning(null);
  }, []);

  // Phase 5: Evolution suggestion handlers
  const handleDismissEvolutionSuggestion = useCallback(() => {
    setEvolutionSuggestion(null);
  }, []);

  const handleAcceptEvolution = useCallback(async () => {
    if (!evolutionSuggestion) return;

    try {
      // Create a new thread with the suggested name
      // For now, just dismiss - in the future, this could create a new thread
      // via API call: POST /threads with { name: evolutionSuggestion.suggestedName }
      console.log(`[TasksWidgetContainer] User accepted evolution to: "${evolutionSuggestion.suggestedName}"`);
      setEvolutionSuggestion(null);
    } catch (err) {
      console.error('[TasksWidgetContainer] Failed to accept evolution:', err);
    }
  }, [evolutionSuggestion]);

  // ============================================================================
  // Render
  // ============================================================================

  return (
    <TasksWidget
      activeTab={activeTab}
      onTabChange={setActiveTab}
      activeSessions={mergedActiveSessions}
      recentlyCompleted={mergedRecentlyCompleted}
      threads={threads}
      onDismissSession={handleDismissSession}
      onStopSession={handleStopSession}
      onDeleteSession={handleDeleteSession}
      onHighlightConsole={handleHighlightConsole}
      workItems={workItems}
      onDismissTask={handleDismissTask}
      onCompleteTask={handleCompleteTask}
      onSendToConsole={handleSendToConsole}
      goals={goals}
      inboxTasks={inboxTasks}
      onCreateGoal={handleCreateGoal}
      onArchiveGoal={handleArchiveGoal}
      onMoveToGoal={handleMoveToGoal}
      onSuggestGoalGroupings={handleSuggestGoalGroupings}
      isLoadingSuggestions={isLoadingSuggestions}
      overlapWarning={overlapWarning}
      onDismissOverlapWarning={handleDismissOverlapWarning}
      evolutionSuggestion={evolutionSuggestion}
      onDismissEvolutionSuggestion={handleDismissEvolutionSuggestion}
      onAcceptEvolution={handleAcceptEvolution}
      panelId={panelId}
      isFocused={isFocused}
      isHovered={isHovered}
      onFocus={onFocus}
      onClose={onClose}
      onMaximize={onMaximize}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
    />
  );
}

export default TasksWidgetContainer;
