import { create } from 'zustand';

// Agent type matching Workspace.tsx
export interface WorkspaceAgent {
  id: string;
  name: string;
  status: 'ready' | 'busy' | 'offline';
  icon: string;
  type: 'claude-code' | 'openclaw';
}

// ============================================================================
// LAYOUT TREE TYPES (tmux-style nested panel layout)
// ============================================================================

/** A leaf node represents a single widget in the layout */
export interface LayoutLeaf {
  type: 'leaf';
  id: string;
  widgetType: WidgetType;
  widgetId: string; // ID of the terminal, 'tasks-widget', or 'agent-status-widget'
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

/** Storage key for layout persistence */
const LAYOUT_STORAGE_KEY = 'workspace-layout-v1';

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

/** Create default layout with terminals on left, tasks on right */
function createDefaultLayout(terminalIds: string[], showAgentStatus: boolean): LayoutNode {
  const terminalLeaves: LayoutLeaf[] = terminalIds.map(id => ({
    type: 'leaf',
    id: generateLayoutId(),
    widgetType: 'terminal' as const,
    widgetId: id,
  }));

  const rightChildren: LayoutNode[] = [];
  const rightSizes: number[] = [];

  if (showAgentStatus) {
    rightChildren.push({
      type: 'leaf',
      id: generateLayoutId(),
      widgetType: 'agent-status',
      widgetId: 'agent-status-widget',
    });
    rightSizes.push(30);
  }

  rightChildren.push({
    type: 'leaf',
    id: generateLayoutId(),
    widgetType: 'tasks',
    widgetId: 'tasks-widget',
  });
  rightSizes.push(showAgentStatus ? 70 : 100);

  const leftPanel: LayoutNode = terminalLeaves.length === 1
    ? terminalLeaves[0]
    : {
        type: 'group',
        id: generateLayoutId(),
        direction: 'vertical',
        children: terminalLeaves,
        sizes: terminalLeaves.map(() => 100 / terminalLeaves.length),
      };

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

/** Create master-stack layout: large left panel + stacked right panels */
function createMasterStackLayout(terminalIds: string[]): LayoutNode {
  if (terminalIds.length === 0) {
    return {
      type: 'leaf',
      id: generateLayoutId(),
      widgetType: 'tasks',
      widgetId: 'tasks-widget',
    };
  }

  const [mainId, ...stackIds] = terminalIds;

  const mainPanel: LayoutLeaf = {
    type: 'leaf',
    id: generateLayoutId(),
    widgetType: 'terminal',
    widgetId: mainId,
  };

  if (stackIds.length === 0) {
    // Just one terminal + tasks
    return {
      type: 'group',
      id: 'root',
      direction: 'horizontal',
      children: [
        mainPanel,
        { type: 'leaf', id: generateLayoutId(), widgetType: 'tasks', widgetId: 'tasks-widget' },
      ],
      sizes: [70, 30],
    };
  }

  const stackPanels: LayoutNode[] = stackIds.map(id => ({
    type: 'leaf',
    id: generateLayoutId(),
    widgetType: 'terminal' as const,
    widgetId: id,
  }));

  // Add tasks at the bottom of the stack
  stackPanels.push({
    type: 'leaf',
    id: generateLayoutId(),
    widgetType: 'tasks',
    widgetId: 'tasks-widget',
  });

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

/** Create even horizontal split layout */
function createEvenHorizontalLayout(terminalIds: string[]): LayoutNode {
  const panels: LayoutNode[] = terminalIds.map(id => ({
    type: 'leaf',
    id: generateLayoutId(),
    widgetType: 'terminal' as const,
    widgetId: id,
  }));

  panels.push({
    type: 'leaf',
    id: generateLayoutId(),
    widgetType: 'tasks',
    widgetId: 'tasks-widget',
  });

  return {
    type: 'group',
    id: 'root',
    direction: 'horizontal',
    children: panels,
    sizes: panels.map(() => 100 / panels.length),
  };
}

/** Create even vertical split layout */
function createEvenVerticalLayout(terminalIds: string[]): LayoutNode {
  const panels: LayoutNode[] = terminalIds.map(id => ({
    type: 'leaf',
    id: generateLayoutId(),
    widgetType: 'terminal' as const,
    widgetId: id,
  }));

  panels.push({
    type: 'leaf',
    id: generateLayoutId(),
    widgetType: 'tasks',
    widgetId: 'tasks-widget',
  });

  return {
    type: 'group',
    id: 'root',
    direction: 'vertical',
    children: panels,
    sizes: panels.map(() => 100 / panels.length),
  };
}

/** Create quad layout (2x2 grid) */
function createQuadLayout(terminalIds: string[]): LayoutNode {
  // Fill in terminals, pad with tasks widget if needed
  const slots = [...terminalIds.slice(0, 4)];

  const createSlot = (idx: number): LayoutLeaf => {
    if (idx < slots.length) {
      return {
        type: 'leaf',
        id: generateLayoutId(),
        widgetType: 'terminal',
        widgetId: slots[idx],
      };
    }
    // Use tasks for the last slot if we don't have 4 terminals
    return {
      type: 'leaf',
      id: generateLayoutId(),
      widgetType: 'tasks',
      widgetId: 'tasks-widget',
    };
  };

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

// Terminal state type (simplified for command palette use)
export interface TerminalInfo {
  id: string;
  agentId: string;
  agentName: string;
}

// Widget types for focus management
export type WidgetType = 'terminal' | 'tasks' | 'agent-status';

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

  // Available agents for terminal creation
  agents: WorkspaceAgent[];

  // Current terminals (for display in command palette)
  terminals: TerminalInfo[];

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

  // Terminal creation callback (set by Workspace.tsx)
  onCreateTerminal: ((agentId: string) => void) | null;

  // Task creation callback (set by Workspace.tsx)
  onCreateTask: ((text: string, agentId: string | null) => void) | null;

  // Terminal action callbacks (set by Workspace.tsx)
  onCloseTerminal: ((terminalId: string) => void) | null;
  onMinimizeTerminal: ((terminalId: string) => void) | null;
  onMaximizeTerminal: ((terminalId: string) => void) | null;
  onRestoreTerminal: ((terminalId: string) => void) | null;
  onClearTerminal: ((terminalId: string) => void) | null;

  // Actions for external callers (command palette)
  setWorkspacePath: (path: string | null) => void;
  setAgents: (agents: WorkspaceAgent[]) => void;
  setTerminals: (terminals: TerminalInfo[]) => void;
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
  closePanelInLayout: (panelId: string) => void;
  swapPanels: (panelId1: string, panelId2: string) => void;
  movePanel: (sourcePanelId: string, targetPanelId: string, position: 'left' | 'right' | 'top' | 'bottom' | 'center') => void;
  updatePanelSizes: (groupId: string, sizes: number[]) => void;
  applyLayoutPreset: (preset: LayoutPreset, terminalIds: string[]) => void;
  saveLayout: () => void;
  restoreLayout: () => LayoutNode | null;

  // Register callbacks (called by Workspace.tsx and App.tsx)
  registerNavigateCallback: (callback: (view: string) => void) => void;
  registerTerminalCallback: (callback: (agentId: string) => void) => void;
  registerTaskCallback: (callback: (text: string, agentId: string | null) => void) => void;
  registerTerminalActionCallbacks: (callbacks: {
    onClose: (terminalId: string) => void;
    onMinimize: (terminalId: string) => void;
    onMaximize: (terminalId: string) => void;
    onRestore: (terminalId: string) => void;
    onClear: (terminalId: string) => void;
  }) => void;

  // Command palette calls these
  createTerminal: (agentId: string) => void;
  createTask: (text: string, agentId: string | null) => void;
  navigateTo: (view: string) => void;

  // Terminal actions (called by command palette)
  closeTerminal: (terminalId: string) => void;
  minimizeTerminal: (terminalId: string) => void;
  maximizeTerminal: (terminalId: string) => void;
  restoreTerminal: (terminalId: string) => void;
  clearTerminal: (terminalId: string) => void;
  closeFocusedTerminal: () => void;
  toggleMaximizeFocusedWidget: () => void;
}

export const useWorkspaceStore = create<WorkspaceState>()((set, get) => ({
  // Initial state
  workspacePath: null,
  agents: [],
  terminals: [],
  planSteps: [],
  focusedWidgetId: null,
  focusedWidgetType: null,
  maximizedWidgetId: null,
  widgets: [],
  showAgentStatus: true, // Show by default
  tasksVisible: true, // Show by default
  layoutTree: null,
  navigateToView: null,
  onCreateTerminal: null,
  onCreateTask: null,
  onCloseTerminal: null,
  onMinimizeTerminal: null,
  onMaximizeTerminal: null,
  onRestoreTerminal: null,
  onClearTerminal: null,

  // Setters (called by Workspace.tsx to sync state)
  setWorkspacePath: (path) => set({ workspacePath: path }),
  setAgents: (agents) => set({ agents }),
  setTerminals: (terminals) => set({ terminals }),
  setPlanSteps: (steps) => set({ planSteps: steps }),

  // Focus management
  setFocusedWidget: (id, type) => set({ focusedWidgetId: id, focusedWidgetType: type }),
  setMaximizedWidget: (id) => set({ maximizedWidgetId: id }),
  setWidgets: (widgets) => set({ widgets }),
  setShowAgentStatus: (show) => set({ showAgentStatus: show }),
  setTasksVisible: (visible) => set({ tasksVisible: visible }),

  // Arrow key navigation
  moveFocus: (direction) => {
    const { widgets, focusedWidgetId } = get();
    if (widgets.length === 0) return;

    // If nothing focused, focus the first widget
    if (!focusedWidgetId) {
      const first = widgets[0];
      if (first) {
        set({ focusedWidgetId: first.id, focusedWidgetType: first.type });
      }
      return;
    }

    const currentIndex = widgets.findIndex(w => w.id === focusedWidgetId);
    if (currentIndex === -1) {
      const first = widgets[0];
      if (first) {
        set({ focusedWidgetId: first.id, focusedWidgetType: first.type });
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
      set({ focusedWidgetId: nextWidget.id, focusedWidgetType: nextWidget.type });
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

    // Create new leaf for the new terminal
    const newLeaf: LayoutLeaf = {
      type: 'leaf',
      id: generateLayoutId(),
      widgetType: 'terminal',
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
    let newTree = replaceNode(layoutTree, targetPanelId, newGroup);

    // Then, remove the source panel from its original location
    newTree = removeNode(newTree, sourcePanelId);

    if (newTree) {
      set({ layoutTree: newTree });
    }
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

  applyLayoutPreset: (preset, terminalIds) => {
    let newTree: LayoutNode;

    switch (preset) {
      case 'master-stack':
        newTree = createMasterStackLayout(terminalIds);
        break;
      case 'even-horizontal':
        newTree = createEvenHorizontalLayout(terminalIds);
        break;
      case 'even-vertical':
        newTree = createEvenVerticalLayout(terminalIds);
        break;
      case 'quad':
        newTree = createQuadLayout(terminalIds);
        break;
      case 'default':
      default:
        newTree = createDefaultLayout(terminalIds, get().showAgentStatus);
        break;
    }

    set({ layoutTree: newTree });
  },

  saveLayout: () => {
    const { layoutTree } = get();
    if (layoutTree) {
      try {
        localStorage.setItem(LAYOUT_STORAGE_KEY, JSON.stringify(layoutTree));
      } catch (e) {
        console.warn('[WorkspaceStore] Failed to save layout:', e);
      }
    }
  },

  restoreLayout: () => {
    try {
      const saved = localStorage.getItem(LAYOUT_STORAGE_KEY);
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
  registerTerminalCallback: (callback) => set({ onCreateTerminal: callback }),
  registerTaskCallback: (callback) => set({ onCreateTask: callback }),
  registerTerminalActionCallbacks: (callbacks) => set({
    onCloseTerminal: callbacks.onClose,
    onMinimizeTerminal: callbacks.onMinimize,
    onMaximizeTerminal: callbacks.onMaximize,
    onRestoreTerminal: callbacks.onRestore,
    onClearTerminal: callbacks.onClear,
  }),

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

  // Terminal actions
  closeTerminal: (terminalId) => {
    const { onCloseTerminal } = get();
    if (onCloseTerminal) {
      onCloseTerminal(terminalId);
    }
  },

  minimizeTerminal: (terminalId) => {
    const { onMinimizeTerminal } = get();
    if (onMinimizeTerminal) {
      onMinimizeTerminal(terminalId);
    }
  },

  maximizeTerminal: (terminalId) => {
    const { onMaximizeTerminal } = get();
    if (onMaximizeTerminal) {
      onMaximizeTerminal(terminalId);
    }
  },

  restoreTerminal: (terminalId) => {
    const { onRestoreTerminal } = get();
    if (onRestoreTerminal) {
      onRestoreTerminal(terminalId);
    }
  },

  clearTerminal: (terminalId) => {
    const { onClearTerminal } = get();
    if (onClearTerminal) {
      onClearTerminal(terminalId);
    }
  },

  closeFocusedTerminal: () => {
    const { focusedWidgetId, focusedWidgetType, onCloseTerminal } = get();
    if (focusedWidgetType === 'terminal' && focusedWidgetId && onCloseTerminal) {
      onCloseTerminal(focusedWidgetId);
    }
  },

  toggleMaximizeFocusedWidget: () => {
    const { focusedWidgetId, maximizedWidgetId, onMaximizeTerminal, onRestoreTerminal } = get();
    if (!focusedWidgetId) return;

    if (maximizedWidgetId === focusedWidgetId) {
      // Already maximized, restore it
      if (onRestoreTerminal) {
        onRestoreTerminal(focusedWidgetId);
      }
      set({ maximizedWidgetId: null });
    } else {
      // Maximize it
      if (onMaximizeTerminal) {
        onMaximizeTerminal(focusedWidgetId);
      }
      set({ maximizedWidgetId: focusedWidgetId });
    }
  },
}));
