/**
 * ProjectStartingPoint - Empty state component for workspace
 *
 * Shows a project-centric starting point with:
 * - Hero input for describing tasks
 * - Quick actions based on project analysis
 * - Connected agent indicator
 */

import { useState, useRef, useEffect } from 'react';
import { ArrowRight, Loader2, RefreshCw } from 'lucide-react';
import { useProjectContext } from '../../hooks/useProjectContext';
import { BASE_ACTIONS, type QuickAction, type ProjectContext } from '../../types/quick-actions';

// ============================================================================
// TYPES
// ============================================================================

interface Agent {
  id: string;
  name: string;
  status: 'ready' | 'busy' | 'offline';
  icon: string;
  type: 'claude-code' | 'openclaw';
}

interface ProjectStartingPointProps {
  workspacePath: string;
  agents: Agent[];
  onSubmit: (task: string) => void;
}

// ============================================================================
// QUICK ACTION ITEM COMPONENT
// ============================================================================

function QuickActionItem({
  action,
  onClick,
}: {
  action: QuickAction;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className="w-full flex items-start gap-3 px-3 py-2.5 rounded-lg hover:bg-zinc-800/70 transition-colors text-left group border border-transparent hover:border-zinc-700/50"
    >
      <span className="text-lg mt-0.5 opacity-80 group-hover:opacity-100 transition-opacity">
        {action.icon}
      </span>
      <div className="flex-1 min-w-0">
        <div className="text-sm text-zinc-300 group-hover:text-zinc-100 transition-colors">
          {action.label}
        </div>
        <div className="text-xs text-zinc-500 group-hover:text-zinc-400 transition-colors line-clamp-1">
          {action.description}
        </div>
      </div>
      <ArrowRight className="w-4 h-4 text-zinc-600 opacity-0 group-hover:opacity-100 transition-opacity mt-1.5 flex-shrink-0" />
    </button>
  );
}

// ============================================================================
// LOADING STATE
// ============================================================================

function QuickActionsLoading() {
  return (
    <div className="space-y-2">
      {[1, 2, 3].map((i) => (
        <div key={i} className="flex items-start gap-3 px-3 py-2.5 animate-pulse">
          <div className="w-6 h-6 bg-zinc-800 rounded" />
          <div className="flex-1 space-y-2">
            <div className="h-4 bg-zinc-800 rounded w-32" />
            <div className="h-3 bg-zinc-800/50 rounded w-48" />
          </div>
        </div>
      ))}
    </div>
  );
}

// ============================================================================
// MAIN COMPONENT
// ============================================================================

