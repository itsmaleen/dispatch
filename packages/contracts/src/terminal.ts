/**
 * Terminal Contracts
 *
 * Types and interfaces for the real PTY-based terminal system.
 * This is for actual shell terminals (bash, zsh, etc.), NOT the agent console.
 */

// ============================================================================
// TERMINAL INSTANCE
// ============================================================================

/** A terminal instance represents a running PTY session */
export interface TerminalInstance {
  /** Unique identifier for this terminal */
  id: string;

  /** Human-readable name for display */
  name: string;

  /** OS process ID of the shell */
  pid: number;

  /** Current working directory */
  cwd: string;

  /** Shell executable path (e.g., /bin/bash, /bin/zsh) */
  shell: string;

  /** Environment variables */
  env: Record<string, string>;

  /** Terminal dimensions */
  cols: number;
  rows: number;

  /** When this terminal was created */
  createdAt: Date;

  /** Who created this terminal */
  createdBy: 'user' | 'agent';

  /** If created by an agent, the agent's ID */
  agentId?: string;

  /** Associated agent console session ID (for context) */
  sessionId?: string;

  /** Terminal status */
  status: 'running' | 'exited';

  /** Exit code if status is 'exited' */
  exitCode?: number;

  /** Exit signal if killed by signal */
  exitSignal?: string;

  /** User-defined labels for organization */
  labels?: Record<string, string>;
}

/** Options for creating a new terminal */
export interface CreateTerminalOptions {
  /** Human-readable name (auto-generated if not provided) */
  name?: string;

  /** Working directory (defaults to workspace path or home) */
  cwd?: string;

  /** Shell to use (defaults to user's default shell) */
  shell?: string;

  /** Additional environment variables */
  env?: Record<string, string>;

  /** Initial dimensions */
  cols?: number;
  rows?: number;

  /** Who is creating this terminal */
  createdBy?: 'user' | 'agent';

  /** Agent ID if created by an agent */
  agentId?: string;

  /** Associated session ID */
  sessionId?: string;

  /** Initial command to run after shell starts */
  initialCommand?: string;

  /** Labels for organization */
  labels?: Record<string, string>;
}

// ============================================================================
// TERMINAL EVENTS (WebSocket)
// ============================================================================

/** Events sent from client to server */
export type TerminalClientMessage =
  | { type: 'terminal:create'; options: CreateTerminalOptions }
  | { type: 'terminal:attach'; terminalId: string }
  | { type: 'terminal:detach'; terminalId: string }
  | { type: 'terminal:input'; terminalId: string; data: string }
  | { type: 'terminal:resize'; terminalId: string; cols: number; rows: number }
  | { type: 'terminal:close'; terminalId: string };

/** Events sent from server to client */
export type TerminalServerMessage =
  | { type: 'terminal:created'; terminal: TerminalInstance }
  | { type: 'terminal:attached'; terminalId: string }
  | { type: 'terminal:detached'; terminalId: string }
  | { type: 'terminal:output'; terminalId: string; data: string }
  | { type: 'terminal:exit'; terminalId: string; code: number; signal?: string }
  | { type: 'terminal:closed'; terminalId: string }
  | { type: 'terminal:error'; terminalId: string; error: string }
  | { type: 'terminal:list'; terminals: TerminalInstance[] };

// ============================================================================
// TERMINAL API (REST)
// ============================================================================

/** Response from GET /api/terminals */
export interface ListTerminalsResponse {
  terminals: TerminalInstance[];
}

/** Response from POST /api/terminals */
export interface CreateTerminalResponse {
  terminal: TerminalInstance;
}

/** Response from GET /api/terminals/:id */
export interface GetTerminalResponse {
  terminal: TerminalInstance;
}

/** Response from GET /api/terminals/:id/output */
export interface GetTerminalOutputResponse {
  /** Recent terminal output (last N lines) */
  output: string;
  /** Number of lines returned */
  lineCount: number;
}

/** Request body for POST /api/terminals/:id/write */
export interface WriteTerminalRequest {
  /** Data to write to the terminal */
  data: string;
}

/** Request body for POST /api/terminals/:id/resize */
export interface ResizeTerminalRequest {
  cols: number;
  rows: number;
}

// ============================================================================
// AGENT TERMINAL TOOL
// ============================================================================

/** Input schema for the terminal tool used by agents */
export interface TerminalToolInput {
  /** Action to perform */
  action: 'create' | 'write' | 'read' | 'close' | 'list' | 'wait';

  /** Terminal ID (for write, read, close, wait actions) */
  terminalId?: string;

  /** Terminal name (alternative to ID for easier reference) */
  terminalName?: string;

  // Create action options
  /** Name for the new terminal */
  name?: string;
  /** Working directory */
  cwd?: string;
  /** Initial command to run */
  command?: string;

  // Write action options
  /** Input to send to the terminal */
  input?: string;

  // Read action options
  /** Number of recent lines to read (default: 50) */
  lines?: number;

  // Wait action options
  /** Pattern to wait for in output (regex) */
  waitFor?: string;
  /** Timeout in milliseconds (default: 30000) */
  timeout?: number;

  /** Keep terminal running in background (for create action) */
  isBackground?: boolean;
}

/** Output from the terminal tool */
export interface TerminalToolOutput {
  success: boolean;

  /** Terminal ID (for create action) */
  terminalId?: string;

  /** Terminal name */
  terminalName?: string;

  /** Output content (for read action) */
  output?: string;

  /** List of terminals (for list action) */
  terminals?: Array<{
    id: string;
    name: string;
    status: 'running' | 'exited';
    cwd: string;
  }>;

  /** Error message if success is false */
  error?: string;

  /** Whether the wait pattern was matched (for wait action) */
  matched?: boolean;
}

// ============================================================================
// TERMINAL OUTPUT BUFFER
// ============================================================================

/** Configuration for terminal output buffering */
export interface TerminalBufferConfig {
  /** Maximum number of lines to keep in buffer */
  maxLines: number;

  /** Maximum buffer size in bytes */
  maxBytes: number;
}

/** Default buffer configuration */
export const DEFAULT_TERMINAL_BUFFER_CONFIG: TerminalBufferConfig = {
  maxLines: 10000,
  maxBytes: 5 * 1024 * 1024, // 5MB
};
