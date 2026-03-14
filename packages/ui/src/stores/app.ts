import { create } from 'zustand';
import { persist } from 'zustand/middleware';

const DEFAULT_SERVER_PORT = 3333;
const PORT_DISCOVERY_MAX = 50; // try 3333..3362

// Dynamic API URL - uses Electron's server URLs (set via env var, no race condition)
function getApiUrl(): string {
  // In Electron, get URL directly from preload (available immediately)
  if (typeof window !== 'undefined' && window.electronAPI?.server?.getApiUrl) {
    return window.electronAPI.server.getApiUrl();
  }
  // Fallback: use port from preload
  if (typeof window !== 'undefined' && window.electronAPI?.server) {
    const port = window.electronAPI.server.getPort();
    return `http://localhost:${port}`;
  }
  // In browser/dev: use discovered port from store, or default
  if (typeof window !== 'undefined') {
    const port = useAppStore.getState().serverPort ?? DEFAULT_SERVER_PORT;
    return `http://localhost:${port}`;
  }
  return `http://localhost:${DEFAULT_SERVER_PORT}`;
}

// Dynamic WebSocket URL - uses Electron's server URLs (set via env var, no race condition)
function getWsUrlInternal(): string {
  // In Electron, get URL directly from preload (available immediately)
  if (typeof window !== 'undefined' && window.electronAPI?.server?.getWsUrl) {
    return window.electronAPI.server.getWsUrl();
  }
  // Fallback: convert API URL to WS URL
  return getApiUrl().replace('http', 'ws');
}

/** Probe ports 3333..3333+PORT_DISCOVERY_MAX and set store when server is found. Call when in browser dev. */
export async function discoverServerPort(): Promise<number> {
  for (let p = DEFAULT_SERVER_PORT; p < DEFAULT_SERVER_PORT + PORT_DISCOVERY_MAX; p++) {
    try {
      const res = await fetch(`http://localhost:${p}/health`, { signal: AbortSignal.timeout(500) });
      if (res.ok) {
        const data = (await res.json()) as { ok?: boolean; port?: number };
        const port = typeof data?.port === 'number' ? data.port : p;
        useAppStore.getState().setServerPort(port);
        return port;
      }
    } catch {
      // try next port
    }
  }
  useAppStore.getState().setServerPort(DEFAULT_SERVER_PORT);
  return DEFAULT_SERVER_PORT;
}

// Export for use in other modules
export const getServerUrl = getApiUrl;
export const getWsUrl = getWsUrlInternal;

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

// Thread types (Phase 2/3)
export interface ThreadMessage {
  role: 'user' | 'assistant';
  content: string;
  timestamp: string;
  turnId: string;
  usage?: {
    inputTokens: number;
    outputTokens: number;
    costUsd?: number;
  };
}

export interface Thread {
  id: string;
  name?: string;
  projectPath: string;
  worktreePath?: string;
  createdAt: string;
  lastActiveAt: string;
  history: ThreadMessage[];
  sessionId?: string;
}

export interface ThreadSummary {
  id: string;
  name?: string;
  projectPath: string;
  worktreePath?: string;
  createdAt: string;
  lastActiveAt: string;
  messageCount: number;
  hasSession: boolean;
}

