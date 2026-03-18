/**
 * TasksWidget - Three-Tier Task Management Widget
 *
 * Tabs:
 * - Active: Currently running prompts (Tier 1)
 * - Work Items: Extracted tasks from agent outputs (Tier 2)
 * - Goals: Organizing containers with progress tracking (Tier 3)
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import {
  Sparkles,
  Plus,
  X,
  Maximize2,
  Loader2,
  Check,
  ChevronRight,
  ChevronDown,
  Play,
  MoreVertical,
  Inbox,
  Target,
  Clock,
  FolderOpen,
  Trash2,
  GripVertical,
  MonitorDot,
  StopCircle,
} from 'lucide-react';
import { useDraggable } from '@dnd-kit/core';
import type {
  ActiveSession,
  ExtractedTask,
  Goal,
} from '@acc/contracts';

// Inline DraggableHandle (duplicated from Workspace.tsx to avoid circular deps)
function DraggableHandle({ panelId }: { panelId: string }) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: panelId,
  });

  return (
    <div
      ref={setNodeRef}
      {...listeners}
      {...attributes}
      className={`cursor-grab active:cursor-grabbing p-1 rounded hover:bg-zinc-700/50 transition-colors ${
        isDragging ? 'opacity-50' : ''
      }`}
      title="Drag to reorder"
    >
      <GripVertical className="w-3.5 h-3.5 text-zinc-500" />
    </div>
  );
}

export type TasksTab = 'active' | 'work-items' | 'goals';

export interface TasksWidgetProps {
  // Tab state
  activeTab: TasksTab;
  onTabChange: (tab: TasksTab) => void;

  // Tier 1: Active Sessions
  activeSessions: ActiveSession[];
  recentlyCompleted: ActiveSession[];
  onDismissSession: (sessionId: string) => void;
  onDeleteSession: (sessionId: string) => void;
  onHighlightConsole: (sessionId: string) => void;

  // Tier 2: Work Items
  workItems: ExtractedTask[];
  onDismissTask: (taskId: string) => void;
  onCompleteTask: (taskId: string) => void;
  onSendToConsole: (taskId: string, consoleId?: string) => void;

  // Tier 3: Goals
  goals: Goal[];
  inboxTasks: ExtractedTask[];
  onCreateGoal: (title: string) => void;
  onArchiveGoal: (goalId: string) => void;
  onMoveToGoal: (taskId: string, goalId: string) => void;
  onSuggestGoalGroupings: () => void;
  isLoadingSuggestions?: boolean;

  // UI state
  panelId?: string;
  isFocused?: boolean;
  isHovered?: boolean;
  onFocus?: () => void;
  onClose?: () => void;
  onMaximize?: () => void;
  onMouseEnter?: () => void;
  onMouseLeave?: () => void;
}

export function TasksWidget({
  activeTab,
  onTabChange,
  activeSessions,
  recentlyCompleted,
  onDismissSession,
  onDeleteSession,
  onHighlightConsole,
  workItems,
  onDismissTask,
  onCompleteTask,
  onSendToConsole,
  goals,
  inboxTasks,
  onCreateGoal,
  onArchiveGoal,
  onMoveToGoal,
  onSuggestGoalGroupings,
  isLoadingSuggestions,
  panelId,
  isFocused,
  isHovered,
  onFocus,
  onClose,
  onMaximize,
  onMouseEnter,
  onMouseLeave,
}: TasksWidgetProps) {
  // Counts for tab badges
  const activeCount = activeSessions.length;
  const workItemsCount = workItems.filter(t => t.status !== 'completed' && t.status !== 'dismissed').length;
  const goalsCount = goals.filter(g => g.status === 'active').length;

  const getBorderClass = () => {
    if (isFocused) return 'border-blue-400/60 ring-1 ring-blue-400/30';
    if (isHovered) return 'border-zinc-600';
    return 'border-zinc-800';
  };

  const getHeaderClass = () => {
    if (isFocused) return 'bg-blue-900/30 border-blue-400/40';
    if (isHovered) return 'bg-zinc-800 border-zinc-700';
    return 'border-zinc-800';
  };

  return (
    <div
      className={`h-full bg-zinc-900 border rounded-lg flex flex-col overflow-hidden transition-all duration-150 ${getBorderClass()}`}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
    >
      {/* Header */}
      <div
        className={`flex-shrink-0 px-3 py-2 border-b flex items-center justify-between gap-2 transition-all duration-150 cursor-pointer ${getHeaderClass()}`}
        onClick={(e) => { e.stopPropagation(); onFocus?.(); }}
      >
        <div className="flex items-center gap-2 min-w-0">
          {panelId && <DraggableHandle panelId={panelId} />}
          <div className="flex items-center gap-1.5 mr-2">
            {onClose && (
              <button onClick={(e) => { e.stopPropagation(); onClose(); }} className="group w-3 h-3 rounded-full bg-red-500/80 hover:bg-red-500 flex items-center justify-center" title="Close">
                <X className="w-2 h-2 text-red-900 opacity-0 group-hover:opacity-100" />
              </button>
            )}
            {onMaximize && (
              <button onClick={(e) => { e.stopPropagation(); onMaximize(); }} className="group w-3 h-3 rounded-full bg-green-500/80 hover:bg-green-500 flex items-center justify-center" title="Maximize">
                <Maximize2 className="w-2 h-2 text-green-900 opacity-0 group-hover:opacity-100" />
              </button>
            )}
          </div>
          <Sparkles className="w-4 h-4 text-violet-400 flex-shrink-0" />
          <span className="text-sm font-medium truncate">Tasks</span>
        </div>
      </div>

      {/* Tab Bar */}
      <div className="flex-shrink-0 flex border-b border-zinc-800">
        <TabButton
          active={activeTab === 'active'}
          onClick={() => onTabChange('active')}
          count={activeCount}
          label="Active"
        />
        <TabButton
          active={activeTab === 'work-items'}
          onClick={() => onTabChange('work-items')}
          count={workItemsCount}
          label="Work Items"
        />
        <TabButton
          active={activeTab === 'goals'}
          onClick={() => onTabChange('goals')}
          count={goalsCount}
          label="Goals"
        />
      </div>

      {/* Tab Content */}
      <div className="flex-1 overflow-y-auto">
        {activeTab === 'active' && (
          <ActiveSessionsTab
            sessions={activeSessions}
            recentlyCompleted={recentlyCompleted}
            onDismissSession={onDismissSession}
            onDeleteSession={onDeleteSession}
            onHighlightConsole={onHighlightConsole}
          />
        )}
        {activeTab === 'work-items' && (
          <WorkItemsTab
            items={workItems}
            onDismiss={onDismissTask}
            onComplete={onCompleteTask}
            onSendToConsole={onSendToConsole}
          />
        )}
        {activeTab === 'goals' && (
          <GoalsTab
            goals={goals}
            inboxTasks={inboxTasks}
            onCreateGoal={onCreateGoal}
            onArchiveGoal={onArchiveGoal}
            onMoveToGoal={onMoveToGoal}
            onSuggestGroupings={onSuggestGoalGroupings}
            isLoadingSuggestions={isLoadingSuggestions}
          />
        )}
      </div>
    </div>
  );
}

