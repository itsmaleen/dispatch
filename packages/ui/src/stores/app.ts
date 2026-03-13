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

  async planTask(taskId: string): Promise<{ plan: string; agent: string }> {
    const res = await fetch(`${API_URL}/tasks/${taskId}/plan`, { method: 'POST' });
    const data = await res.json();
    if (!data.ok) throw new Error(data.error);
    return { plan: data.plan, agent: data.agent };
  },

  async executeTask(taskId: string): Promise<{ result: string }> {
    const res = await fetch(`${API_URL}/tasks/${taskId}/execute`, { method: 'POST' });
    const data = await res.json();
    if (!data.ok) throw new Error(data.error);
    return { result: data.result };
  },

  async getAgents(): Promise<Agent[]> {
    const res = await fetch(`${API_URL}/agents`);
    const data = await res.json();
    return data.agents || [];
  },
};

interface AppState {
  // Project
  currentProject: Project | null;
  recentProjects: Project[];
  
  // Agents
  agents: Agent[];
  
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
  addTask: (task: Task) => void;
  updateTask: (id: string, update: Partial<Task>) => void;
  setActiveTask: (id: string | null) => void;
  setWidgetLayout: (projectPath: string, layout: any) => void;
}

export const useAppStore = create<AppState>()(
  persist(
    (set, get) => ({
      currentProject: null,
      recentProjects: [],
      agents: [],
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
            ].slice(0, 10), // Keep last 10
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
