import { create } from 'zustand';
import { persist } from 'zustand/middleware';

const API_URL = 'http://localhost:3333';

export interface Project {
  path: string;
  name: string;
  lastOpened: number;
}

export interface Agent {
  name: string;
  capabilities: string[];
  connectedAt: string;
  status: 'idle' | 'busy' | 'offline';
  currentTask?: string;
  currentFiles?: string[];
}

export interface Task {
  id: string;
  message: string;
  status: 'created' | 'planning' | 'planned' | 'executing' | 'completed' | 'failed';
  createdAt: number;
  completedAt?: number;
  agent?: string;
  plan?: string;
  result?: string;
}

// API functions
export const api = {
  async checkClaudeCode(): Promise<{ available: boolean; version?: string }> {
    try {
      const res = await fetch(`${API_URL}/check/claude-code`);
      const data = await res.json();
      return { available: data.available, version: data.version };
    } catch {
      return { available: false };
    }
  },

  async initClaudeCode(): Promise<{ ok: boolean; error?: string }> {
    try {
      const res = await fetch(`${API_URL}/adapters/claude-code/init`, { method: 'POST' });
      const data = await res.json();
      return { ok: data.ok, error: data.error };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : 'Failed to init' };
    }
  },

  async createTask(message: string, agent?: string): Promise<{ taskId: string }> {
    const res = await fetch(`${API_URL}/tasks`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message, agent }),
    });
    const data = await res.json();
    if (!data.ok) throw new Error(data.error);
    return { taskId: data.taskId };
  },

  async getTask(taskId: string): Promise<Task> {
    const res = await fetch(`${API_URL}/tasks/${taskId}`);
    const data = await res.json();
    if (!data.ok) throw new Error(data.error);
    return data.task;
  },

  async planTask(taskId: string, agent?: string): Promise<{ plan: string; agent: string }> {
    const url = new URL(`${API_URL}/tasks/${taskId}/plan`);
    const res = await fetch(url.toString(), { 
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ agent }),
    });
    const data = await res.json();
    if (!data.ok) throw new Error(data.error);
    return { plan: data.plan, agent: data.agent };
  },

  async executeTask(taskId: string, agent?: string): Promise<{ result: string }> {
    const res = await fetch(`${API_URL}/tasks/${taskId}/execute`, { 
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ agent }),
    });
    const data = await res.json();
    if (!data.ok) throw new Error(data.error);
    return { result: data.result };
  },

  async getAgents(): Promise<Agent[]> {
    const res = await fetch(`${API_URL}/agents`);
    const data = await res.json();
    return data.agents || [];
  },

  async getAdapters(): Promise<Array<{ id: string; kind: string; state: { status: string } }>> {
    try {
      const res = await fetch(`${API_URL}/adapters`);
      const data = await res.json();
      return data.adapters || [];
    } catch {
      return [];
    }
  },
};

interface AppState {
  // Project
  currentProject: Project | null;
  recentProjects: Project[];
  
  // Agents
  agents: Agent[];
  claudeCodeAvailable: boolean;
  claudeCodeVersion: string | null;
  
  // Tasks
  tasks: Task[];
  activeTaskId: string | null;
  
  // Widget layouts (per project path)
  widgetLayouts: Record<string, any>;
  
  // Actions
  setProject: (project: Project | null) => void;
  addRecentProject: (project: Project) => void;
  setAgents: (agents: Agent[]) => void;
  updateAgent: (name: string, update: Partial<Agent>) => void;
  setClaudeCodeStatus: (available: boolean, version?: string) => void;
  addTask: (task: Task) => void;
  updateTask: (id: string, update: Partial<Task>) => void;
  setActiveTask: (id: string | null) => void;
  setWidgetLayout: (projectPath: string, layout: any) => void;
  
  // Async actions
  refreshAgentStatus: () => Promise<void>;
}

export const useAppStore = create<AppState>()(
  persist(
    (set, get) => ({
      currentProject: null,
      recentProjects: [],
      agents: [],
      claudeCodeAvailable: false,
      claudeCodeVersion: null,
      tasks: [],
      activeTaskId: null,
      widgetLayouts: {},

      setProject: (project) => {
        set({ currentProject: project });
        if (project) {
          get().addRecentProject(project);
        }
      },

      addRecentProject: (project) => {
        set((state) => {
          const filtered = state.recentProjects.filter(p => p.path !== project.path);
          return {
            recentProjects: [
              { ...project, lastOpened: Date.now() },
              ...filtered,
            ].slice(0, 10),
          };
        });
      },

      setAgents: (agents) => set({ agents }),

      updateAgent: (name, update) => {
        set((state) => ({
          agents: state.agents.map((a) =>
            a.name === name ? { ...a, ...update } : a
          ),
        }));
      },

      setClaudeCodeStatus: (available, version) => {
        set({ claudeCodeAvailable: available, claudeCodeVersion: version ?? null });
      },

      addTask: (task) => {
        set((state) => ({
          tasks: [task, ...state.tasks],
        }));
      },

      updateTask: (id, update) => {
        set((state) => ({
          tasks: state.tasks.map((t) =>
            t.id === id ? { ...t, ...update } : t
          ),
        }));
      },

      setActiveTask: (id) => set({ activeTaskId: id }),

      setWidgetLayout: (projectPath, layout) => {
        set((state) => ({
          widgetLayouts: {
            ...state.widgetLayouts,
            [projectPath]: layout,
          },
        }));
      },

      refreshAgentStatus: async () => {
        // Check Claude Code
        const ccStatus = await api.checkClaudeCode();
        set({ 
          claudeCodeAvailable: ccStatus.available, 
          claudeCodeVersion: ccStatus.version ?? null 
        });

        // If available, ensure adapter is initialized
        if (ccStatus.available) {
          await api.initClaudeCode();
        }

        // Fetch OpenClaw agents
        const agents = await api.getAgents();
        set({
          agents: agents.map((a: any) => ({
            name: a.name ?? 'Unknown',
            capabilities: a.capabilities ?? [],
            connectedAt: a.connectedAt,
            status: 'idle' as const,
          })),
        });
      },
    }),
    {
      name: 'acc-storage',
      partialize: (state) => ({
        recentProjects: state.recentProjects,
        widgetLayouts: state.widgetLayouts,
      }),
    }
  )
);