// ============================================================================
// TAB BUTTON
// ============================================================================

function TabButton({
  active,
  onClick,
  count,
  label,
}: {
  active: boolean;
  onClick: () => void;
  count: number;
  label: string;
}) {
  return (
    <button
      onClick={onClick}
      className={`flex-1 px-3 py-2 text-xs font-medium transition-colors relative ${
        active
          ? 'text-violet-400 bg-violet-500/10'
          : 'text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800/50'
      }`}
    >
      <span>{label}</span>
      {count > 0 && (
        <span className={`ml-1.5 px-1.5 py-0.5 rounded-full text-[10px] ${
          active ? 'bg-violet-500/30 text-violet-300' : 'bg-zinc-700 text-zinc-400'
        }`}>
          {count}
        </span>
      )}
      {active && (
        <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-violet-500" />
      )}
    </button>
  );
}

// ============================================================================
// TIER 1: ACTIVE SESSIONS TAB
// ============================================================================

function ActiveSessionsTab({
  sessions,
  recentlyCompleted,
  onDismissSession,
  onDeleteSession,
  onHighlightConsole,
}: {
  sessions: ActiveSession[];
  recentlyCompleted: ActiveSession[];
  onDismissSession: (id: string) => void;
  onDeleteSession: (id: string) => void;
  onHighlightConsole: (id: string) => void;
}) {
  if (sessions.length === 0 && recentlyCompleted.length === 0) {
    return (
      <div className="h-full flex flex-col items-center justify-center text-zinc-600 text-sm p-4">
        <Clock className="w-8 h-8 mb-2 opacity-50" />
        <span>No active prompts</span>
        <span className="text-xs mt-1">Send a message to see it here</span>
      </div>
    );
  }

  return (
    <div className="p-2 space-y-2">
      {/* Currently Running */}
      {sessions.map((session) => (
        <ActiveSessionCard
          key={session.id}
          session={session}
          onDelete={() => onDeleteSession(session.id)}
          onHighlightConsole={() => onHighlightConsole(session.id)}
        />
      ))}

      {/* Recently Completed */}
      {recentlyCompleted.length > 0 && (
        <>
          <div className="flex items-center gap-2 px-2 pt-2">
            <div className="h-px flex-1 bg-zinc-800" />
            <span className="text-[10px] text-zinc-600 uppercase tracking-wide">Recently Completed</span>
            <div className="h-px flex-1 bg-zinc-800" />
          </div>
          {recentlyCompleted.map((session) => (
            <RecentSessionCard
              key={session.id}
              session={session}
              onDismiss={() => onDismissSession(session.id)}
            />
          ))}
        </>
      )}
    </div>
  );
}

