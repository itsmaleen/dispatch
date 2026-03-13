/**
 * Event Types - Real-time events from adapters
 * 
 * Inspired by T3 Code's ProviderRuntimeEvent system
 */

// ============ Session Events ============

export interface SessionStartedEvent {
  type: 'session.started';
  adapterId: string;
  threadId: string;
  timestamp: Date;
}

export interface SessionStateChangedEvent {
  type: 'session.state.changed';
  adapterId: string;
  threadId: string;
  state: 'starting' | 'ready' | 'running' | 'waiting' | 'stopped' | 'error';
  reason?: string;
  timestamp: Date;
}

export interface SessionEndedEvent {
  type: 'session.ended';
  adapterId: string;
  threadId: string;
  reason?: string;
  timestamp: Date;
}

// ============ Turn Events ============

export interface TurnStartedEvent {
  type: 'turn.started';
  adapterId: string;
  threadId: string;
  turnId: string;
  model?: string;
  timestamp: Date;
}

export interface TurnCompletedEvent {
  type: 'turn.completed';
  adapterId: string;
  threadId: string;
  turnId: string;
  status: 'completed' | 'failed' | 'interrupted' | 'cancelled';
  durationMs: number;
  usage?: {
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
    costUsd?: number;
  };
  errorMessage?: string;
  timestamp: Date;
}

// ============ Content Events ============

export type ContentStreamKind = 
  | 'assistant_text'
  | 'reasoning_text'
  | 'plan_text'
  | 'command_output'
  | 'file_change_output';

export interface ContentDeltaEvent {
  type: 'content.delta';
  adapterId: string;
  threadId: string;
  turnId: string;
  streamKind: ContentStreamKind;
  delta: string;
  timestamp: Date;
}

// ============ Tool/Item Events ============

export type ItemType = 
  | 'user_message'
  | 'assistant_message'
  | 'reasoning'
  | 'plan'
  | 'command_execution'
  | 'file_change'
  | 'mcp_tool_call'
  | 'web_search'
  | 'error';

export type ItemStatus = 'inProgress' | 'completed' | 'failed' | 'declined';

export interface ItemStartedEvent {
  type: 'item.started';
  adapterId: string;
  threadId: string;
  turnId: string;
  itemId: string;
  itemType: ItemType;
  title?: string;
  timestamp: Date;
}

export interface ItemUpdatedEvent {
  type: 'item.updated';
  adapterId: string;
  threadId: string;
  turnId: string;
  itemId: string;
  itemType: ItemType;
  status?: ItemStatus;
  detail?: string;
  timestamp: Date;
}

export interface ItemCompletedEvent {
  type: 'item.completed';
  adapterId: string;
  threadId: string;
  turnId: string;
  itemId: string;
  itemType: ItemType;
  status: ItemStatus;
  detail?: string;
  data?: unknown;
  timestamp: Date;
}

// ============ File Events ============

export interface FileChangeEvent {
  type: 'file.changed';
  adapterId: string;
  threadId: string;
  turnId: string;
  path: string;
  kind: 'created' | 'modified' | 'deleted';
  additions?: number;
  deletions?: number;
  timestamp: Date;
}

export interface FileDiffEvent {
  type: 'file.diff';
  adapterId: string;
  threadId: string;
  turnId: string;
  path: string;
  unifiedDiff: string;
  timestamp: Date;
}

// ============ Approval Events ============

export type ApprovalRequestType = 
  | 'command_execution'
  | 'file_read'
  | 'file_change'
  | 'tool_call';

export interface ApprovalRequestedEvent {
  type: 'approval.requested';
  adapterId: string;
  threadId: string;
  turnId: string;
  requestId: string;
  requestType: ApprovalRequestType;
  detail?: string;
  args?: unknown;
  timestamp: Date;
}

export interface ApprovalResolvedEvent {
  type: 'approval.resolved';
  adapterId: string;
  threadId: string;
  turnId: string;
  requestId: string;
  decision: 'accept' | 'acceptForSession' | 'decline' | 'cancel';
  timestamp: Date;
}

// ============ Plan Events ============

export interface PlanStep {
  step: string;
  status: 'pending' | 'inProgress' | 'completed';
}

export interface PlanUpdatedEvent {
  type: 'plan.updated';
  adapterId: string;
  threadId: string;
  turnId: string;
  explanation?: string;
  plan: PlanStep[];
  timestamp: Date;
}

// ============ Error Events ============

export interface ErrorEvent {
  type: 'error';
  adapterId: string;
  threadId?: string;
  turnId?: string;
  message: string;
  errorClass?: 'provider_error' | 'transport_error' | 'permission_error' | 'validation_error' | 'unknown';
  detail?: unknown;
  timestamp: Date;
}

// ============ Activity Events ============

export type ActivityType = 
  | 'thinking'
  | 'file_read'
  | 'file_write'
  | 'command'
  | 'tool'
  | 'info'
  | 'error';

export interface ActivityEvent {
  type: 'activity';
  adapterId?: string;
  threadId: string;
  turnId: string;
  payload: {
    activityType: ActivityType;
    label: string;
    detail?: string;
    status?: 'running' | 'completed' | 'failed';
  };
  timestamp?: Date;
}

// ============ Union Type ============

export type RuntimeEvent = 
  | SessionStartedEvent
  | SessionStateChangedEvent
  | SessionEndedEvent
  | TurnStartedEvent
  | TurnCompletedEvent
  | ContentDeltaEvent
  | ItemStartedEvent
  | ItemUpdatedEvent
  | ItemCompletedEvent
  | FileChangeEvent
  | FileDiffEvent
  | ApprovalRequestedEvent
  | ApprovalResolvedEvent
  | PlanUpdatedEvent
  | ErrorEvent
  | ActivityEvent;
