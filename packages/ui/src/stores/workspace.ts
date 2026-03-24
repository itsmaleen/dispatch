import { create } from 'zustand';
import type {
  ProjectState,
  SavedTerminalState,
  SavedConsoleState,
} from '@acc/contracts';

// Agent type matching Workspace.tsx
export interface WorkspaceAgent {
  id: string;
  name: string;
  status: 'ready' | 'busy' | 'offline';
  icon: string;
  type: 'claude-code' | 'openclaw';
}

// Options for resuming a previous session when creating a console
export interface ConsoleResumeOptions {
  threadId: string;       // Thread ID to resume
  resume: boolean;        // Whether to resume the session
  sessionId?: string;     // Claude Code SDK session ID
  projectPath?: string;   // Original project path (CWD) for the session
}

// ============================================================================
// LAYOUT TREE TYPES (tmux-style nested panel layout)
// ============================================================================

/** A leaf node represents a single widget in the layout */
export interface LayoutLeaf {
  type: 'leaf';
  id: string;
  widgetType: WidgetType;
  widgetId: string; // ID of the agent console, 'tasks-widget', or 'agent-status-widget'
}

/** A group node represents a split container with children */
export interface LayoutGroup {
  type: 'group';
  id: string;
  direction: 'horizontal' | 'vertical';
  children: LayoutNode[];
  sizes: number[]; // Percentage sizes for each child
}

export type LayoutNode = LayoutLeaf | LayoutGroup;

/** Layout preset names */
export type LayoutPreset = 'default' | 'master-stack' | 'even-horizontal' | 'even-vertical' | 'quad';

/** Widget info for layout presets - includes all widget types (agent-console, terminal, tasks, agent-status) */
export interface LayoutWidgetInfo {
  type: WidgetType;
  id: string;
}

// ============================================================================
// BROWSER SESSION ID (for multi-window isolation)
// ============================================================================

/**
 * Get a unique session ID for this browser tab/window.
 * Uses sessionStorage so it persists across page refreshes but is unique per tab.
 * In Electron, uses the window ID from the main process.
 */
