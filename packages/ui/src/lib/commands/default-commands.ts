import {
  MonitorDot,
  Sparkles,
  Home,
  Layout,
  Plug,
  X,
  Minus,
  Maximize2,
  Trash2,
  Users,
  SplitSquareHorizontal,
  SplitSquareVertical,
  LayoutGrid,
  Columns,
  Rows,
  Grid2X2,
  RotateCcw,
  Terminal,
  Keyboard,
  Search,
  History,
  Send,
  GitBranch,
  FolderOpen,
  ExternalLink,
} from 'lucide-react';
import type { Command } from './types';
import { useWorkspaceStore, type LayoutWidgetInfo } from '../../stores/workspace';
import { useAppStore, api, getServerUrl, getRecentProjects } from '../../stores/app';
import { useShortcutsStore } from '../../stores/shortcuts';

/**
 * Format a date as a relative time string (e.g., "5 min ago", "2 hours ago")
 */
function getTimeAgo(dateInput: string | number | Date): string {
  const date = new Date(dateInput);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMins / 60);
  const diffDays = Math.floor(diffHours / 24);

  if (diffMins < 1) return 'Just now';
  if (diffMins < 60) return `${diffMins} min ago`;
  if (diffHours < 24) return `${diffHours} hour${diffHours > 1 ? 's' : ''} ago`;
  if (diffDays === 1) return 'Yesterday';
  if (diffDays < 7) return `${diffDays} days ago`;
  return date.toLocaleDateString();
}

/**
 * Get the agent icon based on type/name
 */
function getAgentIcon(agent: { type: string; name: string }): string {
  if (agent.type === 'claude-code') return '🖥️';
  const name = agent.name.toLowerCase();
  if (name.includes('scout')) return '🔍';
  if (name.includes('forge')) return '🔨';
  if (name.includes('vera')) return '✨';
  if (name.includes('echo')) return '📢';
  return '🤖';
}

/**
 * Create default commands
 * Called once on app init to populate the registry
 */