function ActiveSessionCard({
  session,
  onDelete,
  onHighlightConsole,
}: {
  session: ActiveSession;
  onDelete: () => void;
  onHighlightConsole: () => void;
}) {
  const [elapsed, setElapsed] = useState(0);
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number } | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const start = session.startedAt.getTime();
    const interval = setInterval(() => {
      setElapsed(Date.now() - start);
    }, 1000);
    return () => clearInterval(interval);
  }, [session.startedAt]);

  // Close context menu on click outside
  useEffect(() => {
    if (!contextMenu) return;
    const handleClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setContextMenu(null);
      }
    };
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setContextMenu(null);
    };
    document.addEventListener('mousedown', handleClick);
    document.addEventListener('keydown', handleEscape);
    return () => {
      document.removeEventListener('mousedown', handleClick);
      document.removeEventListener('keydown', handleEscape);
    };
  }, [contextMenu]);

  const handleContextMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    setContextMenu({ x: e.clientX, y: e.clientY });
  };

  const formatDuration = (ms: number) => {
    const seconds = Math.floor(ms / 1000);
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = seconds % 60;
    if (minutes > 0) {
      return `${minutes}m ${remainingSeconds}s`;
    }
    return `${remainingSeconds}s`;
  };

  return (
    <>
      <div
        className="p-3 rounded-lg bg-violet-500/10 border border-violet-500/30 cursor-pointer hover:bg-violet-500/15 transition-colors"
        onContextMenu={handleContextMenu}
        onClick={onHighlightConsole}
        title="Click to highlight console, right-click for options"
      >
        <div className="flex items-start justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0">
            <div className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
            <span className="text-xs text-zinc-400 truncate">{session.agentName}</span>
          </div>
          <span className="text-xs text-zinc-500 flex-shrink-0">{formatDuration(elapsed)}</span>
        </div>
        <p className="text-sm text-zinc-200 mt-1.5 line-clamp-2" title={session.promptText}>
          {session.summary}
        </p>
        <div className="mt-2 h-1 bg-zinc-800 rounded-full overflow-hidden">
          <div className="h-full bg-violet-500/50 animate-pulse" style={{ width: '60%' }} />
        </div>
      </div>

      {/* Context Menu */}
      {contextMenu && (
        <div
          ref={menuRef}
          className="fixed py-1 bg-zinc-800 border border-zinc-700 rounded-lg shadow-xl z-50 min-w-[160px]"
          style={{ left: contextMenu.x, top: contextMenu.y }}
        >
          <button
            onClick={() => { onHighlightConsole(); setContextMenu(null); }}
            className="w-full px-3 py-1.5 text-left text-xs text-zinc-300 hover:bg-zinc-700 flex items-center gap-2"
          >
            <MonitorDot className="w-3.5 h-3.5 text-blue-400" />
            Highlight Console
          </button>
          <div className="h-px bg-zinc-700 my-1" />
          <button
            onClick={() => { onDelete(); setContextMenu(null); }}
            className="w-full px-3 py-1.5 text-left text-xs text-red-400 hover:bg-red-500/10 flex items-center gap-2"
          >
            <StopCircle className="w-3.5 h-3.5" />
            Stop & Delete
          </button>
        </div>
      )}
    </>
  );
}