export function ProjectStartingPoint({
  workspacePath,
  agents,
  onSubmit,
}: ProjectStartingPointProps) {
  const [input, setInput] = useState('');
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const { context, isLoading, error, refresh } = useProjectContext(workspacePath);

  // Auto-resize textarea
  useEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;

    textarea.style.height = 'auto';
    const maxHeight = 150;
    const newHeight = Math.min(textarea.scrollHeight, maxHeight);
    textarea.style.height = `${newHeight}px`;
  }, [input]);

  // Focus textarea on mount
  useEffect(() => {
    textareaRef.current?.focus();
  }, []);

  const handleSubmit = () => {
    const trimmed = input.trim();
    if (!trimmed) return;
    onSubmit(trimmed);
    setInput('');
  };

  const handleQuickAction = (action: QuickAction) => {
    onSubmit(action.prompt);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  const connectedAgent = agents.find((a) => a.status !== 'offline');
  const hasContent = input.trim().length > 0;

  // Combine base actions with contextual suggestions
  const allActions: QuickAction[] = [
    ...BASE_ACTIONS,
    ...(context?.suggestedActions || []),
  ];

  return (
    <div className="h-full flex flex-col items-center justify-center p-8">
      <div className="max-w-xl w-full space-y-6">
        {/* Hero */}
        <div className="text-center">
          <h1 className="text-xl font-medium text-zinc-200 mb-2">
            What would you like to work on?
          </h1>
          <p className="text-sm text-zinc-500">
            {context?.name ? (
              <>Working in <span className="text-zinc-400">{context.name}</span></>
            ) : (
              'Describe a task or choose a quick action below'
            )}
          </p>
        </div>

        {/* Input */}
        <div className="relative">
          <textarea
            ref={textareaRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Fix the authentication bug, add a new feature, refactor this module..."
            className="w-full px-4 py-3 pr-12 bg-zinc-800/50 border border-zinc-700 rounded-lg text-zinc-100 placeholder-zinc-500 focus:outline-none focus:border-violet-500/50 focus:ring-1 focus:ring-violet-500/30 resize-none transition-colors"
            rows={2}
            disabled={!connectedAgent}
          />
          <button
            onClick={handleSubmit}
            disabled={!hasContent || !connectedAgent}
            className="absolute right-3 bottom-3 p-1.5 rounded-md text-zinc-500 hover:text-violet-400 hover:bg-violet-500/10 disabled:opacity-30 disabled:hover:bg-transparent disabled:hover:text-zinc-500 transition-colors"
            title={!connectedAgent ? 'No agent connected' : 'Send'}
          >
            <ArrowRight className="w-5 h-5" />
          </button>
        </div>

        {/* Quick Actions */}
        <div className="space-y-2">
          <div className="flex items-center justify-between px-1">
            <p className="text-xs text-zinc-500 uppercase tracking-wide">
              Quick Actions
            </p>
            {context && !isLoading && (
              <button
                onClick={refresh}
                className="p-1 text-zinc-600 hover:text-zinc-400 transition-colors"
                title="Refresh suggestions"
              >
                <RefreshCw className="w-3 h-3" />
              </button>
            )}
          </div>

          {isLoading ? (
            <QuickActionsLoading />
          ) : error ? (
            <div className="px-3 py-4 text-center">
              <p className="text-sm text-zinc-500">Failed to analyze project</p>
              <button
                onClick={refresh}
                className="mt-2 text-xs text-violet-400 hover:text-violet-300"
              >
                Try again
              </button>
            </div>
          ) : (
            <div className="space-y-1">
              {/* Base actions */}
              {BASE_ACTIONS.map((action) => (
                <QuickActionItem
                  key={action.id}
                  action={action}
                  onClick={() => handleQuickAction(action)}
                />
              ))}

              {/* Contextual actions separator */}
              {context?.suggestedActions && context.suggestedActions.length > 0 && (
                <>
                  <div className="flex items-center gap-2 px-2 py-2">
                    <div className="h-px flex-1 bg-zinc-800" />
                    <span className="text-[10px] text-zinc-600 uppercase tracking-wide">
                      Project Actions
                    </span>
                    <div className="h-px flex-1 bg-zinc-800" />
                  </div>

                  {context.suggestedActions.map((action) => (
                    <QuickActionItem
                      key={action.id}
                      action={action}
                      onClick={() => handleQuickAction(action)}
                    />
                  ))}
                </>
              )}
            </div>
          )}
        </div>

        {/* Agent Status */}
        <div className="text-center text-xs text-zinc-600 pt-2">
          {connectedAgent ? (
            <span className="flex items-center justify-center gap-1.5">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
              <span className="text-zinc-500">
                {connectedAgent.icon} {connectedAgent.name}
              </span>
              <span className="text-zinc-600">connected</span>
            </span>
          ) : agents.length > 0 ? (
            <span className="flex items-center justify-center gap-1.5">
              <span className="w-1.5 h-1.5 rounded-full bg-zinc-600" />
              <span className="text-zinc-500">Agent offline</span>
            </span>
          ) : (
            <span className="flex items-center justify-center gap-1.5">
              <Loader2 className="w-3 h-3 animate-spin" />
              <span>Connecting to agents...</span>
            </span>
          )}
        </div>

        {/* Project Info (subtle) */}
        {context && (
          <div className="text-center text-xs text-zinc-700">
            {context.type !== 'unknown' && (
              <span className="capitalize">{context.type} project</span>
            )}
            {context.isGitRepo && (
              <span>
                {context.type !== 'unknown' && ' · '}
                {context.recentCommits.length > 0
                  ? `${context.recentCommits.length} recent commits`
                  : 'Git enabled'}
              </span>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