export function createDefaultCommands(): Command[] {
  const commands: Command[] = [
    // ========================================
    // Agent Console Commands
    // ========================================
    {
      id: 'new-console',
      label: 'New Agent Console',
      description: 'Open a new agent console session',
      category: 'console',
      icon: MonitorDot,
      shortcut: '⌘N',
      keywords: ['console', 'agent', 'session', 'chat'],
      action: {
        type: 'subcommand',
        getCommands: (): Command[] => {
          const { claudeCodeAvailable, agents } = useAppStore.getState();
          const workspaceAgents = useWorkspaceStore.getState().agents;

          const subcommands: Command[] = [];

          // Claude Code (if available)
          if (claudeCodeAvailable) {
            subcommands.push({
              id: 'agent-claude-code',
              label: 'Claude Code',
              description: 'Local Claude Code instance',
              category: 'console',
              keywords: ['claude', 'code', 'local'],
              action: {
                type: 'execute',
                handler: () => {
                  useWorkspaceStore.getState().createConsole('claude-code-local');
                },
              },
            });
          }

          // OpenClaw agents from workspace store
          for (const agent of workspaceAgents) {
            if (agent.type !== 'claude-code') {
              subcommands.push({
                id: `agent-${agent.id}`,
                label: agent.name,
                description: `${agent.type} agent`,
                category: 'console',
                keywords: [agent.name.toLowerCase(), agent.type],
                action: {
                  type: 'execute',
                  handler: () => {
                    useWorkspaceStore.getState().createConsole(agent.id);
                  },
                },
              });
            }
          }

          // Also check agents from app store (OpenClaw connected agents)
          for (const agent of agents) {
            const alreadyAdded = subcommands.some(
              (cmd) => cmd.id === `agent-${agent.name}`
            );
            if (!alreadyAdded) {
              subcommands.push({
                id: `agent-${agent.name}`,
                label: agent.name,
                description: agent.status === 'busy' ? 'Busy' : 'Ready',
                category: 'console',
                keywords: [agent.name.toLowerCase()],
                action: {
                  type: 'execute',
                  handler: () => {
                    useWorkspaceStore.getState().createConsole(agent.name);
                  },
                },
              });
            }
          }

          // If no agents available, show a message
          if (subcommands.length === 0) {
            subcommands.push({
              id: 'no-agents',
              label: 'No agents available',
              description: 'Connect an agent to create a console',
              category: 'console',
              action: {
                type: 'execute',
                handler: () => {
                  // No-op - just informational
                },
              },
            });
          }

          return subcommands;
        },
      },
    },

    // Search/Resume Sessions
    {
      id: 'search-sessions',
      label: 'Search Agent Console',
      description: 'Find and resume a previous session',
      category: 'console',
      icon: Search,
      shortcut: '⌘⇧F',
      keywords: ['search', 'find', 'session', 'resume', 'history', 'previous', 'load', 'open'],
      isVisible: () => {
        const { workspacePath } = useWorkspaceStore.getState();
        return !!workspacePath;
      },
      action: {
        type: 'subcommand',
        getCommands: (): Command[] => {
          const { workspacePath } = useWorkspaceStore.getState();
          if (!workspacePath) {
            return [{
              id: 'no-workspace',
              label: 'No workspace open',
              description: 'Open a project to search sessions',
              category: 'console',
              action: { type: 'execute', handler: () => {} },
            }];
          }

          // Return a placeholder that will be replaced when sessions load
          // The actual session list is fetched dynamically
          return [{
            id: 'sessions-loading',
            label: 'Loading sessions...',
            description: 'Fetching previous sessions',
            category: 'console',
            action: { type: 'execute', handler: () => {} },
          }];
        },
        // Dynamic loading of sessions
        getCommandsAsync: async (): Promise<Command[]> => {
          const { workspacePath } = useWorkspaceStore.getState();
          if (!workspacePath) return [];

          try {
            // Fetch all sessions (not just resumable) for searching
            const [sessions, sdkSessions] = await Promise.all([
              api.listSessions({
                projectPath: workspacePath,
                status: ['active', 'suspended', 'closed'],
                limit: 50,
              }),
              api.getSdkSessions(workspacePath).catch(() => []),
            ]);

            // Create a set of valid SDK session IDs for cross-reference
            const validSdkSessionIds = new Set(sdkSessions.map(s => s.sessionId));

            if (sessions.length === 0) {
              return [{
                id: 'no-sessions',
                label: 'No previous sessions',
                description: 'Start a new console to create a session',
                category: 'console',
                icon: History,
                action: { type: 'execute', handler: () => {} },
              }];
            }

            // Filter to only show sessions with valid SDK sessions (can actually be resumed)
            const resumableSessions = sessions.filter(session =>
              session.sessionId && validSdkSessionIds.has(session.sessionId)
            );

            if (resumableSessions.length === 0) {
              return [{
                id: 'no-resumable-sessions',
                label: 'No resumable sessions',
                description: 'Previous sessions have no valid SDK context',
                category: 'console',
                icon: History,
                action: { type: 'execute', handler: () => {} },
              }];
            }

            return resumableSessions.map(session => {
              const statusLabel = session.status === 'active' ? '● Active' :
                                  session.status === 'suspended' ? '◐ Suspended' :
                                  '○ Closed';
              const timeAgo = getTimeAgo(session.lastActiveAt);

              return {
                id: `session-${session.id}`,
                label: session.name || session.lastPrompt?.slice(0, 50) || `Session ${session.id.slice(0, 8)}`,
                description: `${statusLabel} • ${timeAgo} • ${session.messageCount} messages`,
                category: 'console',
                icon: History,
                keywords: [
                  session.name?.toLowerCase() || '',
                  session.lastPrompt?.toLowerCase() || '',
                  session.status,
                ].filter(Boolean),
                action: {
                  type: 'execute',
                  handler: async () => {
                    // Resume the session directly
                    const store = useWorkspaceStore.getState();
                    await api.activateSession(session.id);
                    if (store.onCreateConsole) {
                      store.createConsole('claude-code-local', {
                        threadId: session.id,
                        resume: true,
                        sessionId: session.sessionId,
                        projectPath: session.projectPath,
                      });
                    }
                  },
                },
              };
            });
          } catch (err) {
            console.error('Failed to fetch sessions:', err);
            return [{
              id: 'sessions-error',
              label: 'Failed to load sessions',
              description: err instanceof Error ? err.message : 'Unknown error',
              category: 'console',
              action: { type: 'execute', handler: () => {} },
            }];
          }
        },
      },
    },

    // Send Prompt to Console
    {
      id: 'send-prompt-to-console',
      label: 'Send Prompt to Console',
      description: 'Send a prompt to a new or existing agent console',
      category: 'console',
      icon: Send,
      keywords: ['send', 'prompt', 'message', 'console', 'agent', 'chat', 'ask'],
      action: {
        type: 'subcommand',
        getCommands: (): Command[] => {
          const { claudeCodeAvailable } = useAppStore.getState();
          const { consoles, agents: workspaceAgents, pendingPrompt } = useWorkspaceStore.getState();

          const subcommands: Command[] = [];

          // === NEW CONSOLE OPTIONS ===
          subcommands.push({
            id: 'prompt-new-console',
            label: '+ New Console',
            description: 'Create a new console and send prompt',
            category: 'console',
            action: {
              type: 'subcommand',
              getCommands: (): Command[] => {
                const { pendingPrompt: currentPendingPrompt, agents: currentAgents } = useWorkspaceStore.getState();
                const { claudeCodeAvailable: isClaudeAvailable } = useAppStore.getState();
                const newConsoleOptions: Command[] = [];

                // Claude Code option
                if (isClaudeAvailable) {
                  newConsoleOptions.push({
                    id: 'prompt-new-claude-code',
                    label: 'Claude Code',
                    description: currentPendingPrompt
                      ? `Send pending prompt to new Claude Code console`
                      : 'Create new Claude Code console',
                    category: 'console',
                    action: currentPendingPrompt ? {
                      // Direct execution when we have a pending prompt
                      type: 'execute',
                      handler: () => {
                        const store = useWorkspaceStore.getState();
                        const prompt = store.pendingPrompt!;
                        store.setPendingPrompt(null);
                        store.createConsole('claude-code-local');
                        setTimeout(() => {
                          const newConsoles = useWorkspaceStore.getState().consoles;
                          const latestConsole = newConsoles[newConsoles.length - 1];
                          if (latestConsole) {
                            store.sendToConsole(prompt, latestConsole.id);
                          }
                        }, 500);
                      },
                    } : {
                      type: 'input',
                      placeholder: 'Enter prompt to send...',
                      onSubmit: (prompt: string) => {
                        const store = useWorkspaceStore.getState();
                        store.createConsole('claude-code-local');
                        setTimeout(() => {
                          const newConsoles = useWorkspaceStore.getState().consoles;
                          const latestConsole = newConsoles[newConsoles.length - 1];
                          if (latestConsole) {
                            store.sendToConsole(prompt, latestConsole.id);
                          }
                        }, 500);
                      },
                    },
                  });
                }

                // OpenClaw/other agents
                for (const agent of currentAgents) {
                  if (agent.type !== 'claude-code') {
                    newConsoleOptions.push({
                      id: `prompt-new-${agent.id}`,
                      label: agent.name,
                      description: currentPendingPrompt
                        ? `Send pending prompt to new ${agent.type} console`
                        : `Create new ${agent.type} console`,
                      category: 'console',
                      action: currentPendingPrompt ? {
                        type: 'execute',
                        handler: () => {
                          const store = useWorkspaceStore.getState();
                          const prompt = store.pendingPrompt!;
                          store.setPendingPrompt(null);
                          store.createConsole(agent.id);
                          setTimeout(() => {
                            const newConsoles = useWorkspaceStore.getState().consoles;
                            const latestConsole = newConsoles[newConsoles.length - 1];
                            if (latestConsole) {
                              store.sendToConsole(prompt, latestConsole.id);
                            }
                          }, 500);
                        },
                      } : {
                        type: 'input',
                        placeholder: 'Enter prompt to send...',
                        onSubmit: (prompt: string) => {
                          const store = useWorkspaceStore.getState();
                          store.createConsole(agent.id);
                          setTimeout(() => {
                            const newConsoles = useWorkspaceStore.getState().consoles;
                            const latestConsole = newConsoles[newConsoles.length - 1];
                            if (latestConsole) {
                              store.sendToConsole(prompt, latestConsole.id);
                            }
                          }, 500);
                        },
                      },
                    });
                  }
                }

                if (newConsoleOptions.length === 0) {
                  return [{
                    id: 'no-agents-for-prompt',
                    label: 'No agents available',
                    description: 'Connect an agent first',
                    category: 'console',
                    action: { type: 'execute', handler: () => {} },
                  }];
                }

                return newConsoleOptions;
              },
            },
          });

          // === EXISTING CONSOLES ===
          for (const console of consoles) {
            subcommands.push({
              id: `prompt-to-${console.id}`,
              label: console.agentName,
              description: pendingPrompt
                ? `Send pending prompt to ${console.agentName}`
                : `Send to existing console (${console.id.slice(0, 8)})`,
              category: 'console',
              action: pendingPrompt ? {
                // Direct execution when we have a pending prompt
                type: 'execute',
                handler: () => {
                  const store = useWorkspaceStore.getState();
                  store.sendToConsole(store.pendingPrompt!, console.id);
                  store.setPendingPrompt(null);
                },
              } : {
                type: 'input',
                placeholder: 'Enter prompt to send...',
                onSubmit: (prompt: string) => {
                  useWorkspaceStore.getState().sendToConsole(prompt, console.id);
                },
              },
            });
          }

          return subcommands;
        },
      },
    },

    // ========================================
    // Console Actions (contextual - only visible when relevant widget is focused)
    // ========================================
    {
      id: 'close-console',
      label: 'Close Console',
      description: 'Close the focused agent console',
      category: 'console',
      icon: X,
      shortcut: '⌘W',
      keywords: ['close', 'console', 'kill', 'exit'],
      isVisible: () => {
        const { focusedWidgetType } = useWorkspaceStore.getState();
        return focusedWidgetType === 'agent-console';
      },
      action: {
        type: 'execute',
        handler: () => {
          const { focusedWidgetId, focusedWidgetType } = useWorkspaceStore.getState();
          if (focusedWidgetType === 'agent-console' && focusedWidgetId) {
            useWorkspaceStore.getState().closeConsole(focusedWidgetId);
          }
        },
      },
    },
    {
      id: 'minimize-console',
      label: 'Minimize Console',
      description: 'Minimize the focused console to the bottom bar',
      category: 'console',
      icon: Minus,
      keywords: ['minimize', 'console', 'hide', 'dock'],
      isVisible: () => {
        const { focusedWidgetType } = useWorkspaceStore.getState();
        return focusedWidgetType === 'agent-console';
      },
      action: {
        type: 'execute',
        handler: () => {
          const { focusedWidgetId, focusedWidgetType } = useWorkspaceStore.getState();
          if (focusedWidgetType === 'agent-console' && focusedWidgetId) {
            useWorkspaceStore.getState().minimizeConsole(focusedWidgetId);
          }
        },
      },
    },
    {
      id: 'maximize-widget',
      label: 'Maximize / Restore',
      description: 'Toggle fullscreen for the focused widget',
      category: 'console',
      icon: Maximize2,
      shortcut: '⌘↵',
      keywords: ['maximize', 'fullscreen', 'expand', 'restore', 'minimize'],
      isVisible: () => {
        const { focusedWidgetId } = useWorkspaceStore.getState();
        return focusedWidgetId !== null;
      },
      action: {
        type: 'execute',
        handler: () => {
          useWorkspaceStore.getState().toggleMaximizeFocusedWidget();
        },
      },
    },
    {
      id: 'clear-console',
      label: 'Clear Console',
      description: 'Clear the output of the focused console',
      category: 'console',
      icon: Trash2,
      keywords: ['clear', 'console', 'clean', 'reset', 'output'],
      isVisible: () => {
        const { focusedWidgetType } = useWorkspaceStore.getState();
        return focusedWidgetType === 'agent-console';
      },
      action: {
        type: 'execute',
        handler: () => {
          const { focusedWidgetId, focusedWidgetType } = useWorkspaceStore.getState();
          if (focusedWidgetType === 'agent-console' && focusedWidgetId) {
            useWorkspaceStore.getState().clearConsole(focusedWidgetId);
          }
        },
      },
    },
    {
      id: 'toggle-agent-status',
      label: 'Toggle Agent Status',
      description: 'Show or hide the agent status panel',
      category: 'console',
      icon: Users,
      keywords: ['agent', 'status', 'show', 'hide', 'panel', 'toggle'],
      action: {
        type: 'execute',
        handler: () => {
          const { showAgentStatus } = useWorkspaceStore.getState();
          useWorkspaceStore.getState().setShowAgentStatus(!showAgentStatus);
        },
      },
    },
    {
      id: 'toggle-tasks',
      label: 'Toggle Tasks Panel',
      description: 'Show or hide the tasks panel',
      category: 'layout',
      icon: Sparkles,
      keywords: ['tasks', 'show', 'hide', 'panel', 'toggle', 'todo'],
      action: {
        type: 'execute',
        handler: () => {
          const { tasksVisible } = useWorkspaceStore.getState();
          useWorkspaceStore.getState().setTasksVisible(!tasksVisible);
        },
      },
    },

    // ========================================
    // Layout Commands
    // ========================================
    {
      id: 'layout-presets',
      label: 'Apply Layout Preset',
      description: 'Switch to a predefined layout arrangement',
      category: 'layout',
      icon: LayoutGrid,
      keywords: ['layout', 'preset', 'arrange', 'split', 'grid', 'tmux'],
      action: {
        type: 'subcommand',
        getCommands: (): Command[] => {
          // Helper to get fresh widgets at execution time (not when menu opens)
          const getWidgets = (): LayoutWidgetInfo[] => {
            const { consoles, realTerminals, showAgentStatus, tasksVisible } = useWorkspaceStore.getState();
            const widgets = [
              // Content widgets first
              ...consoles.map(c => ({ type: 'agent-console' as const, id: c.id })),
              ...realTerminals.map(t => ({ type: 'terminal' as const, id: t.id })),
              // Utility widgets
              ...(showAgentStatus ? [{ type: 'agent-status' as const, id: 'agent-status-widget' }] : []),
              ...(tasksVisible ? [{ type: 'tasks' as const, id: 'tasks-widget' }] : []),
            ];
            console.log('[getWidgets] Building widgets:', {
              consoleIds: consoles.map(c => c.id),
              terminalIds: realTerminals.map(t => t.id),
              showAgentStatus,
              tasksVisible,
              totalWidgets: widgets.length,
              widgets,
            });
            return widgets;
          };

          return [
            {
              id: 'layout-default',
              label: 'Default Layout',
              description: 'Content on left, utilities on right',
              category: 'layout',
              icon: Layout,
              action: {
                type: 'execute',
                handler: () => {
                  useWorkspaceStore.getState().applyLayoutPreset('default', getWidgets());
                },
              },
            },
            {
              id: 'layout-master-stack',
              label: 'Master-Stack',
              description: 'Large main panel with stacked side panels',
              category: 'layout',
              icon: Columns,
              action: {
                type: 'execute',
                handler: () => {
                  useWorkspaceStore.getState().applyLayoutPreset('master-stack', getWidgets());
                },
              },
            },
            {
              id: 'layout-even-horizontal',
              label: 'Even Horizontal',
              description: 'Equal-width columns side by side',
              category: 'layout',
              icon: Columns,
              action: {
                type: 'execute',
                handler: () => {
                  useWorkspaceStore.getState().applyLayoutPreset('even-horizontal', getWidgets());
                },
              },
            },
            {
              id: 'layout-even-vertical',
              label: 'Even Vertical',
              description: 'Equal-height rows stacked vertically',
              category: 'layout',
              icon: Rows,
              action: {
                type: 'execute',
                handler: () => {
                  useWorkspaceStore.getState().applyLayoutPreset('even-vertical', getWidgets());
                },
              },
            },
            {
              id: 'layout-quad',
              label: 'Quad Grid',
              description: '2x2 grid layout',
              category: 'layout',
              icon: Grid2X2,
              action: {
                type: 'execute',
                handler: () => {
                  useWorkspaceStore.getState().applyLayoutPreset('quad', getWidgets());
                },
              },
            },
          ];
        },
      },
    },
    {
      id: 'reset-layout',
      label: 'Reset Layout',
      description: 'Reset to default layout arrangement',
      category: 'layout',
      icon: RotateCcw,
      keywords: ['reset', 'layout', 'default', 'restore'],
      action: {
        type: 'execute',
        handler: () => {
          const { consoles, realTerminals, showAgentStatus, tasksVisible } = useWorkspaceStore.getState();
          const widgets: LayoutWidgetInfo[] = [
            ...consoles.map(c => ({ type: 'agent-console' as const, id: c.id })),
            ...realTerminals.map(t => ({ type: 'terminal' as const, id: t.id })),
            ...(showAgentStatus ? [{ type: 'agent-status' as const, id: 'agent-status-widget' }] : []),
            ...(tasksVisible ? [{ type: 'tasks' as const, id: 'tasks-widget' }] : []),
          ];
          useWorkspaceStore.getState().applyLayoutPreset('default', widgets);
        },
      },
    },

    // ========================================
    // Task Commands
    // ========================================
    {
      id: 'create-task',
      label: 'Create Task',
      description: 'Add a new task to the task list',
      category: 'task',
      icon: Sparkles,
      shortcut: '⇧⌘N',
      keywords: ['task', 'todo', 'plan', 'step', 'add'],
      action: {
        type: 'input',
        placeholder: 'Enter task description...',
        onSubmit: (text: string) => {
          useWorkspaceStore.getState().createTask(text, null);
        },
      },
    },

    // ========================================
    // Navigation Commands
    // ========================================
    {
      id: 'go-home',
      label: 'Go to Home',
      description: 'Navigate to the home view',
      category: 'navigation',
      icon: Home,
      keywords: ['home', 'dashboard', 'start'],
      action: {
        type: 'execute',
        handler: () => {
          useWorkspaceStore.getState().navigateTo('home');
        },
      },
    },
    {
      id: 'go-workspace',
      label: 'Go to Workspace',
      description: 'Navigate to the workspace view',
      category: 'navigation',
      icon: Layout,
      keywords: ['workspace', 'terminals', 'main'],
      action: {
        type: 'execute',
        handler: () => {
          useWorkspaceStore.getState().navigateTo('workspace-real');
        },
      },
    },
    {
      id: 'recent-directories',
      label: 'Recent Directories',
      description: 'Open a recently used project directory',
      category: 'navigation',
      icon: FolderOpen,
      shortcut: '⌘⇧O',
      keywords: ['recent', 'project', 'directory', 'folder', 'open', 'switch'],
      action: {
        type: 'subcommand',
        getCommands: (): Command[] => {
          // Use getRecentProjects() to read from global store (reliably persisted)
          const recentProjects = getRecentProjects();

          if (recentProjects.length === 0) {
            return [{
              id: 'no-recent-projects',
              label: 'No recent projects',
              description: 'Open a project to add it to recents',
              category: 'navigation',
              action: { type: 'execute', handler: () => {} },
            }];
          }

          const commands: Command[] = [];

          for (const project of recentProjects) {
            const timeAgo = project.lastOpened ? getTimeAgo(project.lastOpened) : '';
            const isCurrentProject = useWorkspaceStore.getState().workspacePath === project.path;

            // Open in current window
            commands.push({
              id: `recent-project-current-${project.path}`,
              label: project.name,
              description: `${project.path}${timeAgo ? ` • ${timeAgo}` : ''}${isCurrentProject ? ' (current)' : ''}`,
              category: 'navigation',
              icon: FolderOpen,
              keywords: [project.name.toLowerCase(), project.path.toLowerCase()],
              action: {
                type: 'execute',
                handler: () => {
                  useAppStore.getState().setProject(project);
                  useWorkspaceStore.getState().setWorkspacePath(project.path);
                  useWorkspaceStore.getState().navigateTo('workspace-real');
                },
              },
            });

            // Open in new window (only in Electron)
            if (window.electronAPI?.window?.create) {
              commands.push({
                id: `recent-project-new-${project.path}`,
                label: `${project.name} (New Window)`,
                description: `Open in new window • ${project.path}`,
                category: 'navigation',
                icon: ExternalLink,
                keywords: [project.name.toLowerCase(), 'new', 'window'],
                action: {
                  type: 'execute',
                  handler: async () => {
                    await window.electronAPI!.window.create(project.path);
                  },
                },
              });
            }
          }

          return commands;
        },
      },
    },

    // ========================================
    // Adapter Commands
    // ========================================
    {
      id: 'init-claude-code',
      label: 'Initialize Claude Code',
      description: 'Start the Claude Code adapter',
      category: 'adapter',
      icon: Plug,
      keywords: ['adapter', 'claude', 'code', 'init', 'start'],
      action: {
        type: 'execute',
        handler: async () => {
          const result = await api.initClaudeCode();
          if (result.ok) {
            // Refresh agent status to reflect changes
            await useAppStore.getState().refreshAgentStatus();
          } else {
            console.error('Failed to initialize Claude Code:', result.error);
          }
        },
      },
    },

    // ========================================
    // Terminal Commands (real PTY terminals)
    // ========================================
    {
      id: 'new-terminal',
      label: 'New Terminal',
      description: 'Open a new shell terminal',
      category: 'terminal',
      icon: Terminal,
      shortcut: '⌘T',
      keywords: ['terminal', 'shell', 'bash', 'zsh', 'pty', 'command'],
      action: {
        type: 'execute',
        handler: () => {
          // Use the registered callback to create terminal with proper state management
          useWorkspaceStore.getState().createTerminal();
        },
      },
    },
    {
      id: 'close-terminal',
      label: 'Close Terminal',
      description: 'Close the focused terminal',
      category: 'terminal',
      icon: X,
      keywords: ['close', 'terminal', 'kill', 'exit', 'shell'],
      isVisible: () => {
        const { focusedWidgetType } = useWorkspaceStore.getState();
        return focusedWidgetType === 'terminal';
      },
      action: {
        type: 'execute',
        handler: async () => {
          const { focusedWidgetId, focusedWidgetType } = useWorkspaceStore.getState();
          if (focusedWidgetType === 'terminal' && focusedWidgetId) {
            try {
              await fetch(`${getServerUrl()}/api/terminals/${focusedWidgetId}`, {
                method: 'DELETE',
              });
              useWorkspaceStore.getState().closePanelInLayout(focusedWidgetId);
            } catch (err) {
              console.error('Failed to close terminal:', err);
            }
          }
        },
      },
    },
    {
      id: 'new-worktree-terminal',
      label: 'New Worktree Terminal',
      description: 'Open a terminal in a git worktree',
      category: 'terminal',
      icon: GitBranch,
      keywords: ['terminal', 'worktree', 'git', 'branch', 'shell'],
      isVisible: () => {
        const { workspacePath } = useWorkspaceStore.getState();
        return !!workspacePath;
      },
      action: {
        type: 'subcommand',
        getCommands: (): Command[] => {
          const { workspacePath } = useWorkspaceStore.getState();
          if (!workspacePath) {
            return [{
              id: 'no-workspace-worktree',
              label: 'No workspace open',
              description: 'Open a project to view worktrees',
              category: 'terminal',
              action: { type: 'execute', handler: () => {} },
            }];
          }

          // Return a loading placeholder
          return [{
            id: 'worktrees-loading',
            label: 'Loading worktrees...',
            description: 'Fetching git worktrees',
            category: 'terminal',
            action: { type: 'execute', handler: () => {} },
          }];
        },
        getCommandsAsync: async (): Promise<Command[]> => {
          const { workspacePath } = useWorkspaceStore.getState();
          if (!workspacePath) return [];

          try {
            const res = await fetch(`${getServerUrl()}/api/worktrees?projectPath=${encodeURIComponent(workspacePath)}`);
            const data = await res.json();

            if (!data.ok || !data.worktrees || data.worktrees.length === 0) {
              return [{
                id: 'no-worktrees',
                label: 'No worktrees found',
                description: 'Create a worktree from an agent console first',
                category: 'terminal',
                icon: GitBranch,
                action: { type: 'execute', handler: () => {} },
              }];
            }

            // Filter out the main worktree (isMain: true) since that's the regular project
            const worktrees = data.worktrees.filter((wt: { isMain?: boolean }) => !wt.isMain);

            if (worktrees.length === 0) {
              return [{
                id: 'no-worktrees',
                label: 'No worktrees found',
                description: 'Create a worktree from an agent console first',
                category: 'terminal',
                icon: GitBranch,
                action: { type: 'execute', handler: () => {} },
              }];
            }

            return worktrees.map((worktree: { path: string; branch: string; isClean?: boolean }) => ({
              id: `worktree-terminal-${worktree.branch}`,
              label: worktree.branch,
              description: `${worktree.path}${worktree.isClean === false ? ' (has changes)' : ''}`,
              category: 'terminal',
              icon: GitBranch,
              keywords: [worktree.branch.toLowerCase(), 'worktree', 'terminal'],
              action: {
                type: 'execute',
                handler: () => {
                  useWorkspaceStore.getState().createTerminal(worktree.path);
                },
              },
            }));
          } catch (err) {
            console.error('Failed to fetch worktrees:', err);
            return [{
              id: 'worktrees-error',
              label: 'Failed to load worktrees',
              description: err instanceof Error ? err.message : 'Unknown error',
              category: 'terminal',
              action: { type: 'execute', handler: () => {} },
            }];
          }
        },
      },
    },

    // ========================================
    // Settings / Help Commands
    // ========================================
    {
      id: 'keyboard-shortcuts',
      label: 'Keyboard Shortcuts',
      description: 'View and customize keyboard shortcuts',
      category: 'navigation',
      icon: Keyboard,
      shortcut: '⌘/',
      keywords: ['shortcuts', 'keys', 'keybindings', 'hotkeys', 'keyboard', 'help'],
      action: {
        type: 'execute',
        handler: () => {
          useShortcutsStore.getState().setMenuOpen(true);
        },
      },
    },
  ];

  return commands;
}
