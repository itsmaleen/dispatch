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

// ============================================================================
// SOURCE TRACKING (for distinguishing prompts vs extractions vs plans)
// ============================================================================

/**
 * Discriminated union for task source
 * Enables filtering: prompts in Active tab, extractions in Work Items tab
 */
export type TaskSource =
  | {
      type: 'prompt';
      sessionId: string;      // Terminal session
      promptText: string;     // Original user prompt (for tooltip)
      startedAt: Date;
    }
  | {
      type: 'extraction';
      turnId: string;
      agentId: string;
      agentName?: string;
    }
  | {
      type: 'plan';
      goalId: string;
      stepIndex: number;
    }
  | {
      type: 'manual';
      createdBy?: string;
    };

// ============================================================================
// GOALS (organizing containers for work items)
// ============================================================================

export type GoalStatus = 'active' | 'completed' | 'archived';
export type GoalCreatedVia = 'plan' | 'manual' | 'ai-suggestion' | 'auto';

// ============================================================================
// CONSOLE THREAD (conversation context within a console)
// ============================================================================

export type ThreadStatus = 'active' | 'completed' | 'abandoned';

export interface ConsoleThread {
  /** Unique thread ID */
  id: string;

  /** AI-generated name (3-8 words, imperative voice) */
  name: string;

  /** Physical console/terminal pane ID this thread belongs to */
  consoleId: string;

  /** Auto-created goal for this thread */
  goalId?: string;

  /** Workspace path */
  projectPath: string;

  /** Worktree path (if in a git worktree) */
  worktreePath?: string;

  /** Thread status */
  status: ThreadStatus;

  /** Previous names if thread evolved */
  previousNames?: string[];

  /** Semantic signature for topic drift detection */
  topicSignature?: string;

  /** Number of sessions/prompts in this thread */
  sessionCount: number;

  createdAt: Date;
  updatedAt: Date;
}

export interface Goal {
  id: string;

  /** Human-readable title */
  title: string;

  /** Optional longer description */
  description?: string;

  /** How this goal was created */
  createdVia: GoalCreatedVia;

  /** Terminal session that spawned this goal (for auto-grouping) */
  sessionId?: string;

  /** Associated thread ID (for auto-created goals) */
  threadId?: string;

  /** Workspace path this goal belongs to */
  projectPath?: string;

  /** Child work item IDs */
  taskIds: string[];

  /** Progress tracking (computed from taskIds) */
  completedCount: number;
  totalCount: number;

  status: GoalStatus;

  createdAt: Date;
  updatedAt: Date;
  completedAt?: Date;
}

// ============================================================================
// ACTIVE SESSIONS (Tier 1 - currently running prompts)
// ============================================================================

export interface ActiveSession {
  /** Session/terminal ID */
  id: string;

  agentId: string;
  agentName: string;

  /** Summarized goal of current prompt (3-8 words) */
  summary: string;

  /** Original prompt text (for tooltip/expansion) */
  promptText: string;

  /** Workspace path this session belongs to */
  projectPath?: string;

  /** When prompt was sent */
  startedAt: Date;

  /** Current status */
  status: 'running' | 'completed' | 'failed';

  /** Duration in ms (computed on completion) */
  durationMs?: number;
}

// ============================================================================
// EXTRACTED TASK (Tier 2 - work items from agent output)
// ============================================================================

export type ExtractedTaskStatus = 'doing' | 'pending' | 'completed' | 'suggested' | 'dismissed';
export type ExtractedTaskCategory = 'doing' | 'planned' | 'suggested' | 'completed';

export interface ExtractedTask {
  id: string;

  /** Concise 3-8 word goal statement in imperative voice */
  summary: string;

  /** Full extracted text for context (shown on hover/expand) */
  fullText: string;

  /** Task source for filtering by tier */
  source: TaskSource;

  /** Extraction status */
  status: ExtractedTaskStatus;

  /** Original category from extraction */
  category: ExtractedTaskCategory;

  /** Extraction confidence (0-1) */
  confidence: number;

  /** Parent goal ID (if assigned to a goal) */
  goalId?: string;

  /** Console this task should be executed in */
  consoleId?: string;

  /** Workspace path this task belongs to */
  projectPath?: string;

  /** Thread association */
  threadId?: string;
  turnId?: string;
  agentId?: string;
  agentName?: string;

  createdAt: Date;
  updatedAt: Date;
  completedAt?: Date;
}

// ============================================================================
// RECENTLY COMPLETED (for "Recent" section in Active tab)
// ============================================================================

export interface RecentlyCompletedSession extends ActiveSession {
  /** When it was completed */
  completedAt: Date;

  /** Whether user has dismissed it */
  dismissed: boolean;
}

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