export function getBrowserSessionId(): string {
  // In Electron, use window ID from main process
  if (typeof window !== 'undefined' && window.electronAPI?.window?.getId) {
    return `electron-${window.electronAPI.window.getId()}`;
  }

  // In browser, use sessionStorage for per-tab isolation
  if (typeof window !== 'undefined' && typeof sessionStorage !== 'undefined') {
    const SESSION_ID_KEY = 'acc-browser-session-id';
    let sessionId = sessionStorage.getItem(SESSION_ID_KEY);
    if (!sessionId) {
      sessionId = `browser-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
      sessionStorage.setItem(SESSION_ID_KEY, sessionId);
    }
    return sessionId;
  }

  return 'default';
}

/** Storage key for layout persistence - scoped by browser session */
function getLayoutStorageKey(): string {
  return `workspace-layout-v2-${getBrowserSessionId()}`;
}

// Legacy key for migration
const LEGACY_LAYOUT_STORAGE_KEY = 'workspace-layout-v1';

// ============================================================================
// LAYOUT TREE HELPERS
// ============================================================================

/** Generate a unique ID for layout nodes */
function generateLayoutId(): string {
  return `layout-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

/** Find a node in the layout tree by ID */
function findNode(tree: LayoutNode, id: string): LayoutNode | null {
  if (tree.id === id) return tree;
  if (tree.type === 'group') {
    for (const child of tree.children) {
      const found = findNode(child, id);
      if (found) return found;
    }
  }
  return null;
}

/** Find the parent group of a node by ID */
function findParent(tree: LayoutNode, id: string): LayoutGroup | null {
  if (tree.type === 'leaf') return null;
  for (const child of tree.children) {
    if (child.id === id) return tree;
    const found = findParent(child, id);
    if (found) return found;
  }
  return null;
}

/** Deep clone a layout tree */
function cloneTree(node: LayoutNode): LayoutNode {
  if (node.type === 'leaf') {
    return { ...node };
  }
  return {
    ...node,
    children: node.children.map(cloneTree),
    sizes: [...node.sizes],
  };
}

/** Replace a node in the tree (returns new tree) */
function replaceNode(tree: LayoutNode, id: string, replacement: LayoutNode): LayoutNode {
  if (tree.id === id) return replacement;
  if (tree.type === 'leaf') return tree;
  return {
    ...tree,
    children: tree.children.map(child => replaceNode(child, id, replacement)),
    sizes: [...tree.sizes],
  };
}

/** Remove a node from the tree (returns new tree or null if tree becomes empty) */
function removeNode(tree: LayoutNode, id: string): LayoutNode | null {
  if (tree.id === id) return null;
  if (tree.type === 'leaf') return tree;

  const newChildren: LayoutNode[] = [];
  const newSizes: number[] = [];

  for (let i = 0; i < tree.children.length; i++) {
    const child = tree.children[i];
    if (child.id === id) {
      // Skip this child, redistribute its size
      continue;
    }
    const result = removeNode(child, id);
    if (result) {
      newChildren.push(result);
      newSizes.push(tree.sizes[i]);
    }
  }

  if (newChildren.length === 0) return null;
  if (newChildren.length === 1) {
    // Collapse single-child group
    return newChildren[0];
  }

  // Normalize sizes to sum to 100
  const totalSize = newSizes.reduce((a, b) => a + b, 0);
  const normalizedSizes = newSizes.map(s => (s / totalSize) * 100);

  return {
    ...tree,
    children: newChildren,
    sizes: normalizedSizes,
  };
}

/**
 * Create default layout: content widgets on left (stacked vertically), utility widgets on right
 * Caller provides ALL widgets - this function separates them into content vs utility
 */
function createDefaultLayout(widgets: LayoutWidgetInfo[]): LayoutNode {
  // Separate content widgets (consoles, terminals) from utility widgets (tasks, agent-status)
  const contentWidgets = widgets.filter(w => w.type === 'agent-console' || w.type === 'terminal');
  const utilityWidgets = widgets.filter(w => w.type === 'tasks' || w.type === 'agent-status');

  // If no content widgets, just return utility widgets stacked vertically
  if (contentWidgets.length === 0) {
    if (utilityWidgets.length === 0) {
      // Edge case: no widgets at all
      return {
        type: 'leaf',
        id: generateLayoutId(),
        widgetType: 'tasks',
        widgetId: 'tasks-widget',
      };
    }
    if (utilityWidgets.length === 1) {
      return {
        type: 'leaf',
        id: generateLayoutId(),
        widgetType: utilityWidgets[0].type,
        widgetId: utilityWidgets[0].id,
      };
    }
    return {
      type: 'group',
      id: 'root',
      direction: 'vertical',
      children: utilityWidgets.map(w => ({
        type: 'leaf',
        id: generateLayoutId(),
        widgetType: w.type,
        widgetId: w.id,
      })),
      sizes: utilityWidgets.map(() => 100 / utilityWidgets.length),
    };
  }

  // Create left panel for content widgets
  const leftChildren: LayoutLeaf[] = contentWidgets.map(w => ({
    type: 'leaf',
    id: generateLayoutId(),
    widgetType: w.type,
    widgetId: w.id,
  }));

  const leftPanel: LayoutNode = leftChildren.length === 1
    ? leftChildren[0]
    : {
        type: 'group',
        id: generateLayoutId(),
        direction: 'vertical',
        children: leftChildren,
        sizes: leftChildren.map(() => 100 / leftChildren.length),
      };

  // If no utility widgets, just return content
  if (utilityWidgets.length === 0) {
    return leftPanel;
  }

  // Create right panel for utility widgets (agent-status on top if present, then tasks)
  // Sort so agent-status comes before tasks
  const sortedUtility = [...utilityWidgets].sort((a, b) => {
    if (a.type === 'agent-status') return -1;
    if (b.type === 'agent-status') return 1;
    return 0;
  });

  const rightChildren: LayoutLeaf[] = sortedUtility.map(w => ({
    type: 'leaf',
    id: generateLayoutId(),
    widgetType: w.type,
    widgetId: w.id,
  }));

  // Size agent-status smaller (30%) and tasks larger (70%) if both present
  const rightSizes = sortedUtility.length === 2 && sortedUtility[0].type === 'agent-status'
    ? [30, 70]
    : sortedUtility.map(() => 100 / sortedUtility.length);

  const rightPanel: LayoutNode = rightChildren.length === 1
    ? rightChildren[0]
    : {
        type: 'group',
        id: generateLayoutId(),
        direction: 'vertical',
        children: rightChildren,
        sizes: rightSizes,
      };

  return {
    type: 'group',
    id: 'root',
    direction: 'horizontal',
    children: [leftPanel, rightPanel],
    sizes: [60, 40],
  };
}

/**
 * Create master-stack layout: first widget takes large left panel, rest stacked on right
 * All widgets provided by caller - no auto-adding
 */
function createMasterStackLayout(widgets: LayoutWidgetInfo[]): LayoutNode {
  if (widgets.length === 0) {
    return {
      type: 'leaf',
      id: generateLayoutId(),
      widgetType: 'tasks',
      widgetId: 'tasks-widget',
    };
  }

  if (widgets.length === 1) {
    return {
      type: 'leaf',
      id: generateLayoutId(),
      widgetType: widgets[0].type,
      widgetId: widgets[0].id,
    };
  }

  const [mainWidget, ...stackWidgets] = widgets;

  const mainPanel: LayoutLeaf = {
    type: 'leaf',
    id: generateLayoutId(),
    widgetType: mainWidget.type,
    widgetId: mainWidget.id,
  };

  const stackPanels: LayoutLeaf[] = stackWidgets.map(w => ({
    type: 'leaf',
    id: generateLayoutId(),
    widgetType: w.type,
    widgetId: w.id,
  }));

  const stackGroup: LayoutGroup = {
    type: 'group',
    id: generateLayoutId(),
    direction: 'vertical',
    children: stackPanels,
    sizes: stackPanels.map(() => 100 / stackPanels.length),
  };

  return {
    type: 'group',
    id: 'root',
    direction: 'horizontal',
    children: [mainPanel, stackGroup],
    sizes: [65, 35],
  };
}

/**
 * Create even horizontal split layout - all widgets side by side
 * All widgets provided by caller - no auto-adding
 */
function createEvenHorizontalLayout(widgets: LayoutWidgetInfo[]): LayoutNode {
  if (widgets.length === 0) {
    return {
      type: 'leaf',
      id: generateLayoutId(),
      widgetType: 'tasks',
      widgetId: 'tasks-widget',
    };
  }

  if (widgets.length === 1) {
    return {
      type: 'leaf',
      id: generateLayoutId(),
      widgetType: widgets[0].type,
      widgetId: widgets[0].id,
    };
  }

  const panels: LayoutLeaf[] = widgets.map(w => ({
    type: 'leaf',
    id: generateLayoutId(),
    widgetType: w.type,
    widgetId: w.id,
  }));

  return {
    type: 'group',
    id: 'root',
    direction: 'horizontal',
    children: panels,
    sizes: panels.map(() => 100 / panels.length),
  };
}

/**
 * Create even vertical split layout - all widgets stacked vertically
 * All widgets provided by caller - no auto-adding
 */
function createEvenVerticalLayout(widgets: LayoutWidgetInfo[]): LayoutNode {
  if (widgets.length === 0) {
    return {
      type: 'leaf',
      id: generateLayoutId(),
      widgetType: 'tasks',
      widgetId: 'tasks-widget',
    };
  }

  if (widgets.length === 1) {
    return {
      type: 'leaf',
      id: generateLayoutId(),
      widgetType: widgets[0].type,
      widgetId: widgets[0].id,
    };
  }

  const panels: LayoutLeaf[] = widgets.map(w => ({
    type: 'leaf',
    id: generateLayoutId(),
    widgetType: w.type,
    widgetId: w.id,
  }));

  return {
    type: 'group',
    id: 'root',
    direction: 'vertical',
    children: panels,
    sizes: panels.map(() => 100 / panels.length),
  };
}

/**
 * Create quad layout (2x2 grid) - uses first 4 widgets
 * All widgets provided by caller - no auto-adding
 */
function createQuadLayout(widgets: LayoutWidgetInfo[]): LayoutNode {
  // Use up to 4 widgets
  const slots = widgets.slice(0, 4);

  if (slots.length === 0) {
    return {
      type: 'leaf',
      id: generateLayoutId(),
      widgetType: 'tasks',
      widgetId: 'tasks-widget',
    };
  }

  if (slots.length === 1) {
    return {
      type: 'leaf',
      id: generateLayoutId(),
      widgetType: slots[0].type,
      widgetId: slots[0].id,
    };
  }

  // For 2-4 widgets, create appropriate grid
  const createSlot = (idx: number): LayoutLeaf => ({
    type: 'leaf',
    id: generateLayoutId(),
    widgetType: slots[idx].type,
    widgetId: slots[idx].id,
  });

  if (slots.length === 2) {
    // 2 widgets: side by side
    return {
      type: 'group',
      id: 'root',
      direction: 'horizontal',
      children: [createSlot(0), createSlot(1)],
      sizes: [50, 50],
    };
  }

  if (slots.length === 3) {
    // 3 widgets: 2 on top, 1 on bottom (centered or left-aligned)
    const topRow: LayoutGroup = {
      type: 'group',
      id: generateLayoutId(),
      direction: 'horizontal',
      children: [createSlot(0), createSlot(1)],
      sizes: [50, 50],
    };

    return {
      type: 'group',
      id: 'root',
      direction: 'vertical',
      children: [topRow, createSlot(2)],
      sizes: [50, 50],
    };
  }

  // 4 widgets: full 2x2 grid
  const topRow: LayoutGroup = {
    type: 'group',
    id: generateLayoutId(),
    direction: 'horizontal',
    children: [createSlot(0), createSlot(1)],
    sizes: [50, 50],
  };

  const bottomRow: LayoutGroup = {
    type: 'group',
    id: generateLayoutId(),
    direction: 'horizontal',
    children: [createSlot(2), createSlot(3)],
    sizes: [50, 50],
  };

  return {
    type: 'group',
    id: 'root',
    direction: 'vertical',
    children: [topRow, bottomRow],
    sizes: [50, 50],
  };
}

// Export layout helpers for use in Workspace.tsx
export const layoutHelpers = {
  generateLayoutId,
  findNode,
  findParent,
  cloneTree,
  createDefaultLayout,
  createMasterStackLayout,
  createEvenHorizontalLayout,
  createEvenVerticalLayout,
  createQuadLayout,
};

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

// Agent console state type (simplified for command palette use)
export interface ConsoleInfo {
  id: string;
  agentId: string;
  agentName: string;
}

/** @deprecated Use ConsoleInfo instead */
export type TerminalInfo = ConsoleInfo;

// Real PTY terminal info (simplified for store use)
export interface RealTerminalInfo {
  id: string;
  name: string;
}

// Widget types for focus management
export type WidgetType = 'agent-console' | 'tasks' | 'agent-status' | 'terminal';

export interface WidgetInfo {
  id: string;
  type: WidgetType;
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

  // Available agents for console creation
  agents: WorkspaceAgent[];

  // Current agent consoles (for display in command palette)
  consoles: ConsoleInfo[];

  // Real PTY terminals
  realTerminals: RealTerminalInfo[];

  // Plan steps / tasks
  planSteps: PlanStep[];

  // Focus management
  focusedWidgetId: string | null;
  focusedWidgetType: WidgetType | null;
  maximizedWidgetId: string | null;

  // Widget registry for arrow key navigation (populated by Workspace.tsx)
  widgets: WidgetInfo[];

  // Agent status widget visibility
  showAgentStatus: boolean;

  // Tasks widget visibility
  tasksVisible: boolean;

  // Layout tree for flexible grid
  layoutTree: LayoutNode | null;

  // Navigation callback (set by App.tsx)
  navigateToView: ((view: string) => void) | null;

  // Console creation callback (set by Workspace.tsx)
  onCreateConsole: ((agentId: string, options?: ConsoleResumeOptions) => void) | null;

  // Terminal creation callback (set by Workspace.tsx)
  onCreateTerminal: ((cwd?: string) => void) | null;

  // Task creation callback (set by Workspace.tsx)
  onCreateTask: ((text: string, agentId: string | null) => void) | null;

  // Console action callbacks (set by Workspace.tsx)
  onCloseConsole: ((consoleId: string) => void) | null;
  onMinimizeConsole: ((consoleId: string) => void) | null;
  onMaximizeConsole: ((consoleId: string) => void) | null;
  onRestoreConsole: ((consoleId: string) => void) | null;
  onClearConsole: ((consoleId: string) => void) | null;

  // Actions for external callers (command palette)
  setWorkspacePath: (path: string | null) => void;
  setAgents: (agents: WorkspaceAgent[]) => void;
  setConsoles: (consoles: ConsoleInfo[]) => void;
  setRealTerminals: (terminals: RealTerminalInfo[]) => void;
  setPlanSteps: (steps: PlanStep[]) => void;

  // Focus management actions
  setFocusedWidget: (id: string | null, type: WidgetType | null) => void;
  setMaximizedWidget: (id: string | null) => void;
  setWidgets: (widgets: WidgetInfo[]) => void;
  setShowAgentStatus: (show: boolean) => void;
  setTasksVisible: (visible: boolean) => void;

  // Navigate focus with arrow keys
  moveFocus: (direction: 'up' | 'down' | 'left' | 'right') => void;

  // Layout tree actions
  setLayoutTree: (tree: LayoutNode | null) => void;
  splitPanel: (panelId: string, direction: 'horizontal' | 'vertical', newWidgetId: string) => void;
  addPanelToLayout: (options: { widgetType: WidgetType; widgetId: string }) => void;
  closePanelInLayout: (panelId: string) => void;
  swapPanels: (panelId1: string, panelId2: string) => void;
  movePanel: (sourcePanelId: string, targetPanelId: string, position: 'left' | 'right' | 'top' | 'bottom' | 'center') => void;
  insertAtRootEdge: (sourcePanelId: string, edge: 'left' | 'right' | 'top' | 'bottom') => void;
  updatePanelSizes: (groupId: string, sizes: number[]) => void;
  applyLayoutPreset: (preset: LayoutPreset, widgets: LayoutWidgetInfo[]) => void;
  saveLayout: () => void;
  restoreLayout: () => LayoutNode | null;

  // Register callbacks (called by Workspace.tsx and App.tsx)
  registerNavigateCallback: (callback: (view: string) => void) => void;
  registerConsoleCallback: (callback: (agentId: string, options?: ConsoleResumeOptions) => void) => void;
  registerTerminalCallback: (callback: (cwd?: string) => void) => void;
  registerTaskCallback: (callback: (text: string, agentId: string | null) => void) => void;
  registerConsoleActionCallbacks: (callbacks: {
    onClose: (consoleId: string) => void;
    onMinimize: (consoleId: string) => void;
    onMaximize: (consoleId: string) => void;
    onRestore: (consoleId: string) => void;
    onClear: (consoleId: string) => void;
  }) => void;

  // Command palette calls these
  createConsole: (agentId: string, options?: ConsoleResumeOptions) => void;
  createTerminal: (cwd?: string) => void;
  createTask: (text: string, agentId: string | null) => void;
  navigateTo: (view: string) => void;

  // Console actions (called by command palette)
  closeConsole: (consoleId: string) => void;
  minimizeConsole: (consoleId: string) => void;
  maximizeConsole: (consoleId: string) => void;
  restoreConsole: (consoleId: string) => void;
  clearConsole: (consoleId: string) => void;
  closeFocusedConsole: () => void;
  toggleMaximizeFocusedWidget: () => void;

  // Project State Persistence
  // Full console data getter (set by Workspace.tsx for state capture)
  getFullConsoleData: (() => FullConsoleData[]) | null;
  // Full terminal data getter (set by Workspace.tsx for state capture)
  getFullTerminalData: (() => FullTerminalData[]) | null;
  // Register data getters (called by Workspace.tsx)
  registerDataGetters: (getters: {
    getConsoles: () => FullConsoleData[];
    getTerminals: () => FullTerminalData[];
  }) => void;
  // Capture current workspace state for saving
  captureProjectState: () => ProjectState | null;
  // Apply restored state callback (set by Workspace.tsx)
  onApplyProjectState: ((state: ProjectState) => Promise<void>) | null;
  // Register apply callback
  registerApplyStateCallback: (callback: (state: ProjectState) => Promise<void>) => void;
  // Apply a restored project state
  applyProjectState: (state: ProjectState) => Promise<void>;
}

// Full console data for state capture (includes thread/session info)
export interface FullConsoleData {
  id: string;
  agentId: string;
  threadId?: string;
  sessionId?: string;
  label?: string;
  accentColor?: string;
  cwd?: string;
  worktreePath?: string;
  worktreeBranch?: string;
}

// Full terminal data for state capture
export interface FullTerminalData {
  id: string;
  name: string;
  cwd: string;
  createdBy?: 'user' | 'agent';
  labels?: Record<string, string>;
}

export const useWorkspaceStore = create<WorkspaceState>()((set, get) => ({
  // Initial state
  workspacePath: null,
  agents: [],
  consoles: [],
  realTerminals: [],
  planSteps: [],
  focusedWidgetId: null,
  focusedWidgetType: null,
  maximizedWidgetId: null,
  widgets: [],
  showAgentStatus: false, // Hidden by default so ProjectStartingPoint shows first
  tasksVisible: false, // Hidden by default so ProjectStartingPoint shows first
  layoutTree: null,
  navigateToView: null,
  onCreateConsole: null,
  onCreateTerminal: null,
  onCreateTask: null,
  onCloseConsole: null,
  onMinimizeConsole: null,
  onMaximizeConsole: null,
  onRestoreConsole: null,
  onClearConsole: null,
  getFullConsoleData: null,
  getFullTerminalData: null,
  onApplyProjectState: null,

  // Setters (called by Workspace.tsx to sync state)
  setWorkspacePath: (path) => set({ workspacePath: path }),
  setAgents: (agents) => set({ agents }),
  setConsoles: (consoles) => set({ consoles }),
  setRealTerminals: (terminals) => set({ realTerminals: terminals }),
  setPlanSteps: (steps) => set({ planSteps: steps }),

  // Focus management
  setFocusedWidget: (id, type) => set({ focusedWidgetId: id, focusedWidgetType: type }),
  setMaximizedWidget: (id) => set({ maximizedWidgetId: id }),
  setWidgets: (widgets) => set({ widgets }),
  setShowAgentStatus: (show) => set({ showAgentStatus: show }),
  setTasksVisible: (visible) => set({ tasksVisible: visible }),

  // Arrow key / shortcut navigation
  moveFocus: (direction) => {
    const { widgets, focusedWidgetId } = get();
    if (widgets.length === 0) return;

    // Helper to blur any active input and set focus
    const blurAndSetFocus = (id: string, type: WidgetType) => {
      // Blur any currently focused DOM element (e.g., text inputs) when navigating
      if (document.activeElement instanceof HTMLElement) {
        const tagName = document.activeElement.tagName;
        if (tagName === 'INPUT' || tagName === 'TEXTAREA' || document.activeElement.isContentEditable) {
          document.activeElement.blur();
        }
      }
      set({ focusedWidgetId: id, focusedWidgetType: type });
    };

    // If nothing focused, focus the first widget
    if (!focusedWidgetId) {
      const first = widgets[0];
      if (first) {
        blurAndSetFocus(first.id, first.type);
      }
      return;
    }

    const currentIndex = widgets.findIndex(w => w.id === focusedWidgetId);
    if (currentIndex === -1) {
      const first = widgets[0];
      if (first) {
        blurAndSetFocus(first.id, first.type);
      }
      return;
    }

    // Simple navigation: up/left = previous, down/right = next
    let nextIndex = currentIndex;
    if (direction === 'up' || direction === 'left') {
      nextIndex = currentIndex > 0 ? currentIndex - 1 : widgets.length - 1;
    } else {
      nextIndex = currentIndex < widgets.length - 1 ? currentIndex + 1 : 0;
    }

    const nextWidget = widgets[nextIndex];
    if (nextWidget) {
      blurAndSetFocus(nextWidget.id, nextWidget.type);
    }
  },

  // Layout tree actions
  setLayoutTree: (tree) => set({ layoutTree: tree }),

  splitPanel: (panelId, direction, newWidgetId) => {
    const { layoutTree } = get();
    if (!layoutTree) return;

    // Find the leaf node to split
    const targetNode = findNode(layoutTree, panelId);
    if (!targetNode || targetNode.type !== 'leaf') {
      console.warn('[WorkspaceStore] Cannot split: panel not found or not a leaf');
      return;
    }

    // Create new leaf for the new agent console
    const newLeaf: LayoutLeaf = {
      type: 'leaf',
      id: generateLayoutId(),
      widgetType: 'agent-console',
      widgetId: newWidgetId,
    };

    // Create a new group containing the original and new leaf
    const newGroup: LayoutGroup = {
      type: 'group',
      id: generateLayoutId(),
      direction,
      children: [targetNode, newLeaf],
      sizes: [50, 50],
    };

    // Replace the original leaf with the new group
    const newTree = replaceNode(layoutTree, panelId, newGroup);
    set({ layoutTree: newTree });
  },

  addPanelToLayout: (options) => {
    const { layoutTree } = get();
    const { widgetType, widgetId } = options;

    // Create new leaf for the widget
    const newLeaf: LayoutLeaf = {
      type: 'leaf',
      id: generateLayoutId(),
      widgetType,
      widgetId,
    };

    if (!layoutTree) {
      // No existing layout - create a single leaf as root
      set({ layoutTree: newLeaf });
      return;
    }

    if (layoutTree.type === 'leaf') {
      // Single leaf - create a horizontal group with the existing and new leaf
      const newGroup: LayoutGroup = {
        type: 'group',
        id: generateLayoutId(),
        direction: 'horizontal',
        children: [layoutTree, newLeaf],
        sizes: [50, 50],
      };
      set({ layoutTree: newGroup });
      return;
    }

    // Group - add to the end of the top-level group
    const updatedGroup: LayoutGroup = {
      ...layoutTree,
      children: [...layoutTree.children, newLeaf],
      sizes: layoutTree.sizes.map(() => 100 / (layoutTree.children.length + 1))
        .concat([100 / (layoutTree.children.length + 1)]),
    };
    // Normalize sizes to add up to 100
    const total = updatedGroup.sizes.reduce((a, b) => a + b, 0);
    updatedGroup.sizes = updatedGroup.sizes.map(s => (s / total) * 100);
    set({ layoutTree: updatedGroup });
  },

  closePanelInLayout: (panelId) => {
    const { layoutTree } = get();
    if (!layoutTree) return;

    const newTree = removeNode(layoutTree, panelId);
    set({ layoutTree: newTree });
  },

  swapPanels: (panelId1, panelId2) => {
    const { layoutTree } = get();
    if (!layoutTree) return;

    const node1 = findNode(layoutTree, panelId1);
    const node2 = findNode(layoutTree, panelId2);

    if (!node1 || !node2 || node1.type !== 'leaf' || node2.type !== 'leaf') {
      console.warn('[WorkspaceStore] Cannot swap: panels not found or not leaves');
      return;
    }

    // Swap the widget contents but keep the layout node IDs
    const temp1 = { widgetType: node1.widgetType, widgetId: node1.widgetId };
    const temp2 = { widgetType: node2.widgetType, widgetId: node2.widgetId };

    // Clone and update
    const newTree = cloneTree(layoutTree);
    const newNode1 = findNode(newTree, panelId1) as LayoutLeaf;
    const newNode2 = findNode(newTree, panelId2) as LayoutLeaf;

    if (newNode1 && newNode2) {
      newNode1.widgetType = temp2.widgetType;
      newNode1.widgetId = temp2.widgetId;
      newNode2.widgetType = temp1.widgetType;
      newNode2.widgetId = temp1.widgetId;
    }

    set({ layoutTree: newTree });
  },

  movePanel: (sourcePanelId, targetPanelId, position) => {
    const { layoutTree } = get();
    if (!layoutTree) return;
    if (sourcePanelId === targetPanelId) return;

    // If position is 'center', just swap the panels
    if (position === 'center') {
      get().swapPanels(sourcePanelId, targetPanelId);
      return;
    }

    const sourceNode = findNode(layoutTree, sourcePanelId);
    const targetNode = findNode(layoutTree, targetPanelId);

    if (!sourceNode || !targetNode || sourceNode.type !== 'leaf' || targetNode.type !== 'leaf') {
      console.warn('[WorkspaceStore] Cannot move: panels not found or not leaves');
      return;
    }

    // Clone the source node with a new ID (it will be inserted at the new location)
    const movedLeaf: LayoutLeaf = {
      type: 'leaf',
      id: generateLayoutId(),
      widgetType: sourceNode.widgetType,
      widgetId: sourceNode.widgetId,
    };

    // Determine direction based on position
    const direction: 'horizontal' | 'vertical' =
      position === 'left' || position === 'right' ? 'horizontal' : 'vertical';

    // Create a new group containing the target and the moved leaf
    const children: LayoutNode[] = position === 'left' || position === 'top'
      ? [movedLeaf, { ...targetNode, id: generateLayoutId() }]
      : [{ ...targetNode, id: generateLayoutId() }, movedLeaf];

    const newGroup: LayoutGroup = {
      type: 'group',
      id: generateLayoutId(),
      direction,
      children,
      sizes: [50, 50],
    };

    // First, replace the target with the new group
    let newTree: LayoutNode | null = replaceNode(layoutTree, targetPanelId, newGroup);

    // Then, remove the source panel from its original location
    if (newTree) {
      newTree = removeNode(newTree, sourcePanelId);
    }

    if (newTree) {
      set({ layoutTree: newTree });
    }
  },

  insertAtRootEdge: (sourcePanelId, edge) => {
    const { layoutTree } = get();
    if (!layoutTree) return;

    // Find the source node
    const sourceNode = findNode(layoutTree, sourcePanelId);
    if (!sourceNode || sourceNode.type !== 'leaf') {
      console.warn('[WorkspaceStore] Cannot insert at root edge: source panel not found or not a leaf');
      return;
    }

    // Remove the source from current location
    let treeWithoutSource = removeNode(layoutTree, sourcePanelId);
    if (!treeWithoutSource) {
      // Source was the only node, nothing to move
      console.warn('[WorkspaceStore] Cannot insert at root edge: source is the only panel');
      return;
    }

    // Create new leaf with new ID for the moved widget
    const newLeaf: LayoutLeaf = {
      type: 'leaf',
      id: generateLayoutId(),
      widgetType: sourceNode.widgetType,
      widgetId: sourceNode.widgetId,
    };

    // Determine direction based on edge
    const direction: 'horizontal' | 'vertical' =
      edge === 'left' || edge === 'right' ? 'horizontal' : 'vertical';

    // Order children based on edge (left/top = new panel first, right/bottom = new panel last)
    const children: LayoutNode[] = edge === 'left' || edge === 'top'
      ? [newLeaf, treeWithoutSource]
      : [treeWithoutSource, newLeaf];

    // Calculate sizes - new panel gets 25%, existing layout gets 75%
    const newPanelSize = 25;
    const existingSize = 75;
    const sizes = edge === 'left' || edge === 'top'
      ? [newPanelSize, existingSize]
      : [existingSize, newPanelSize];

    // Create new root group
    const newRoot: LayoutGroup = {
      type: 'group',
      id: 'root',
      direction,
      children,
      sizes,
    };

    set({ layoutTree: newRoot });
  },

  updatePanelSizes: (groupId, sizes) => {
    const { layoutTree } = get();
    if (!layoutTree) return;

    const node = findNode(layoutTree, groupId);
    if (!node || node.type !== 'group') return;

    const newTree = cloneTree(layoutTree);
    const targetGroup = findNode(newTree, groupId) as LayoutGroup;
    if (targetGroup) {
      targetGroup.sizes = sizes;
    }

    set({ layoutTree: newTree });
  },

  applyLayoutPreset: (preset, widgets) => {
    console.log('[applyLayoutPreset] Called with:', { preset, widgets });
    let newTree: LayoutNode;

    switch (preset) {
      case 'master-stack':
        newTree = createMasterStackLayout(widgets);
        break;
      case 'even-horizontal':
        newTree = createEvenHorizontalLayout(widgets);
        break;
      case 'even-vertical':
        newTree = createEvenVerticalLayout(widgets);
        break;
      case 'quad':
        newTree = createQuadLayout(widgets);
        break;
      case 'default':
      default:
        newTree = createDefaultLayout(widgets);
        break;
    }

    console.log('[applyLayoutPreset] New tree:', JSON.stringify(newTree, null, 2));
    set({ layoutTree: newTree });
  },

  saveLayout: () => {
    const { layoutTree } = get();
    if (layoutTree) {
      try {
        const key = getLayoutStorageKey();
        localStorage.setItem(key, JSON.stringify(layoutTree));
      } catch (e) {
        console.warn('[WorkspaceStore] Failed to save layout:', e);
      }
    }
  },

  restoreLayout: () => {
    try {
      const key = getLayoutStorageKey();
      let saved = localStorage.getItem(key);

      // Migration: try legacy key if session-scoped key doesn't exist
      if (!saved) {
        saved = localStorage.getItem(LEGACY_LAYOUT_STORAGE_KEY);
        if (saved) {
          // Migrate to new key and clear legacy
          localStorage.setItem(key, saved);
          localStorage.removeItem(LEGACY_LAYOUT_STORAGE_KEY);
        }
      }

      if (saved) {
        const tree = JSON.parse(saved) as LayoutNode;
        set({ layoutTree: tree });
        return tree;
      }
    } catch (e) {
      console.warn('[WorkspaceStore] Failed to restore layout:', e);
    }
    return null;
  },

  // Register callbacks
  registerNavigateCallback: (callback) => set({ navigateToView: callback }),
  registerConsoleCallback: (callback) => set({ onCreateConsole: callback }),
  registerTerminalCallback: (callback) => set({ onCreateTerminal: callback }),
  registerTaskCallback: (callback) => set({ onCreateTask: callback }),
  registerConsoleActionCallbacks: (callbacks) => set({
    onCloseConsole: callbacks.onClose,
    onMinimizeConsole: callbacks.onMinimize,
    onMaximizeConsole: callbacks.onMaximize,
    onRestoreConsole: callbacks.onRestore,
    onClearConsole: callbacks.onClear,
  }),

  // Action dispatchers (called by command palette)
  createConsole: (agentId, options) => {
    const { onCreateConsole } = get();
    if (onCreateConsole) {
      onCreateConsole(agentId, options);
    } else {
      console.warn('[WorkspaceStore] No console callback registered');
    }
  },

  createTerminal: (cwd) => {
    console.log('[WorkspaceStore] createTerminal called with cwd:', cwd);
    const { onCreateTerminal } = get();
    if (onCreateTerminal) {
      console.log('[WorkspaceStore] Calling onCreateTerminal callback');
      onCreateTerminal(cwd);
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

  // Console actions
  closeConsole: (consoleId) => {
    const { onCloseConsole } = get();
    if (onCloseConsole) {
      onCloseConsole(consoleId);
    }
  },

  minimizeConsole: (consoleId) => {
    const { onMinimizeConsole } = get();
    if (onMinimizeConsole) {
      onMinimizeConsole(consoleId);
    }
  },

  maximizeConsole: (consoleId) => {
    const { onMaximizeConsole } = get();
    if (onMaximizeConsole) {
      onMaximizeConsole(consoleId);
    }
  },

  restoreConsole: (consoleId) => {
    const { onRestoreConsole } = get();
    if (onRestoreConsole) {
      onRestoreConsole(consoleId);
    }
  },

  clearConsole: (consoleId) => {
    const { onClearConsole } = get();
    if (onClearConsole) {
      onClearConsole(consoleId);
    }
  },

  closeFocusedConsole: () => {
    const { focusedWidgetId, focusedWidgetType, onCloseConsole } = get();
    if (focusedWidgetType === 'agent-console' && focusedWidgetId && onCloseConsole) {
      onCloseConsole(focusedWidgetId);
    }
  },

  toggleMaximizeFocusedWidget: () => {
    const { focusedWidgetId, maximizedWidgetId, onMaximizeConsole, onRestoreConsole } = get();
    if (!focusedWidgetId) return;

    if (maximizedWidgetId === focusedWidgetId) {
      // Already maximized, restore it
      if (onRestoreConsole) {
        onRestoreConsole(focusedWidgetId);
      }
      set({ maximizedWidgetId: null });
    } else {
      // Maximize it
      if (onMaximizeConsole) {
        onMaximizeConsole(focusedWidgetId);
      }
      set({ maximizedWidgetId: focusedWidgetId });
    }
  },

  // Project State Persistence
  registerDataGetters: (getters) => set({
    getFullConsoleData: getters.getConsoles,
    getFullTerminalData: getters.getTerminals,
  }),

  registerApplyStateCallback: (callback) => set({ onApplyProjectState: callback }),

  captureProjectState: () => {
    const {
      workspacePath,
      getFullConsoleData,
      getFullTerminalData,
      layoutTree,
      focusedWidgetId,
      tasksVisible,
      showAgentStatus,
    } = get();

    if (!workspacePath) {
      console.warn('[WorkspaceStore] Cannot capture state: no workspace path');
      return null;
    }

    // Get full console data from Workspace.tsx
    const consoles: SavedConsoleState[] = getFullConsoleData
      ? getFullConsoleData().map((c) => ({
          id: c.id,
          threadId: c.threadId,
          sessionId: c.sessionId,
          label: c.label,
          accentColor: c.accentColor,
          cwd: c.cwd,
          worktreePath: c.worktreePath,
          worktreeBranch: c.worktreeBranch,
        }))
      : [];

    // Get full terminal data from Workspace.tsx
    const terminals: SavedTerminalState[] = getFullTerminalData
      ? getFullTerminalData().map((t) => ({
          id: t.id,
          name: t.name,
          cwd: t.cwd,
          createdBy: t.createdBy,
          labels: t.labels,
        }))
      : [];

    const state: ProjectState = {
      version: 1,
      projectPath: workspacePath,
      savedAt: new Date().toISOString(),
      terminals,
      consoles,
      layoutTree: layoutTree as ProjectState['layoutTree'],
      focusedWidgetId,
      tasksVisible,
      showAgentStatus,
    };

    console.log('[WorkspaceStore] Captured project state:', {
      terminals: terminals.length,
      consoles: consoles.length,
      hasLayout: !!layoutTree,
    });

    return state;
  },

  applyProjectState: async (state) => {
    const { onApplyProjectState } = get();

    if (!onApplyProjectState) {
      console.warn('[WorkspaceStore] Cannot apply state: no callback registered');
      return;
    }

    console.log('[WorkspaceStore] Applying project state:', {
      terminals: state.terminals.length,
      consoles: state.consoles.length,
      hasLayout: !!state.layoutTree,
    });

    // Delegate to Workspace.tsx for actual restoration
    await onApplyProjectState(state);

    // Apply UI state after terminals/consoles are restored
    set({
      tasksVisible: state.tasksVisible,
      showAgentStatus: state.showAgentStatus,
      focusedWidgetId: state.focusedWidgetId,
    });
  },
}));
