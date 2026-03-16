import { create } from 'zustand';

// Agent type matching Workspace.tsx
export interface WorkspaceAgent {
  id: string;
  name: string;
  status: 'ready' | 'busy' | 'offline';
  icon: string;
  type: 'claude-code' | 'openclaw';
}

// Plan step type matching Workspace.tsx
export interface PlanStep {
  id: string;
  text: string;
  agent: string | null;
  status?: 'pending' | 'running' | 'completed' | 'failed';
  source?: 'plan' | 'extracted' | 'manual';
  threadId?: string;
  turnId?: string;
  costUsd?: number;
  durationMs?: number;
}

// Terminal state type (simplified for command palette use)
export interface TerminalInfo {
  id: string;
  agentId: string;
  agentName: string;
}

/**
 * Workspace store - bridge between command palette and Workspace.tsx
 *
 * The command palette calls these actions, and Workspace.tsx registers
 * callbacks to handle the actual terminal/task creation with full context
 * (WebSocket connections, local state, etc.)
 */
interface WorkspaceState {
  // Current workspace path
  workspacePath: string | null;

  // Available agents for terminal creation
  agents: WorkspaceAgent[];

  // Current terminals (for display in command palette)
  terminals: TerminalInfo[];

  // Plan steps / tasks
  planSteps: PlanStep[];

  // Navigation callback (set by App.tsx)
  navigateToView: ((view: string) => void) | null;

  // Terminal creation callback (set by Workspace.tsx)
  onCreateTerminal: ((agentId: string) => void) | null;

  // Task creation callback (set by Workspace.tsx)
  onCreateTask: ((text: string, agentId: string | null) => void) | null;

  // Actions for external callers (command palette)
  setWorkspacePath: (path: string | null) => void;
  setAgents: (agents: WorkspaceAgent[]) => void;
  setTerminals: (terminals: TerminalInfo[]) => void;
  setPlanSteps: (steps: PlanStep[]) => void;

  // Register callbacks (called by Workspace.tsx and App.tsx)
  registerNavigateCallback: (callback: (view: string) => void) => void;
  registerTerminalCallback: (callback: (agentId: string) => void) => void;
  registerTaskCallback: (callback: (text: string, agentId: string | null) => void) => void;

  // Command palette calls these
  createTerminal: (agentId: string) => void;
  createTask: (text: string, agentId: string | null) => void;
  navigateTo: (view: string) => void;
}

export const useWorkspaceStore = create<WorkspaceState>()((set, get) => ({
  // Initial state
  workspacePath: null,
  agents: [],
  terminals: [],
  planSteps: [],
  navigateToView: null,
  onCreateTerminal: null,
  onCreateTask: null,

  // Setters (called by Workspace.tsx to sync state)
  setWorkspacePath: (path) => set({ workspacePath: path }),
  setAgents: (agents) => set({ agents }),
  setTerminals: (terminals) => set({ terminals }),
  setPlanSteps: (steps) => set({ planSteps: steps }),

  // Register callbacks
  registerNavigateCallback: (callback) => set({ navigateToView: callback }),
  registerTerminalCallback: (callback) => set({ onCreateTerminal: callback }),
  registerTaskCallback: (callback) => set({ onCreateTask: callback }),

  // Action dispatchers (called by command palette)
  createTerminal: (agentId) => {
    const { onCreateTerminal } = get();
    if (onCreateTerminal) {
      onCreateTerminal(agentId);
    } else {
      console.warn('[WorkspaceStore] No terminal callback registered');
    }
  },

  createTask: (text, agentId) => {
    const { onCreateTask } = get();
    if (onCreateTask) {
      onCreateTask(text, agentId);
    } else {
      console.warn('[WorkspaceStore] No task callback registered');
    }
  },

  navigateTo: (view) => {
    const { navigateToView } = get();
    if (navigateToView) {
      navigateToView(view);
    } else {
      console.warn('[WorkspaceStore] No navigate callback registered');
    }
  },
}));
