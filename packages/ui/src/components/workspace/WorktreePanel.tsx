/**
 * WorktreePanel - Shows file changes and merge actions for worktree-isolated consoles
 */

import { useState, useEffect, useCallback } from 'react';
import {
  GitBranch,
  GitMerge,
  FileText,
  FilePlus,
  FileMinus,
  FileEdit,
  FileQuestion,
  RefreshCw,
  ChevronDown,
  ChevronRight,
  AlertTriangle,
  CheckCircle,
  XCircle,
  ExternalLink,
  Loader2,
  Trash2,
  Terminal,
} from 'lucide-react';
import { getServerUrl } from '../../stores/app';
import type { WorktreeChanges, MergeResult, FileStatus } from '@acc/contracts';

interface WorktreePanelProps {
  threadId: string;
  isOpen: boolean;
  onClose: () => void;
  /** Called when worktree is successfully merged and removed */
  onMerged?: () => void;
  /** Called to open a terminal in the worktree directory */
  onOpenTerminal?: (cwd: string) => void;
}

interface WorktreeInfo {
  path: string;
  branch: string;
  baseBranch: string;
  isClean: boolean;
}

/** Get icon and color for file status */
function getFileStatusDisplay(status: FileStatus): { icon: typeof FileText; color: string; label: string } {
  switch (status) {
    case 'added':
    case 'untracked':
      return { icon: FilePlus, color: 'text-green-400', label: 'Added' };
    case 'deleted':
      return { icon: FileMinus, color: 'text-red-400', label: 'Deleted' };
    case 'modified':
      return { icon: FileEdit, color: 'text-yellow-400', label: 'Modified' };
    case 'renamed':
      return { icon: FileEdit, color: 'text-blue-400', label: 'Renamed' };
    case 'copied':
      return { icon: FilePlus, color: 'text-blue-400', label: 'Copied' };
    default:
      return { icon: FileQuestion, color: 'text-zinc-400', label: status };
  }
}

/** Format error messages for better UX */
function formatMergeError(error: string): string {
  if (error.includes('CONFLICT')) {
    return 'Merge conflicts detected. Please resolve conflicts manually or discard changes.';
  }
  if (error.includes('not a git repository')) {
    return 'Git repository not found. The worktree may have been deleted.';
  }
  if (error.includes('does not point to a valid object')) {
    return 'Branch reference is invalid. The branch may have been deleted.';
  }
  if (error.includes('Permission denied')) {
    return 'Permission denied. Check file permissions in the worktree directory.';
  }
  if (error.includes('checkout')) {
    return 'Failed to checkout target branch. There may be uncommitted changes in the main repository.';
  }
  return error;
}