function RecentSessionCard({
  session,
  onDismiss,
}: {
  session: ActiveSession;
  onDismiss: () => void;
}) {
  const formatDuration = (ms?: number) => {
    if (!ms) return '';
    const seconds = Math.floor(ms / 1000);
    const minutes = Math.floor(seconds / 60);
    if (minutes > 0) return `${minutes}m`;
    return `${seconds}s`;
  };

  return (
    <div className="p-2 rounded border border-zinc-800 bg-zinc-800/30 group">
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <Check className="w-3.5 h-3.5 text-emerald-400 flex-shrink-0" />
          <span className="text-xs text-zinc-300 truncate">{session.summary}</span>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="text-[10px] text-zinc-500">{formatDuration(session.durationMs)}</span>
          <button
            onClick={onDismiss}
            className="opacity-0 group-hover:opacity-100 p-0.5 text-zinc-500 hover:text-zinc-300 transition-opacity"
            title="Dismiss"
          >
            <X className="w-3 h-3" />
          </button>
        </div>
      </div>
    </div>
  );
}

// ============================================================================
// TIER 2: WORK ITEMS TAB
// ============================================================================

function WorkItemsTab({
  items,
  onDismiss,
  onComplete,
  onSendToConsole,
}: {
  items: ExtractedTask[];
  onDismiss: (id: string) => void;
  onComplete: (id: string) => void;
  onSendToConsole: (id: string, consoleId?: string) => void;
}) {
  const inProgress = items.filter(t => t.status === 'doing');
  const planned = items.filter(t => t.status === 'pending');
  const suggested = items.filter(t => t.status === 'suggested');

  if (items.length === 0) {
    return (
      <div className="h-full flex flex-col items-center justify-center text-zinc-600 text-sm p-4">
        <Target className="w-8 h-8 mb-2 opacity-50" />
        <span>No work items</span>
        <span className="text-xs mt-1">Tasks will appear as agents work</span>
      </div>
    );
  }

  return (
    <div className="p-2 space-y-3">
      {inProgress.length > 0 && (
        <WorkItemGroup
          title="In Progress"
          icon={<Loader2 className="w-3.5 h-3.5 text-violet-400 animate-spin" />}
          items={inProgress}
          onDismiss={onDismiss}
          onComplete={onComplete}
          onSendToConsole={onSendToConsole}
        />
      )}
      {planned.length > 0 && (
        <WorkItemGroup
          title="Planned"
          icon={<div className="w-2.5 h-2.5 rounded-full border-2 border-zinc-500" />}
          items={planned}
          onDismiss={onDismiss}
          onComplete={onComplete}
          onSendToConsole={onSendToConsole}
        />
      )}
      {suggested.length > 0 && (
        <WorkItemGroup
          title="Suggested"
          icon={<Sparkles className="w-3.5 h-3.5 text-amber-400" />}
          items={suggested}
          onDismiss={onDismiss}
          onComplete={onComplete}
          onSendToConsole={onSendToConsole}
        />
      )}
    </div>
  );
}

function WorkItemGroup({
  title,
  icon,
  items,
  onDismiss,
  onComplete,
  onSendToConsole,
}: {
  title: string;
  icon: React.ReactNode;
  items: ExtractedTask[];
  onDismiss: (id: string) => void;
  onComplete: (id: string) => void;
  onSendToConsole: (id: string, consoleId?: string) => void;
}) {
  return (
    <div>
      <div className="flex items-center gap-2 px-2 mb-1.5">
        {icon}
        <span className="text-xs font-medium text-zinc-400">{title}</span>
        <span className="text-[10px] text-zinc-600">({items.length})</span>
      </div>
      <div className="space-y-1">
        {items.map((item) => (
          <WorkItemCard
            key={item.id}
            item={item}
            onDismiss={() => onDismiss(item.id)}
            onComplete={() => onComplete(item.id)}
            onSendToConsole={() => onSendToConsole(item.id)}
          />
        ))}
      </div>
    </div>
  );
}

