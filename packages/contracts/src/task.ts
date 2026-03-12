/**
 * Task Types - Unified task representation across adapters
 */

export type TaskStatus = 
  | 'draft'        // Not yet submitted
  | 'planning'     // In planning mode, awaiting confirmation
  | 'queued'       // Waiting for agent
  | 'running'      // Agent is working
  | 'paused'       // Manually paused
  | 'completed'    // Successfully finished
  | 'failed'       // Failed with error
  | 'cancelled';   // Manually cancelled

export type TaskPriority = 'low' | 'normal' | 'high' | 'urgent';

export interface TaskAssignment {
  adapterId: string;
  adapterKind: string;
  instruction: string;
  /** Specific subtask of the parent task */
  subtaskIndex?: number;
}

export interface TaskPlan {
  /** Original user instruction */
  instruction: string;
  /** Breakdown of the task */
  steps: Array<{
    index: number;
    description: string;
    assignment: TaskAssignment;
    dependencies?: number[]; // indices of steps that must complete first
  }>;
  /** Was this plan confirmed by user? */
  confirmed: boolean;
  /** Timestamp of confirmation */
  confirmedAt?: Date;
}

export interface TaskResult {
  /** Summary of what was accomplished */
  summary: string;
  /** Detailed response from agent */
  response?: string;
  /** Files created/modified */
  artifacts?: Array<{
    type: 'file' | 'url' | 'screenshot';
    path: string;
    description?: string;
  }>;
  /** Metrics */
  metrics: {
    durationMs: number;
    tokensUsed: number;
    toolCalls: number;
    costUsd?: number;
  };
}

export interface TaskError {
  message: string;
  code?: string;
  retryable: boolean;
  detail?: unknown;
}

export interface Task {
  /** Unique task ID */
  id: string;
  
  /** Human-readable title */
  title: string;
  
  /** Full instruction/description */
  instruction: string;
  
  /** Current status */
  status: TaskStatus;
  
  /** Priority level */
  priority: TaskPriority;
  
  /** Task breakdown and assignments */
  plan?: TaskPlan;
  
  /** Active thread ID (once running) */
  threadId?: string;
  
  /** Active turn ID (once running) */
  turnId?: string;
  
  /** Assigned adapter(s) */
  assignments?: TaskAssignment[];
  
  /** Result (if completed) */
  result?: TaskResult;
  
  /** Error (if failed) */
  error?: TaskError;
  
  /** Parent task ID (if subtask) */
  parentTaskId?: string;
  
  /** Subtask IDs */
  subtaskIds?: string[];
  
  /** Project this task belongs to */
  projectId?: string;
  
  /** Tags for organization */
  tags?: string[];
  
  /** Context to inject into agent prompt */
  context?: string;
  
  /** Memory context IDs to include */
  memoryIds?: string[];
  
  /** Timestamps */
  createdAt: Date;
  startedAt?: Date;
  completedAt?: Date;
  
  /** User who created the task */
  createdBy?: string;
}

/**
 * Create a new task in draft state
 */
export function createTask(params: {
  title: string;
  instruction: string;
  priority?: TaskPriority;
  projectId?: string;
  tags?: string[];
  context?: string;
}): Task {
  return {
    id: crypto.randomUUID(),
    title: params.title,
    instruction: params.instruction,
    status: 'draft',
    priority: params.priority ?? 'normal',
    projectId: params.projectId,
    tags: params.tags,
    context: params.context,
    createdAt: new Date(),
  };
}