// API functions
export const api = {
  async checkHealth(): Promise<boolean> {
    try {
      const res = await fetch(`${getApiUrl()}/health`, { signal: AbortSignal.timeout(2000) });
      return res.ok;
    } catch {
      return false;
    }
  },

  async checkClaudeCode(): Promise<{ available: boolean; version?: string }> {
    try {
      const res = await fetch(`${getApiUrl()}/check/claude-code`);
      const data = await res.json();
      return { available: data.available, version: data.version };
    } catch {
      return { available: false };
    }
  },

  async initClaudeCode(): Promise<{ ok: boolean; error?: string }> {
    try {
      const res = await fetch(`${getApiUrl()}/adapters/claude-code/init`, { method: 'POST' });
      const data = await res.json();
      return { ok: data.ok, error: data.error };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : 'Failed to init' };
    }
  },

  async createTask(message: string, agent?: string): Promise<{ taskId: string }> {
    const res = await fetch(`${getApiUrl()}/tasks`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message, agent }),
    });
    const data = await res.json();
    if (!data.ok) throw new Error(data.error);
    return { taskId: data.taskId };
  },

  async getTask(taskId: string): Promise<Task> {
    const res = await fetch(`${getApiUrl()}/tasks/${taskId}`);
    const data = await res.json();
    if (!data.ok) throw new Error(data.error);
    return data.task;
  },

  async planTask(taskId: string, agent?: string): Promise<{ plan: string; agent: string }> {
    const url = new URL(`${getApiUrl()}/tasks/${taskId}/plan`);
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
    const res = await fetch(`${getApiUrl()}/tasks/${taskId}/execute`, { 
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ agent }),
    });
    const data = await res.json();
    if (!data.ok) throw new Error(data.error);
    return { result: data.result };
  },

  async getAgents(): Promise<Agent[]> {
    try {
      const res = await fetch(`${getApiUrl()}/agents`);
      const data = await res.json();
      return data.agents || [];
    } catch {
      return [];
    }
  },

  async getAdapters(): Promise<Array<{ id: string; kind: string; state: { status: string } }>> {
    try {
      const res = await fetch(`${getApiUrl()}/adapters`);
      const data = await res.json();
      return data.adapters || [];
    } catch {
      return [];
    }
  },

  // Thread API (Phase 2/3)
  async listThreads(): Promise<ThreadSummary[]> {
    const res = await fetch(`${getApiUrl()}/threads`);
    const data = await res.json();
    if (!data.ok) throw new Error(data.error);
    return data.threads;
  },

  async getThread(threadId: string): Promise<{ thread: Thread; session: { status: string; currentTurnId?: string } | null }> {
    const res = await fetch(`${getApiUrl()}/threads/${threadId}`);
    const data = await res.json();
    if (!data.ok) throw new Error(data.error);
    return { thread: data.thread, session: data.session };
  },

  async createSession(threadId: string, options: { cwd: string; name?: string; worktreePath?: string; resume?: boolean }): Promise<{ threadId: string; session: { status: string; cwd: string } }> {
    const res = await fetch(`${getApiUrl()}/threads/${threadId}/session`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(options),
    });
    const data = await res.json();
    if (!data.ok) throw new Error(data.error);
    return { threadId: data.threadId, session: data.session };
  },

  async sendToThread(threadId: string, options: {
    message: string;
    effort?: 'low' | 'medium' | 'high' | 'max';
    thinking?: { type: 'adaptive' } | { type: 'enabled'; budgetTokens?: number } | { type: 'disabled' };
    maxTurns?: number;
    model?: string;
  }): Promise<{ turnId: string }> {
    const res = await fetch(`${getApiUrl()}/threads/${threadId}/send`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(options),
    });
    const data = await res.json();
    if (!data.ok) throw new Error(data.error);
    return { turnId: data.turnId };
  },

  async closeSession(threadId: string): Promise<void> {
    await fetch(`${getApiUrl()}/threads/${threadId}/close`, { method: 'POST' });
  },

  async deleteThread(threadId: string): Promise<void> {
    await fetch(`${getApiUrl()}/threads/${threadId}`, { method: 'DELETE' });
  },

  async forkThread(threadId: string, options: { name?: string; fromTurnId?: string }): Promise<Thread> {
    const res = await fetch(`${getApiUrl()}/threads/${threadId}/fork`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(options),
    });
    const data = await res.json();
    if (!data.ok) throw new Error(data.error);
    return data.thread;
  },
};

interface AppState {
  // Server (not persisted; discovered in dev when not in Electron)
  serverPort: number;

  // Project
  currentProject: Project | null;
  recentProjects: Project[];

  // Agents
  agents: Agent[];
  claudeCodeAvailable: boolean;
  claudeCodeVersion: string | null;
  serverOffline: boolean;
  
  // Tasks
  tasks: Task[];
  activeTaskId: string | null;
  
  // Widget layouts (per project path)
  widgetLayouts: Record<string, any>;
  
  // Actions
  setServerPort: (port: number) => void;
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
      serverPort: DEFAULT_SERVER_PORT,
      currentProject: null,
      recentProjects: [],
      agents: [],
      claudeCodeAvailable: false,
      claudeCodeVersion: null,
      serverOffline: false,
      tasks: [],
      activeTaskId: null,
      widgetLayouts: {},

      setServerPort: (port) => set({ serverPort: port }),

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
        const ok = await api.checkHealth();
        set({ serverOffline: !ok });
        if (!ok) return;

        const ccStatus = await api.checkClaudeCode();
        set({
          claudeCodeAvailable: ccStatus.available,
          claudeCodeVersion: ccStatus.version ?? null,
        });

        if (ccStatus.available) {
          await api.initClaudeCode();
        }

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
