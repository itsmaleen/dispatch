/**
 * Agent Console Types
 *
 * Types for agent consoles - isolated agent sessions running in worktrees.
 */

/** Status of an agent console */
export type AgentConsoleStatus =
  | 'initializing' // Worktree being created
  | 'ready' // Ready to receive prompts
  | 'running' // Agent actively working
  | 'paused' // User paused the agent
  | 'completed' // Agent finished successfully
  | 'failed' // Agent encountered error
  | 'merged'; // Branch merged, worktree cleaned up

/** An agent console instance */
export interface AgentConsole {
  /** Unique identifier */
  id: string;

  /** Human-readable title for the task */
  title: string;

  /** The task/prompt this agent is working on */
  task: string;

  /** Current status */
  status: AgentConsoleStatus;

  /** Branch name for this agent's work */
  branch: string;

  /** Base branch (e.g., "main") */
  baseBranch: string;

  /** Path to the worktree directory */
  worktreePath: string;

  /** Thread ID for the session */
  threadId: string;

  /** When this console was created */
  createdAt: Date;

  /** When the agent started working */
  startedAt?: Date;

  /** When the agent finished */
  completedAt?: Date;

  /** Error message if failed */
  error?: string;
}

/** Options for launching an agent console */
export interface LaunchAgentOptions {
  /** The task for the agent to work on */
  task: string;

  /** Short title for the task (auto-generated if not provided) */
  title?: string;

  /** Branch name (auto-generated if not provided) */
  branch?: string;

  /** Base branch to branch from (default: "main") */
  baseBranch?: string;

  /** Start working immediately after creation */
  autoStart?: boolean;
}

/** Result of launching an agent console */
export interface LaunchResult {
  success: boolean;
  console?: AgentConsole;
  error?: string;
}

// ============================================================================
// WEBSOCKET EVENTS
// ============================================================================

/** Agent console created event */
export interface AgentConsoleCreatedEvent {
  type: 'agent-console.created';
  payload: AgentConsole;
  timestamp: string;
}

/** Agent console started event */
export interface AgentConsoleStartedEvent {
  type: 'agent-console.started';
  payload: { consoleId: string };
  timestamp: string;
}

/** Agent console completed event */
export interface AgentConsoleCompletedEvent {
  type: 'agent-console.completed';
  payload: { consoleId: string };
  timestamp: string;
}

/** Agent console failed event */
export interface AgentConsoleFailedEvent {
  type: 'agent-console.failed';
  payload: { consoleId: string; error: string };
  timestamp: string;
}

/** Agent console status changed event */
export interface AgentConsoleStatusChangedEvent {
  type: 'agent-console.status_changed';
  payload: { consoleId: string; status: AgentConsoleStatus };
  timestamp: string;
}

/** Agent console removed event */
export interface AgentConsoleRemovedEvent {
  type: 'agent-console.removed';
  payload: { consoleId: string };
  timestamp: string;
}

/** Parsed console line from session file */
export interface ParsedConsoleLine {
  lineId: string;
  blockId: string;
  blockIndex: number;
  type: 'user' | 'output' | 'thinking' | 'tool_call' | 'tool_result';
  content: string;
  timestamp: string;
  isStreaming: boolean;
  toolName?: string;
  itemId?: string;
  toolInput?: unknown;
  toolResult?: unknown;
}

/** Console session snapshot (T3 Code approach) */
export interface ConsoleSessionSnapshot {
  consoleId: string;
  threadId: string;
  path: string;
  lines: ParsedConsoleLine[];  // Structured parsed lines from .jsonl
  status: 'idle' | 'running' | 'error';
  sessionId?: string;  // SDK session ID
  createdAt: string;
}

/** Console session resumed event with full history */
export interface ConsoleSessionResumedEvent {
  type: 'console.session_resumed';
  payload: {
    snapshot: ConsoleSessionSnapshot;
  };
  timestamp: string;
}

/** All agent console events */
export type AgentConsoleEvent =
  | AgentConsoleCreatedEvent
  | AgentConsoleStartedEvent
  | AgentConsoleCompletedEvent
  | AgentConsoleFailedEvent
  | AgentConsoleStatusChangedEvent
  | AgentConsoleRemovedEvent
  | ConsoleSessionResumedEvent;

// ============================================================================
// CONSOLE LINE PERSISTENCE
// ============================================================================

/** Console line type */
export type ConsoleLineType =
  | 'prompt'
  | 'thinking'
  | 'tool_call'
  | 'tool_result'
  | 'output'
  | 'error'
  | 'info'
  | 'command'
  | 'system';

/** Persisted console line */
export interface PersistedConsoleLine {
  id: number;                    // DB auto-increment ID
  lineId: string;                // UUID from UI
  consoleId: string;             // Console/thread identifier
  sequence: number;              // Order within console
  type: ConsoleLineType;
  content: string;
  timestamp: string;             // ISO date string
  isStreaming: boolean;

  // Optional fields
  blockIndex?: number;
  blockId?: string;
  toolName?: string;
  itemId?: string;
  toolInput?: unknown;           // Parsed from JSON
  toolResult?: unknown;          // Parsed from JSON

  createdAt: string;             // When persisted
}

/** Options for querying console lines */
export interface GetConsoleLinesOptions {
  consoleId: string;
  limit?: number;                // Default: 1000
  beforeSequence?: number;       // Cursor-based pagination
  afterSequence?: number;        // For loading newer lines
}

/** Result of console lines query */
export interface ConsoleLinesResult {
  lines: PersistedConsoleLine[];
  hasMore: boolean;              // More lines available
  oldestSequence: number;        // For pagination
  newestSequence: number;
}

/** Search result for console lines */
export interface ConsoleLineSearchResult {
  line: PersistedConsoleLine;
  rank: number;                  // FTS5 relevance score
  snippet: string;               // Highlighted snippet
}

/** Options for searching console lines */
export interface SearchConsoleLinesOptions {
  query: string;                 // FTS5 search query
  consoleId?: string;            // Filter by console (optional)
  type?: ConsoleLineType;        // Filter by type (optional)
  limit?: number;                // Default: 50
}