export function WorktreePanel({ threadId, isOpen, onClose, onMerged, onOpenTerminal }: WorktreePanelProps) {
  const [worktreeInfo, setWorktreeInfo] = useState<WorktreeInfo | null>(null);
  const [changes, setChanges] = useState<WorktreeChanges | null>(null);
  const [loading, setLoading] = useState(true);
  const [merging, setMerging] = useState(false);
  const [discarding, setDiscarding] = useState(false);
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const [mergeResult, setMergeResult] = useState<MergeResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [expandedFiles, setExpandedFiles] = useState<Set<string>>(new Set());

  const serverUrl = getServerUrl();

  const fetchData = useCallback(async () => {
    if (!threadId) return;

    setLoading(true);
    setError(null);

    try {
      // Fetch worktree info
      const infoRes = await fetch(`${serverUrl}/threads/${threadId}/worktree`);
      if (!infoRes.ok) {
        if (infoRes.status === 404) {
          setWorktreeInfo(null);
          setChanges(null);
          return;
        }
        throw new Error('Failed to fetch worktree info');
      }
      const infoData = await infoRes.json();
      if (infoData.ok && infoData.worktree) {
        setWorktreeInfo(infoData.worktree);
      }

      // Fetch changes
      const changesRes = await fetch(`${serverUrl}/threads/${threadId}/worktree/changes`);
      if (changesRes.ok) {
        const changesData = await changesRes.json();
        if (changesData.ok && changesData.changes) {
          setChanges(changesData.changes);
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load worktree data');
    } finally {
      setLoading(false);
    }
  }, [threadId, serverUrl]);

  useEffect(() => {
    if (isOpen) {
      fetchData();
    }
  }, [isOpen, fetchData]);

  const handleMerge = async (removeAfterMerge = true) => {
    if (!worktreeInfo) return;

    setMerging(true);
    setMergeResult(null);
    setError(null);

    try {
      const res = await fetch(`${serverUrl}/threads/${threadId}/worktree/merge`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          targetBranch: worktreeInfo.baseBranch,
          removeAfterMerge,
        }),
      });

      const data = await res.json();
      if (data.ok) {
        setMergeResult(data);
        if (data.success && removeAfterMerge) {
          // Notify parent that worktree was merged and removed
          onMerged?.();
          // Close the panel after a brief delay to show success message
          setTimeout(() => {
            onClose();
          }, 1500);
        } else if (data.success) {
          // Just refresh data if not removing
          await fetchData();
        }
      } else {
        setError(formatMergeError(data.error || 'Merge failed'));
      }
    } catch (err) {
      setError(formatMergeError(err instanceof Error ? err.message : 'Merge failed'));
    } finally {
      setMerging(false);
    }
  };

  const handleDiscard = async () => {
    if (!worktreeInfo) return;

    setDiscarding(true);
    setError(null);

    try {
      const res = await fetch(`${serverUrl}/threads/${threadId}/worktree?force=true`, {
        method: 'DELETE',
      });

      const data = await res.json();
      if (data.ok) {
        // Notify parent that worktree was removed
        onMerged?.();
        onClose();
      } else {
        setError(data.error || 'Failed to discard worktree');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to discard worktree');
    } finally {
      setDiscarding(false);
      setConfirmDiscard(false);
    }
  };

  const toggleFile = (path: string) => {
    setExpandedFiles((prev) => {
      const next = new Set(prev);
      if (next.has(path)) {
        next.delete(path);
      } else {
        next.add(path);
      }
      return next;
    });
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-zinc-900 border border-zinc-700 rounded-xl w-full max-w-2xl max-h-[80vh] overflow-hidden flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-zinc-800">
          <div className="flex items-center gap-2">
            <GitBranch className="w-5 h-5 text-violet-400" />
            <h2 className="text-lg font-semibold">Worktree Changes</h2>
          </div>
          <button
            onClick={onClose}
            className="p-1 hover:bg-zinc-800 rounded text-zinc-400 hover:text-zinc-200"
          >
            <XCircle className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {loading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="w-6 h-6 text-zinc-400 animate-spin" />
              <span className="ml-2 text-zinc-400">Loading worktree data...</span>
            </div>
          ) : error ? (
            <div className="flex items-center gap-2 p-3 bg-red-900/20 border border-red-800 rounded-lg text-red-400">
              <AlertTriangle className="w-4 h-4" />
              <span>{error}</span>
            </div>
          ) : !worktreeInfo ? (
            <div className="text-center py-8 text-zinc-500">
              <GitBranch className="w-8 h-8 mx-auto mb-2 opacity-50" />
              <p>No worktree enabled for this console.</p>
              <p className="text-sm mt-1">Enable worktree isolation to track changes.</p>
            </div>
          ) : (
            <>
              {/* Branch Info */}
              <div className="bg-zinc-800/50 rounded-lg p-4 space-y-2">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <GitBranch className="w-4 h-4 text-violet-400" />
                    <span className="font-medium text-violet-400">{worktreeInfo.branch}</span>
                  </div>
                  <button
                    onClick={() => fetchData()}
                    className="p-1.5 hover:bg-zinc-700 rounded text-zinc-400 hover:text-zinc-200"
                    title="Refresh"
                  >
                    <RefreshCw className="w-4 h-4" />
                  </button>
                </div>
                <div className="text-xs text-zinc-500">
                  Base: <span className="text-zinc-400">{worktreeInfo.baseBranch}</span>
                </div>
                <div className="text-xs text-zinc-500 truncate" title={worktreeInfo.path}>
                  Path: <span className="text-zinc-400">{worktreeInfo.path}</span>
                </div>
              </div>

              {/* Changes Summary */}
              {changes && (
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <h3 className="text-sm font-medium text-zinc-300">Changes</h3>
                    <div className="flex items-center gap-3 text-xs">
                      <span className="text-zinc-400">
                        {changes.summary.filesChanged} file{changes.summary.filesChanged !== 1 ? 's' : ''}
                      </span>
                      <span className="text-green-400">+{changes.summary.insertions}</span>
                      <span className="text-red-400">-{changes.summary.deletions}</span>
                    </div>
                  </div>

                  {changes.files.length === 0 ? (
                    <div className="text-center py-4 text-zinc-500 bg-zinc-800/30 rounded-lg">
                      <CheckCircle className="w-6 h-6 mx-auto mb-1 text-green-500/50" />
                      <p className="text-sm">No changes yet</p>
                    </div>
                  ) : (
                    <div className="space-y-1">
                      {changes.files.map((file) => {
                        const statusDisplay = getFileStatusDisplay(file.status);
                        const StatusIcon = statusDisplay.icon;
                        return (
                          <div
                            key={file.path}
                            className="bg-zinc-800/30 rounded-lg overflow-hidden"
                          >
                            <button
                              onClick={() => toggleFile(file.path)}
                              className="w-full flex items-center gap-2 p-2 hover:bg-zinc-800/50 text-left"
                              title={`${file.path} (${statusDisplay.label})`}
                            >
                              {expandedFiles.has(file.path) ? (
                                <ChevronDown className="w-3 h-3 text-zinc-500 flex-shrink-0" />
                              ) : (
                                <ChevronRight className="w-3 h-3 text-zinc-500 flex-shrink-0" />
                              )}
                              <StatusIcon className={`w-4 h-4 flex-shrink-0 ${statusDisplay.color}`} />
                              <span className="flex-1 min-w-0 text-sm text-zinc-300 truncate">
                                {file.path}
                              </span>
                              <span className="text-xs text-green-400 flex-shrink-0">+{file.additions ?? 0}</span>
                              <span className="text-xs text-red-400 flex-shrink-0">-{file.deletions ?? 0}</span>
                            </button>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}

              {/* Merge Result */}
              {mergeResult && (
                <div
                  className={`p-3 rounded-lg border ${
                    mergeResult.success
                      ? 'bg-green-900/20 border-green-800 text-green-400'
                      : 'bg-red-900/20 border-red-800 text-red-400'
                  }`}
                >
                  <div className="flex items-center gap-2">
                    {mergeResult.success ? (
                      <CheckCircle className="w-4 h-4" />
                    ) : (
                      <AlertTriangle className="w-4 h-4" />
                    )}
                    <span className="font-medium">
                      {mergeResult.success ? 'Merge successful!' : 'Merge failed'}
                    </span>
                  </div>
                  {mergeResult.message && (
                    <p className="text-sm mt-1 opacity-80">{mergeResult.message}</p>
                  )}
                  {mergeResult.hasConflicts && mergeResult.conflictedFiles && (
                    <div className="mt-2 text-sm">
                      <p className="font-medium">Conflicted files:</p>
                      <ul className="list-disc list-inside mt-1">
                        {mergeResult.conflictedFiles.map((f) => (
                          <li key={f}>{f}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              )}
            </>
          )}
        </div>

        {/* Discard Confirmation */}
        {confirmDiscard && (
          <div className="p-4 border-t border-zinc-800 bg-red-900/20">
            <div className="flex items-start gap-3">
              <AlertTriangle className="w-5 h-5 text-red-400 flex-shrink-0 mt-0.5" />
              <div className="flex-1">
                <p className="text-sm font-medium text-red-400">Discard all changes?</p>
                <p className="text-xs text-red-400/70 mt-1">
                  This will delete the worktree and all uncommitted changes. This action cannot be undone.
                </p>
                <div className="flex items-center gap-2 mt-3">
                  <button
                    onClick={() => setConfirmDiscard(false)}
                    disabled={discarding}
                    className="px-3 py-1.5 text-sm text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800 rounded"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={handleDiscard}
                    disabled={discarding}
                    className="flex items-center gap-2 px-3 py-1.5 text-sm bg-red-600 hover:bg-red-500 disabled:opacity-50 rounded"
                  >
                    {discarding ? (
                      <Loader2 className="w-3 h-3 animate-spin" />
                    ) : (
                      <Trash2 className="w-3 h-3" />
                    )}
                    Yes, Discard
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Footer Actions */}
        {worktreeInfo && !loading && !confirmDiscard && (
          <div className="p-4 border-t border-zinc-800 bg-zinc-900/50 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <button
                onClick={() => {
                  console.log('[WorktreePanel] Open Terminal clicked, path:', worktreeInfo.path, 'callback:', !!onOpenTerminal);
                  if (onOpenTerminal) {
                    onOpenTerminal(worktreeInfo.path);
                  } else {
                    console.warn('[WorktreePanel] onOpenTerminal callback not provided');
                  }
                  onClose();
                }}
                className="flex items-center gap-2 px-3 py-2 text-sm text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800 rounded-lg"
                title="Open a terminal in the worktree directory"
              >
                <Terminal className="w-4 h-4" />
                Open Terminal
              </button>
              <button
                onClick={() =>
                  window.open(`vscode://file${worktreeInfo.path}`, '_blank')
                }
                className="flex items-center gap-2 px-3 py-2 text-sm text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800 rounded-lg"
              >
                <ExternalLink className="w-4 h-4" />
                Open in VS Code
              </button>
              <button
                onClick={() => setConfirmDiscard(true)}
                disabled={merging || discarding}
                className="flex items-center gap-2 px-3 py-2 text-sm text-red-400 hover:text-red-300 hover:bg-red-900/20 rounded-lg"
                title="Discard all changes and remove worktree"
              >
                <Trash2 className="w-4 h-4" />
                Discard
              </button>
            </div>

            <div className="flex items-center gap-2">
              <button
                onClick={onClose}
                className="px-4 py-2 text-sm text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800 rounded-lg"
              >
                Close
              </button>
              <button
                onClick={() => handleMerge(true)}
                disabled={merging || discarding || !changes || changes.files.length === 0}
                className="flex items-center gap-2 px-4 py-2 text-sm bg-violet-600 hover:bg-violet-500 disabled:opacity-50 disabled:cursor-not-allowed rounded-lg"
              >
                {merging ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <GitMerge className="w-4 h-4" />
                )}
                Merge to {worktreeInfo.baseBranch}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * WorktreeButton - Small button to show in console title bar
 */
interface WorktreeButtonProps {
  threadId: string;
  hasWorktree: boolean;
  branch?: string;
  onEnableWorktree?: () => void;
  onShowChanges?: () => void;
}

export function WorktreeButton({
  threadId,
  hasWorktree,
  branch,
  onEnableWorktree,
  onShowChanges,
}: WorktreeButtonProps) {
  if (hasWorktree) {
    // Show branch name (truncated if too long)
    const displayBranch = branch
      ? (branch.length > 20 ? `...${branch.slice(-17)}` : branch)
      : 'isolated';

    return (
      <button
        onClick={onShowChanges}
        className="flex items-center gap-1 px-2 py-0.5 text-xs bg-violet-600/20 text-violet-400 hover:bg-violet-600/30 rounded"
        title={`Isolated on branch: ${branch || 'unknown'}\nClick to view changes and merge`}
      >
        <GitBranch className="w-3 h-3" />
        <span className="max-w-[120px] truncate">{displayBranch}</span>
      </button>
    );
  }

  return (
    <button
      onClick={onEnableWorktree}
      className="flex items-center gap-1 px-2 py-0.5 text-xs bg-zinc-800 text-zinc-400 hover:bg-zinc-700 hover:text-zinc-300 rounded"
      title="Enable worktree isolation - agent will work on a separate branch"
    >
      <GitBranch className="w-3 h-3" />
      Isolate
    </button>
  );
}

/** Branch entry from the API */
interface BranchEntry {
  name: string;
  isCurrent: boolean;
  isRemote: boolean;
}

/**
 * EnableWorktreeDialog - Modal to enable worktree for a thread
 */
interface EnableWorktreeDialogProps {
  threadId: string;
  threadName?: string;
  cwd?: string; // Required if thread doesn't exist yet
  hasExistingSession?: boolean; // True if console has conversation history
  isOpen: boolean;
  onClose: () => void;
  onEnabled: (worktreePath: string, branch: string) => void;
}

export function EnableWorktreeDialog({
  threadId,
  threadName,
  cwd,
  hasExistingSession,
  isOpen,
  onClose,
  onEnabled,
}: EnableWorktreeDialogProps) {
  const [branchMode, setBranchMode] = useState<'new' | 'existing'>('new');
  const [newBranchName, setNewBranchName] = useState('');
  const [baseBranch, setBaseBranch] = useState('main');
  const [selectedExistingBranch, setSelectedExistingBranch] = useState('');
  const [existingBranches, setExistingBranches] = useState<BranchEntry[]>([]);
  const [isLoadingBranches, setIsLoadingBranches] = useState(false);
  const [enabling, setEnabling] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dropdownOpen, setDropdownOpen] = useState(false);

  const serverUrl = getServerUrl();

  // Fetch branches when dialog opens
  useEffect(() => {
    if (isOpen && cwd) {
      setIsLoadingBranches(true);
      fetch(`${serverUrl}/git/branches?cwd=${encodeURIComponent(cwd)}`)
        .then((res) => res.json())
        .then((data) => {
          if (data.ok && data.branches) {
            setExistingBranches(data.branches);
          }
        })
        .catch(() => {
          // Silently fail - user can still create new branch
        })
        .finally(() => {
          setIsLoadingBranches(false);
        });
    }
  }, [isOpen, cwd, serverUrl]);

  // Generate default branch name from thread name
  useEffect(() => {
    if (isOpen && threadName) {
      const sanitized = threadName
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 40);
      setNewBranchName(`agent/${sanitized}`);
    }
  }, [isOpen, threadName]);

  // Reset state when dialog closes
  useEffect(() => {
    if (!isOpen) {
      setBranchMode('new');
      setSelectedExistingBranch('');
      setDropdownOpen(false);
      setError(null);
    }
  }, [isOpen]);

  const handleSelectBranch = (branch: string, mode: 'new' | 'existing') => {
    setBranchMode(mode);
    if (mode === 'existing') {
      setSelectedExistingBranch(branch);
    }
    setDropdownOpen(false);
  };

  const handleEnable = async () => {
    setEnabling(true);
    setError(null);

    try {
      // Sanitize branch name - remove any leading '+ ' prefix that might have been
      // included from display formatting (e.g., "+ Create new branch..." option)
      const rawBranch = branchMode === 'existing' ? selectedExistingBranch : newBranchName;
      const branchToUse = rawBranch.replace(/^\+\s*/, '').trim();

      const res = await fetch(`${serverUrl}/threads/${threadId}/worktree`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          branch: branchToUse || undefined,
          baseBranch: branchMode === 'new' ? baseBranch : undefined,
          cwd, // Pass cwd so server can create thread if needed
          name: threadName,
        }),
      });

      const data = await res.json();
      console.log('[EnableWorktreeDialog] Response:', data);
      if (data.ok) {
        console.log('[EnableWorktreeDialog] Calling onEnabled with:', data.worktreePath, data.branch);
        onEnabled(data.worktreePath, data.branch);
        onClose();
      } else {
        setError(data.error || 'Failed to enable worktree');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to enable worktree');
    } finally {
      setEnabling(false);
    }
  };

  // Get display text for the dropdown button
  const getDropdownDisplayText = () => {
    if (branchMode === 'existing' && selectedExistingBranch) {
      return selectedExistingBranch;
    }
    return 'Create new branch...';
  };

  // Separate local and remote branches
  const localBranches = existingBranches.filter((b) => !b.isRemote);
  const remoteBranches = existingBranches.filter((b) => b.isRemote);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-zinc-900 border border-zinc-700 rounded-xl w-full max-w-md overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-zinc-800">
          <div className="flex items-center gap-2">
            <GitBranch className="w-5 h-5 text-violet-400" />
            <h2 className="text-lg font-semibold">Enable Worktree Isolation</h2>
          </div>
          <button
            onClick={onClose}
            className="p-1 hover:bg-zinc-800 rounded text-zinc-400 hover:text-zinc-200"
          >
            <XCircle className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <div className="p-4 space-y-4">
          <p className="text-sm text-zinc-400">
            Create an isolated git worktree for this console. The agent will work on a separate
            branch without affecting your main codebase.
          </p>

          {hasExistingSession && (
            <div className="flex items-start gap-2 p-3 bg-amber-900/20 border border-amber-800 rounded-lg text-amber-400 text-sm">
              <AlertTriangle className="w-4 h-4 mt-0.5 flex-shrink-0" />
              <div>
                <p className="font-medium">Conversation history will be reset</p>
                <p className="text-amber-400/70 text-xs mt-1">
                  Enabling isolation after messages have been exchanged requires starting a fresh
                  session in the new directory. The agent won't remember previous context.
                </p>
              </div>
            </div>
          )}

          {error && (
            <div className="flex items-center gap-2 p-3 bg-red-900/20 border border-red-800 rounded-lg text-red-400 text-sm">
              <AlertTriangle className="w-4 h-4" />
              <span>{error}</span>
            </div>
          )}

          <div className="space-y-3">
            {/* Branch Selection Dropdown */}
            <div>
              <label className="block text-xs text-zinc-500 mb-1">Branch</label>
              <div className="relative">
                <button
                  type="button"
                  onClick={() => setDropdownOpen(!dropdownOpen)}
                  className="w-full flex items-center justify-between px-3 py-2 text-sm bg-zinc-800 border border-zinc-700 rounded-lg text-zinc-200 hover:border-zinc-600 focus:outline-none focus:border-violet-500"
                >
                  <span className="truncate">
                    {isLoadingBranches ? (
                      <span className="flex items-center gap-2 text-zinc-400">
                        <Loader2 className="w-3 h-3 animate-spin" />
                        Loading branches...
                      </span>
                    ) : (
                      getDropdownDisplayText()
                    )}
                  </span>
                  <ChevronDown className={`w-4 h-4 text-zinc-400 transition-transform ${dropdownOpen ? 'rotate-180' : ''}`} />
                </button>

                {/* Dropdown Menu */}
                {dropdownOpen && !isLoadingBranches && (
                  <div className="absolute z-10 w-full mt-1 bg-zinc-800 border border-zinc-700 rounded-lg shadow-lg max-h-60 overflow-y-auto">
                    {/* Create New Branch Option */}
                    <button
                      type="button"
                      onClick={() => handleSelectBranch('', 'new')}
                      className={`w-full flex items-center gap-2 px-3 py-2 text-sm text-left hover:bg-zinc-700 ${
                        branchMode === 'new' ? 'bg-violet-600/20 text-violet-300' : 'text-zinc-200'
                      }`}
                    >
                      <FilePlus className="w-4 h-4 text-green-400" />
                      Create new branch...
                    </button>

                    {/* Divider */}
                    {(localBranches.length > 0 || remoteBranches.length > 0) && (
                      <div className="border-t border-zinc-700 my-1" />
                    )}

                    {/* Local Branches */}
                    {localBranches.length > 0 && (
                      <>
                        <div className="px-3 py-1 text-xs text-zinc-500 uppercase tracking-wider">
                          Local Branches
                        </div>
                        {localBranches.map((branch) => (
                          <button
                            key={branch.name}
                            type="button"
                            onClick={() => handleSelectBranch(branch.name, 'existing')}
                            className={`w-full flex items-center gap-2 px-3 py-2 text-sm text-left hover:bg-zinc-700 ${
                              branchMode === 'existing' && selectedExistingBranch === branch.name
                                ? 'bg-violet-600/20 text-violet-300'
                                : 'text-zinc-200'
                            }`}
                          >
                            <GitBranch className="w-4 h-4 text-zinc-400" />
                            <span className="truncate">{branch.name}</span>
                            {branch.isCurrent && (
                              <span className="ml-auto text-xs text-green-400">(current)</span>
                            )}
                          </button>
                        ))}
                      </>
                    )}

                    {/* Remote Branches */}
                    {remoteBranches.length > 0 && (
                      <>
                        <div className="border-t border-zinc-700 my-1" />
                        <div className="px-3 py-1 text-xs text-zinc-500 uppercase tracking-wider">
                          Remote Branches
                        </div>
                        {remoteBranches.map((branch) => (
                          <button
                            key={branch.name}
                            type="button"
                            onClick={() => handleSelectBranch(branch.name, 'existing')}
                            className={`w-full flex items-center gap-2 px-3 py-2 text-sm text-left hover:bg-zinc-700 ${
                              branchMode === 'existing' && selectedExistingBranch === branch.name
                                ? 'bg-violet-600/20 text-violet-300'
                                : 'text-zinc-200'
                            }`}
                          >
                            <GitBranch className="w-4 h-4 text-blue-400" />
                            <span className="truncate">{branch.name}</span>
                          </button>
                        ))}
                      </>
                    )}

                    {/* No branches message */}
                    {localBranches.length === 0 && remoteBranches.length === 0 && (
                      <div className="px-3 py-2 text-sm text-zinc-500">
                        No existing branches found
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>

            {/* New Branch Name Input (only shown when creating new branch) */}
            {branchMode === 'new' && (
              <>
                <div>
                  <label className="block text-xs text-zinc-500 mb-1">Branch Name</label>
                  <input
                    type="text"
                    value={newBranchName}
                    onChange={(e) => setNewBranchName(e.target.value)}
                    placeholder="agent/feature-name"
                    className="w-full px-3 py-2 text-sm bg-zinc-800 border border-zinc-700 rounded-lg text-zinc-200 placeholder:text-zinc-500 focus:outline-none focus:border-violet-500"
                  />
                </div>

                <div>
                  <label className="block text-xs text-zinc-500 mb-1">Base Branch</label>
                  <input
                    type="text"
                    value={baseBranch}
                    onChange={(e) => setBaseBranch(e.target.value)}
                    placeholder="main"
                    className="w-full px-3 py-2 text-sm bg-zinc-800 border border-zinc-700 rounded-lg text-zinc-200 placeholder:text-zinc-500 focus:outline-none focus:border-violet-500"
                  />
                </div>
              </>
            )}

            {/* Info about existing branch selection */}
            {branchMode === 'existing' && selectedExistingBranch && (
              <div className="flex items-start gap-2 p-3 bg-blue-900/20 border border-blue-800 rounded-lg text-blue-400 text-sm">
                <GitBranch className="w-4 h-4 mt-0.5 flex-shrink-0" />
                <div>
                  <p className="font-medium">Using existing branch</p>
                  <p className="text-blue-400/70 text-xs mt-1">
                    The worktree will be created from branch "{selectedExistingBranch}".
                  </p>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-zinc-800 bg-zinc-900/50 flex items-center justify-end gap-2">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800 rounded-lg"
          >
            Cancel
          </button>
          <button
            onClick={handleEnable}
            disabled={enabling || (branchMode === 'existing' && !selectedExistingBranch)}
            className="flex items-center gap-2 px-4 py-2 text-sm bg-violet-600 hover:bg-violet-500 disabled:opacity-50 disabled:cursor-not-allowed rounded-lg"
          >
            {enabling ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <GitBranch className="w-4 h-4" />
            )}
            Enable Worktree
          </button>
        </div>
      </div>
    </div>
  );
}
