/**
 * Widget Types - TMux-style widget system for execution view
 */

export type WidgetKind =
  | 'log'           // Real-time stdout/stderr
  | 'diff'          // File changes as they happen
  | 'terminal'      // Raw PTY access (actual shell terminal)
  | 'agent-console' // Agent execution output viewer (renamed from old 'terminal' widget)
  | 'chat'          // Direct agent conversation
  | 'status'        // Agent state indicator
  | 'cost'          // Token usage / cost meter
  | 'screenshot'    // Point-in-time captures
  | 'video'         // Live recording/playback
  | 'plan';         // Planning steps progress

export type WidgetSize = 'small' | 'medium' | 'large' | 'full';

export interface WidgetPosition {
  /** Row in the grid (0-indexed) */
  row: number;
  /** Column in the grid (0-indexed) */
  col: number;
  /** Row span */
  rowSpan?: number;
  /** Column span */
  colSpan?: number;
}

export interface WidgetConfig {
  /** Unique widget instance ID */
  id: string;
  
  /** Widget type */
  kind: WidgetKind;
  
  /** Display title */
  title?: string;
  
  /** Which adapter this widget is connected to */
  adapterId?: string;
  
  /** Which thread to show (if applicable) */
  threadId?: string;
  
  /** Position in grid */
  position: WidgetPosition;
  
  /** Size preference */
  size: WidgetSize;
  
  /** Is widget minimized? */
  minimized: boolean;
  
  /** Widget-specific settings */
  settings?: Record<string, unknown>;
}

// ============ Widget-specific data types ============

export interface LogWidgetData {
  lines: Array<{
    id: string;
    timestamp: Date;
    level: 'stdout' | 'stderr' | 'info' | 'warn' | 'error';
    content: string;
  }>;
  maxLines: number;
  autoScroll: boolean;
}

export interface DiffWidgetData {
  files: Array<{
    path: string;
    kind: 'created' | 'modified' | 'deleted';
    additions: number;
    deletions: number;
    hunks: Array<{
      oldStart: number;
      oldLines: number;
      newStart: number;
      newLines: number;
      content: string;
    }>;
  }>;
  totalAdditions: number;
  totalDeletions: number;
}

export interface TerminalWidgetData {
  /** PTY session ID */
  sessionId: string;
  /** Current terminal content (for render) */
  content: string;
  /** Cursor position */
  cursor: { row: number; col: number };
  /** Terminal dimensions */
  dimensions: { rows: number; cols: number };
}

export interface AgentConsoleWidgetData {
  /** Agent session ID */
  sessionId: string;
  /** Agent ID this console is connected to */
  agentId: string;
  /** Console lines (thinking, tool calls, output, etc.) */
  lines: Array<{
    id: string;
    type: 'prompt' | 'thinking' | 'tool_call' | 'tool_result' | 'output' | 'error' | 'info' | 'command' | 'system';
    content: string;
    timestamp?: string;
    isStreaming?: boolean;
  }>;
  /** Is the agent currently streaming output */
  isStreaming: boolean;
}

export interface ChatWidgetData {
  messages: Array<{
    id: string;
    role: 'user' | 'assistant' | 'system';
    content: string;
    timestamp: Date;
    streaming?: boolean;
  }>;
  inputEnabled: boolean;
}

export interface StatusWidgetData {
  adapterId: string;
  adapterName: string;
  status: 'disconnected' | 'connecting' | 'ready' | 'running' | 'error';
  currentTask?: {
    taskId: string;
    title: string;
    progress?: number;
  };
  lastActivity?: Date;
  errorMessage?: string;
}

export interface CostWidgetData {
  session: {
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
    costUsd: number;
    startedAt: Date;
  };
  current: {
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
    costUsd: number;
  };
  ratePerMinute?: number;
}

export interface ScreenshotWidgetData {
  screenshots: Array<{
    id: string;
    url: string;
    timestamp: Date;
    caption?: string;
  }>;
}

export interface VideoWidgetData {
  streamUrl?: string;
  recordingUrl?: string;
  isLive: boolean;
  duration?: number;
  currentTime?: number;
}

export interface PlanWidgetData {
  taskId: string;
  taskTitle: string;
  steps: Array<{
    index: number;
    description: string;
    status: 'pending' | 'inProgress' | 'completed' | 'failed';
    adapterId?: string;
    durationMs?: number;
  }>;
  currentStep?: number;
  explanation?: string;
}

// ============ Widget data union ============

export type WidgetData =
  | { kind: 'log'; data: LogWidgetData }
  | { kind: 'diff'; data: DiffWidgetData }
  | { kind: 'terminal'; data: TerminalWidgetData }
  | { kind: 'agent-console'; data: AgentConsoleWidgetData }
  | { kind: 'chat'; data: ChatWidgetData }
  | { kind: 'status'; data: StatusWidgetData }
  | { kind: 'cost'; data: CostWidgetData }
  | { kind: 'screenshot'; data: ScreenshotWidgetData }
  | { kind: 'video'; data: VideoWidgetData }
  | { kind: 'plan'; data: PlanWidgetData };

// ============ Layout types ============

export interface WidgetLayout {
  /** Layout ID */
  id: string;
  
  /** Layout name */
  name: string;
  
  /** Grid configuration */
  grid: {
    rows: number;
    cols: number;
  };
  
  /** Widget configurations */
  widgets: WidgetConfig[];
  
  /** Is this the active layout? */
  active: boolean;
  
  /** Project this layout is for (optional) */
  projectId?: string;
}

/**
 * Default layout presets
 */
export const DEFAULT_LAYOUTS: Record<string, Omit<WidgetLayout, 'id'>> = {
  'single-agent': {
    name: 'Single Agent',
    grid: { rows: 2, cols: 2 },
    widgets: [
      { id: 'chat-1', kind: 'chat', position: { row: 0, col: 0, colSpan: 2 }, size: 'large', minimized: false },
      { id: 'log-1', kind: 'log', position: { row: 1, col: 0 }, size: 'medium', minimized: false },
      { id: 'status-1', kind: 'status', position: { row: 1, col: 1 }, size: 'small', minimized: false },
    ],
    active: false,
  },
  'dual-agent': {
    name: 'Dual Agent',
    grid: { rows: 2, cols: 2 },
    widgets: [
      { id: 'log-1', kind: 'log', position: { row: 0, col: 0 }, size: 'medium', minimized: false },
      { id: 'log-2', kind: 'log', position: { row: 0, col: 1 }, size: 'medium', minimized: false },
      { id: 'diff-1', kind: 'diff', position: { row: 1, col: 0, colSpan: 2 }, size: 'large', minimized: false },
    ],
    active: false,
  },
  'full-view': {
    name: 'Full View',
    grid: { rows: 3, cols: 3 },
    widgets: [
      { id: 'plan-1', kind: 'plan', position: { row: 0, col: 0 }, size: 'medium', minimized: false },
      { id: 'chat-1', kind: 'chat', position: { row: 0, col: 1, colSpan: 2 }, size: 'large', minimized: false },
      { id: 'log-1', kind: 'log', position: { row: 1, col: 0 }, size: 'medium', minimized: false },
      { id: 'diff-1', kind: 'diff', position: { row: 1, col: 1 }, size: 'medium', minimized: false },
      { id: 'cost-1', kind: 'cost', position: { row: 1, col: 2 }, size: 'small', minimized: false },
      { id: 'agent-console-1', kind: 'agent-console', position: { row: 2, col: 0, colSpan: 3 }, size: 'large', minimized: false },
    ],
    active: false,
  },
};
