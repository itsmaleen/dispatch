/**
 * Adapter Interface - Unified control for AI coding agents
 * 
 * Adapters connect to different agent runtimes:
 * - Claude Code (PTY-based)
 * - OpenClaw (WebSocket)
 * - Codex (PTY-based, T3 Code pattern)
 */

export type AdapterKind = 'claude-code' | 'openclaw' | 'codex';

export type AdapterStatus = 
  | 'disconnected'
  | 'connecting'
  | 'ready'
  | 'running'
  | 'error';

export interface AdapterCapabilities {
  /** Can stream real-time output */
  streaming: boolean;
  /** Can pause/interrupt mid-execution */
  interruptible: boolean;
  /** Can run multiple concurrent tasks */
  concurrent: boolean;
  /** Maximum concurrent tasks (if concurrent) */
  maxConcurrency?: number;
  /** Supports file change notifications */
  fileWatch: boolean;
  /** Supports approval requests */
  approvals: boolean;
}

export interface AdapterConfig {
  /** Unique adapter instance ID */
  id: string;
  /** Adapter type */
  kind: AdapterKind;
  /** Display name */
  name: string;
  /** Working directory for this adapter */
  cwd?: string;
  /** Model to use (if configurable) */
  model?: string;
  /** Additional adapter-specific config */
  options?: Record<string, unknown>;
}

export interface AdapterState {
  /** Current status */
  status: AdapterStatus;
  /** Active thread/session ID */
  activeThreadId?: string;
  /** Active turn ID */
  activeTurnId?: string;
  /** Last error message */
  lastError?: string;
  /** Token usage for current session */
  tokenUsage?: {
    input: number;
    output: number;
    total: number;
  };
  /** Cost in USD for current session */
  costUsd?: number;
  /** Timestamp of last activity */
  lastActivityAt?: Date;
}

export interface SendOptions {
  /** Message content */
  message: string;
  /** Attachments (images, files) */
  attachments?: Array<{
    type: 'image' | 'file';
    name: string;
    content: string; // base64 or path
  }>;
  /** Model override */
  model?: string;
  /** Interaction mode */
  mode?: 'default' | 'plan';
  /** Context to inject */
  context?: string;
  /** Adapter-specific task options (e.g. Claude Code: effort, thinking, maxTurns) */
  taskOptions?: Record<string, unknown>;
}

export interface AdapterEvent {
  type: string;
  adapterId: string;
  threadId?: string;
  turnId?: string;
  timestamp: Date;
  payload?: unknown;
  // Common event fields (optional, depends on event type)
  status?: string;
  reason?: string;
  durationMs?: number;
}

/**
 * Core adapter interface that all adapters must implement
 */
export interface Adapter {
  /** Adapter configuration */
  readonly config: AdapterConfig;
  
  /** Adapter capabilities */
  readonly capabilities: AdapterCapabilities;
  
  /** Current state */
  readonly state: AdapterState;
  
  /**
   * Connect to the agent runtime
   */
  connect(): Promise<void>;
  
  /**
   * Disconnect from the agent runtime
   */
  disconnect(): Promise<void>;
  
  /**
   * Send a message/task to the agent
   */
  send(options: SendOptions): Promise<{ turnId: string }>;
  
  /**
   * Interrupt the current task
   */
  interrupt(): Promise<void>;
  
  /**
   * Subscribe to adapter events
   */
  on(event: string, handler: (event: AdapterEvent) => void): () => void;
  
  /**
   * Get event stream (for real-time UI updates)
   */
  getEventStream(): AsyncIterable<AdapterEvent>;
}

/**
 * Factory function type for creating adapters
 */
export type AdapterFactory = (config: AdapterConfig) => Adapter;
