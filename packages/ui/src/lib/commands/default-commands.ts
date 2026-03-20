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
} from 'lucide-react';
import type { Command } from './types';
import { useWorkspaceStore, type LayoutWidgetInfo } from '../../stores/workspace';
import { useAppStore, api, getServerUrl } from '../../stores/app';
import { useShortcutsStore } from '../../stores/shortcuts';

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

    // ========================================
    // Console Actions (always visible, operate on focused widget)
    // ========================================
    {
      id: 'close-console',
      label: 'Close Console',
      description: 'Close the focused agent console',
      category: 'console',
      icon: X,
      shortcut: '⌘W',
      keywords: ['close', 'console', 'kill', 'exit'],
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
