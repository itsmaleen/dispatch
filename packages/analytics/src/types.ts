/**
 * Analytics service types for Merry telemetry.
 *
 * Based on T3Code's anonymous telemetry approach:
 * - No PII collection
 * - Hashed installation IDs
 * - Opt-out support
 */

export interface AnalyticsConfig {
  /** PostHog project API key */
  posthogKey: string;
  /** PostHog host (default: https://us.i.posthog.com) */
  posthogHost?: string;
  /** Enable/disable telemetry (default: true) */
  enabled?: boolean;
  /** App version for tracking */
  appVersion: string;
  /** Client type identifier */
  clientType: 'desktop' | 'cli';
  /** Flush batch size (default: 20) */
  flushBatchSize?: number;
  /** Max buffered events before dropping (default: 1000) */
  maxBufferedEvents?: number;
}

export interface AnalyticsService {
  /**
   * Record an analytics event.
   * Best-effort - does not throw on failure.
   */
  record(event: string, properties?: Record<string, unknown>): void;
  
  /**
   * Flush all buffered events to PostHog.
   * Call before app shutdown.
   */
  flush(): Promise<void>;
  
  /**
   * Shutdown the analytics service.
   * Flushes remaining events and closes connections.
   */
  shutdown(): Promise<void>;
  
  /**
   * Check if telemetry is enabled.
   */
  isEnabled(): boolean;
  
  /**
   * Enable or disable telemetry at runtime.
   */
  setEnabled(enabled: boolean): void;
}

/**
 * Standard event names for Merry telemetry.
 * Following T3Code's naming convention: category.action.detail
 */
export const MerryEvents = {
  // App lifecycle
  APP_LAUNCHED: 'app.launched',
  APP_SHUTDOWN: 'app.shutdown',
  
  // Session events
  SESSION_CREATED: 'session.created',
  SESSION_CONNECTED: 'session.connected',
  SESSION_DISCONNECTED: 'session.disconnected',
  SESSION_ERROR: 'session.error',
  
  // Agent interactions
  AGENT_TURN_SENT: 'agent.turn.sent',
  AGENT_TURN_COMPLETED: 'agent.turn.completed',
  AGENT_TURN_INTERRUPTED: 'agent.turn.interrupted',
  
  // Task events
  TASK_EXTRACTED: 'task.extracted',
  TASK_CREATED: 'task.created',
  TASK_STARTED: 'task.started',
  TASK_COMPLETED: 'task.completed',
  
  // Terminal events
  TERMINAL_COMMAND_SENT: 'terminal.command.sent',
  TERMINAL_CREATED: 'terminal.created',
  
  // UI events
  VIEW_CHANGED: 'view.changed',
  COMMAND_PALETTE_OPENED: 'command_palette.opened',
  COMMAND_EXECUTED: 'command.executed',
  
  // Errors
  ERROR_OCCURRED: 'error.occurred',
} as const;

export type MerryEventName = typeof MerryEvents[keyof typeof MerryEvents];

// Legacy alias for backwards compatibility
export const DispatchEvents = MerryEvents;
export type DispatchEventName = MerryEventName;
