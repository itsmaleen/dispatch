import {
  Terminal,
  Sparkles,
  Home,
  Layout,
  Plug,
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