function WorkItemCard({
  item,
  onDismiss,
  onComplete,
  onSendToConsole,
}: {
  item: ExtractedTask;
  onDismiss: () => void;
  onComplete: () => void;
  onSendToConsole: () => void;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menuOpen) return;
    const handleClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [menuOpen]);

  return (
    <div className="px-2 py-1.5 rounded border border-zinc-800 bg-zinc-800/30 group hover:border-zinc-700 transition-colors">
      <div className="flex items-start justify-between gap-2">
        <p
          className="text-xs text-zinc-300 flex-1 line-clamp-2"
          title={item.fullText}
        >
          {item.summary || item.fullText}
        </p>
        <div className="relative flex-shrink-0" ref={menuRef}>
          <button
            onClick={() => setMenuOpen(!menuOpen)}
            className="p-0.5 text-zinc-500 hover:text-zinc-300 opacity-0 group-hover:opacity-100 transition-opacity"
          >
            <MoreVertical className="w-3.5 h-3.5" />
          </button>
          {menuOpen && (
            <div className="absolute top-full right-0 mt-0.5 py-1 bg-zinc-800 border border-zinc-700 rounded shadow-lg z-10 min-w-[140px]">
              <button
                onClick={() => { onSendToConsole(); setMenuOpen(false); }}
                className="w-full px-3 py-1.5 text-left text-xs text-zinc-300 hover:bg-zinc-700 flex items-center gap-2"
              >
                <Play className="w-3 h-3 text-violet-400" />
                Run in console
              </button>
              <button
                onClick={() => { onComplete(); setMenuOpen(false); }}
                className="w-full px-3 py-1.5 text-left text-xs text-zinc-300 hover:bg-zinc-700 flex items-center gap-2"
              >
                <Check className="w-3 h-3 text-emerald-400" />
                Mark complete
              </button>
              <button
                onClick={() => { onDismiss(); setMenuOpen(false); }}
                className="w-full px-3 py-1.5 text-left text-xs text-zinc-300 hover:bg-zinc-700 flex items-center gap-2"
              >
                <X className="w-3 h-3 text-red-400" />
                Dismiss
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ============================================================================
// TIER 3: GOALS TAB
// ============================================================================

function GoalsTab({
  goals,
  inboxTasks,
  onCreateGoal,
  onArchiveGoal,
  onMoveToGoal,
  onSuggestGroupings,
  isLoadingSuggestions,
}: {
  goals: Goal[];
  inboxTasks: ExtractedTask[];
  onCreateGoal: (title: string) => void;
  onArchiveGoal: (goalId: string) => void;
  onMoveToGoal: (taskId: string, goalId: string) => void;
  onSuggestGroupings: () => void;
  isLoadingSuggestions?: boolean;
}) {
  const [showNewGoalInput, setShowNewGoalInput] = useState(false);
  const [newGoalTitle, setNewGoalTitle] = useState('');

  const activeGoals = goals.filter(g => g.status === 'active');

  const handleCreateGoal = () => {
    if (newGoalTitle.trim()) {
      onCreateGoal(newGoalTitle.trim());
      setNewGoalTitle('');
      setShowNewGoalInput(false);
    }
  };

  return (
    <div className="p-2 space-y-2">
      {/* New Goal Button/Input */}
      {showNewGoalInput ? (
        <div className="p-2 border border-zinc-700 rounded-lg space-y-2">
          <input
            type="text"
            value={newGoalTitle}
            onChange={(e) => setNewGoalTitle(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleCreateGoal();
              if (e.key === 'Escape') { setShowNewGoalInput(false); setNewGoalTitle(''); }
            }}
            placeholder="Goal title..."
            className="w-full px-2 py-1 text-xs bg-zinc-800 border border-zinc-600 rounded text-zinc-200 placeholder:text-zinc-500 focus:outline-none focus:border-violet-500"
            autoFocus
          />
          <div className="flex gap-1">
            <button
              onClick={handleCreateGoal}
              className="px-2 py-1 text-xs bg-violet-600 hover:bg-violet-500 rounded"
            >
              Create
            </button>
            <button
              onClick={() => { setShowNewGoalInput(false); setNewGoalTitle(''); }}
              className="px-2 py-1 text-xs text-zinc-400 hover:text-zinc-300"
            >
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <button
          onClick={() => setShowNewGoalInput(true)}
          className="w-full px-3 py-2 text-xs text-zinc-400 hover:text-violet-400 hover:bg-zinc-800 rounded-lg border border-dashed border-zinc-700 hover:border-violet-500/50 transition-colors flex items-center justify-center gap-2"
        >
          <Plus className="w-3.5 h-3.5" />
          New Goal
        </button>
      )}

      {/* Goal List */}
      {activeGoals.map((goal) => (
        <GoalCard
          key={goal.id}
          goal={goal}
          onArchive={() => onArchiveGoal(goal.id)}
        />
      ))}

      {/* Inbox */}
      {inboxTasks.length > 0 && (
        <GoalCard
          goal={{
            id: 'inbox',
            title: 'Inbox',
            description: 'Ungrouped tasks',
            createdVia: 'manual',
            taskIds: inboxTasks.map(t => t.id),
            completedCount: 0,
            totalCount: inboxTasks.length,
            status: 'active',
            createdAt: new Date(),
            updatedAt: new Date(),
          }}
          isInbox
          tasks={inboxTasks}
        />
      )}

      {/* Empty State */}
      {activeGoals.length === 0 && inboxTasks.length === 0 && (
        <div className="py-8 flex flex-col items-center justify-center text-zinc-600 text-sm">
          <FolderOpen className="w-8 h-8 mb-2 opacity-50" />
          <span>No goals yet</span>
          <span className="text-xs mt-1">Create a goal to organize tasks</span>
        </div>
      )}

      {/* AI Suggest Button */}
      {(inboxTasks.length > 2 || activeGoals.length === 0) && (
        <div className="pt-2 border-t border-zinc-800">
          <button
            onClick={onSuggestGroupings}
            disabled={isLoadingSuggestions}
            className="w-full px-3 py-2 text-xs text-zinc-400 hover:text-violet-400 hover:bg-zinc-800/50 rounded-lg transition-colors flex items-center justify-center gap-2 disabled:opacity-50"
          >
            {isLoadingSuggestions ? (
              <>
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                Analyzing tasks...
              </>
            ) : (
              <>
                <Sparkles className="w-3.5 h-3.5" />
                Suggest Groupings
              </>
            )}
          </button>
        </div>
      )}
    </div>
  );
}

function GoalCard({
  goal,
  onArchive,
  isInbox,
  tasks,
}: {
  goal: Goal;
  onArchive?: () => void;
  isInbox?: boolean;
  tasks?: ExtractedTask[];
}) {
  const [expanded, setExpanded] = useState(false);
  const progress = goal.totalCount > 0 ? (goal.completedCount / goal.totalCount) * 100 : 0;

  return (
    <div className="border border-zinc-800 rounded-lg overflow-hidden">
      {/* Header */}
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full px-3 py-2 flex items-center gap-2 hover:bg-zinc-800/50 transition-colors"
      >
        {expanded ? (
          <ChevronDown className="w-3.5 h-3.5 text-zinc-500" />
        ) : (
          <ChevronRight className="w-3.5 h-3.5 text-zinc-500" />
        )}
        {isInbox ? (
          <Inbox className="w-4 h-4 text-zinc-400" />
        ) : (
          <Target className="w-4 h-4 text-violet-400" />
        )}
        <span className="text-sm text-zinc-200 flex-1 text-left truncate">{goal.title}</span>
        <span className="text-[10px] text-zinc-500">
          {goal.completedCount}/{goal.totalCount}
        </span>
      </button>

      {/* Progress Bar */}
      {goal.totalCount > 0 && (
        <div className="h-1 bg-zinc-800">
          <div
            className={`h-full transition-all ${
              progress === 100 ? 'bg-emerald-500' : 'bg-violet-500/50'
            }`}
            style={{ width: `${progress}%` }}
          />
        </div>
      )}

      {/* Expanded Content */}
      {expanded && (
        <div className="px-3 py-2 border-t border-zinc-800 space-y-1">
          {tasks?.map((task) => (
            <div key={task.id} className="flex items-center gap-2 py-1 text-xs text-zinc-400">
              <div className="w-1.5 h-1.5 rounded-full bg-zinc-600" />
              <span className="truncate">{task.summary || task.fullText}</span>
            </div>
          ))}
          {goal.taskIds.length === 0 && !tasks?.length && (
            <div className="text-xs text-zinc-600 py-2 text-center">No tasks</div>
          )}
          {onArchive && !isInbox && (
            <button
              onClick={onArchive}
              className="w-full mt-2 px-2 py-1 text-xs text-zinc-500 hover:text-red-400 hover:bg-red-500/10 rounded flex items-center justify-center gap-1.5 transition-colors"
            >
              <Trash2 className="w-3 h-3" />
              Archive Goal
            </button>
          )}
        </div>
      )}
    </div>
  );
}

export default TasksWidget;
