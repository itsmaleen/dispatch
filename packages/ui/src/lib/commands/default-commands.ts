import {
  Terminal,
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
} from 'lucide-react';
import type { Command } from './types';
import { useWorkspaceStore } from '../../stores/workspace';
import { useAppStore, api } from '../../stores/app';

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
    // Terminal Commands
    // ========================================
    {
      id: 'new-terminal',
      label: 'New Terminal',
      description: 'Open a new terminal with an agent',
      category: 'terminal',
      icon: Terminal,
      shortcut: '⌘N',
      keywords: ['terminal', 'agent', 'session', 'shell'],
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
              category: 'terminal',
              keywords: ['claude', 'code', 'local'],
              action: {
                type: 'execute',
                handler: () => {
                  useWorkspaceStore.getState().createTerminal('claude-code-local');
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
                category: 'terminal',
                keywords: [agent.name.toLowerCase(), agent.type],
                action: {
                  type: 'execute',
                  handler: () => {
                    useWorkspaceStore.getState().createTerminal(agent.id);
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
                category: 'terminal',
                keywords: [agent.name.toLowerCase()],
                action: {
                  type: 'execute',
                  handler: () => {
                    useWorkspaceStore.getState().createTerminal(agent.name);
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
              description: 'Connect an agent to create a terminal',
              category: 'terminal',
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
    // Terminal Actions (always visible, operate on focused widget)
    // ========================================
    {
      id: 'close-terminal',
      label: 'Close Terminal',
      description: 'Close the focused terminal',
      category: 'terminal',
      icon: X,
      shortcut: '⌘W',
      keywords: ['close', 'terminal', 'kill', 'exit'],
      action: {
        type: 'execute',
        handler: () => {
          const { focusedWidgetId, focusedWidgetType } = useWorkspaceStore.getState();
          if (focusedWidgetType === 'terminal' && focusedWidgetId) {
            useWorkspaceStore.getState().closeTerminal(focusedWidgetId);
          }
        },
      },
    },
    {
      id: 'minimize-terminal',
      label: 'Minimize Terminal',
      description: 'Minimize the focused terminal to the bottom bar',
      category: 'terminal',
      icon: Minus,
      keywords: ['minimize', 'terminal', 'hide', 'dock'],
      action: {
        type: 'execute',
        handler: () => {
          const { focusedWidgetId, focusedWidgetType } = useWorkspaceStore.getState();
          if (focusedWidgetType === 'terminal' && focusedWidgetId) {
            useWorkspaceStore.getState().minimizeTerminal(focusedWidgetId);
          }
        },
      },
    },
    {
      id: 'maximize-widget',
      label: 'Maximize / Restore',
      description: 'Toggle fullscreen for the focused widget',
      category: 'terminal',
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
      id: 'clear-terminal',
      label: 'Clear Terminal',
      description: 'Clear the output of the focused terminal',
      category: 'terminal',
      icon: Trash2,
      keywords: ['clear', 'terminal', 'clean', 'reset', 'output'],
      action: {
        type: 'execute',
        handler: () => {
          const { focusedWidgetId, focusedWidgetType } = useWorkspaceStore.getState();
          if (focusedWidgetType === 'terminal' && focusedWidgetId) {
            useWorkspaceStore.getState().clearTerminal(focusedWidgetId);
          }
        },
      },
    },
    {
      id: 'toggle-agent-status',
      label: 'Toggle Agent Status',
      description: 'Show or hide the agent status panel',
      category: 'terminal',
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
          const { terminals } = useWorkspaceStore.getState();
          const terminalIds = terminals.map(t => t.id);

          return [
            {
              id: 'layout-default',
              label: 'Default Layout',
              description: 'Terminals on left, tasks on right',
              category: 'layout',
              icon: Layout,
              action: {
                type: 'execute',
                handler: () => {
                  useWorkspaceStore.getState().applyLayoutPreset('default', terminalIds);
                },
              },
            },
            {
              id: 'layout-master-stack',
              label: 'Master-Stack',
              description: 'Large main terminal with stacked side panels',
              category: 'layout',
              icon: Columns,
              action: {
                type: 'execute',
                handler: () => {
                  useWorkspaceStore.getState().applyLayoutPreset('master-stack', terminalIds);
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
                  useWorkspaceStore.getState().applyLayoutPreset('even-horizontal', terminalIds);
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
                  useWorkspaceStore.getState().applyLayoutPreset('even-vertical', terminalIds);
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
                  useWorkspaceStore.getState().applyLayoutPreset('quad', terminalIds);
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
          const { terminals } = useWorkspaceStore.getState();
          const terminalIds = terminals.map(t => t.id);
          useWorkspaceStore.getState().applyLayoutPreset('default', terminalIds);
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
  ];

  return commands;
}
