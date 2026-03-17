# Task Widget Redesign: Three-Tier Architecture

## Problem Statement

The current task extraction system copies every prompt verbatim into the tasks widget, creating noise and making it hard to understand what's actually in progress, planned, or completed. The widget lacks:

1. **Summarization** - Full messages shown instead of concise goals
2. **Source distinction** - No separation between running prompts vs extracted work items
3. **Hierarchical organization** - Flat list with no grouping by goal/project
4. **Session awareness** - No visibility into what's currently executing

## Design Decisions

Based on discussion, we're implementing:

1. **Auto-grouping by terminal session** - Same terminal = same context
2. **Ungrouped tasks go to "Inbox" goal** - Default bucket for one-offs
3. **Completed prompts move to "Recent" section** - Brief visibility before archival
4. **Goal creation via**:
   - `/plan` command → automatic Goal
   - User manually creates empty Goal and drags tasks in
   - AI suggests Goal groupings based on semantic similarity

---

## Architecture Overview

### Three-Tier Model

```
┌─────────────────────────────────────────────────────────────────┐
│                        TASKS WIDGET                              │
├─────────────────────────────────────────────────────────────────┤
│  [Active]  [Work Items]  [Goals]                    ← Tabs      │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  ┌─ TIER 1: Active Sessions ──────────────────────────────────┐ │
│  │ Real-time view of prompts currently executing              │ │
│  │ Source: WebSocket session events                           │ │
│  │ Lifecycle: Appears on prompt send → disappears on complete │ │
│  └────────────────────────────────────────────────────────────┘ │
│                                                                  │
│  ┌─ TIER 2: Work Items ───────────────────────────────────────┐ │
│  │ Extracted actionable tasks from agent outputs              │ │
│  │ Source: Task extraction (Haiku)                            │ │
│  │ Statuses: In Progress, Planned, Suggested                  │ │
│  └────────────────────────────────────────────────────────────┘ │
│                                                                  │
│  ┌─ TIER 3: Goals ────────────────────────────────────────────┐ │
│  │ Organizing containers for work items                       │ │
│  │ Source: /plan, manual creation, AI suggestion              │ │
│  │ Contains: Child work items with progress tracking          │ │
│  └────────────────────────────────────────────────────────────┘ │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

---

## Data Model Changes

### 1. New Types (packages/contracts/src/task.ts)

```typescript
// ============================================================================
// SOURCE TRACKING
// ============================================================================

/**
 * Discriminated union for task source
 * Enables filtering: prompts in Active, extractions in Work Items
 */
export type TaskSource =
  | {
      type: 'prompt';
      sessionId: string;      // Terminal session
      promptText: string;     // Original user prompt
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
// GOALS
// ============================================================================

export type GoalStatus = 'active' | 'completed' | 'archived';

export interface Goal {
  id: string;

  /** Human-readable title */
  title: string;

  /** Optional longer description */
  description?: string;

  /** How this goal was created */
  createdVia: 'plan' | 'manual' | 'ai-suggestion';

  /** Terminal session that spawned this goal (for auto-grouping) */
  sessionId?: string;

  /** Child work item IDs */
  taskIds: string[];

  /** Progress tracking */
  completedCount: number;
  totalCount: number;

  status: GoalStatus;

  createdAt: Date;
  updatedAt: Date;
  completedAt?: Date;
}

// ============================================================================
// ACTIVE SESSIONS (Tier 1)
// ============================================================================

export interface ActiveSession {
  id: string;                    // Session/terminal ID
  agentId: string;
  agentName: string;

  /** Summarized goal of current prompt */
  summary: string;

  /** Original prompt (for tooltip/expansion) */
  promptText: string;

  /** When prompt was sent */
  startedAt: Date;

  /** Current status */
  status: 'running' | 'completed' | 'failed';

  /** Elapsed time (computed client-side) */
  elapsedMs?: number;
}

// ============================================================================
// EXTRACTED TASK (Updated)
// ============================================================================

export interface ExtractedTask {
  id: string;

  /** Concise 3-8 word goal statement (NEW) */
  summary: string;

  /** Full extracted text for context */
  fullText: string;

  /** Task source for filtering */
  source: TaskSource;

  /** Extraction status */
  status: 'doing' | 'pending' | 'completed' | 'suggested' | 'dismissed';

  /** Extraction confidence (0-1) */
  confidence: number;

  /** Parent goal (optional) */
  goalId?: string;

  /** Thread association */
  threadId?: string;
  turnId?: string;

  createdAt: Date;
  updatedAt: Date;
  completedAt?: Date;
}
```

### 2. Updated Extraction Schema (packages/server/src/extractor.ts)

```typescript
const EXTRACTION_SCHEMA = {
  type: 'object' as const,
  properties: {
    tasks: {
      type: 'array' as const,
      items: {
        type: 'object' as const,
        properties: {
          summary: {
            type: 'string' as const,
            description: 'Concise 3-8 word goal in imperative voice',
          },
          fullText: {
            type: 'string' as const,
            description: 'Complete extracted context',
          },
          status: {
            type: 'string' as const,
            enum: ['doing', 'planned', 'completed', 'suggested'] as const,
          },
          confidence: { type: 'number' as const },
        },
        required: ['summary', 'fullText', 'status', 'confidence'] as const,
        additionalProperties: false,
      },
    },
  },
  required: ['tasks'] as const,
  additionalProperties: false,
};
```

### 3. Updated System Prompt (packages/server/src/extractor.ts)

Add to EXTRACTOR_SYSTEM_PROMPT:

```
For each task, provide:
- summary: A concise 3-8 word goal statement in imperative voice (e.g., "Add rate limiting to API", "Fix auth middleware bug", "Update user schema")
- fullText: The complete extracted context for reference

The summary should:
- Start with an action verb (Add, Fix, Update, Implement, Create, Remove, etc.)
- Be specific enough to understand the task without fullText
- Never exceed 60 characters
- Never include meta-language like "Task:", "TODO:", etc.
```

### 4. Database Schema Updates (packages/server/src/persistence/task-store.ts)

```sql
-- Add summary column
ALTER TABLE tasks ADD COLUMN summary TEXT;

-- Add source tracking columns
ALTER TABLE tasks ADD COLUMN source_type TEXT CHECK (source_type IN ('prompt', 'extraction', 'plan', 'manual'));
ALTER TABLE tasks ADD COLUMN source_data TEXT; -- JSON blob

-- Add goal association
ALTER TABLE tasks ADD COLUMN goal_id TEXT REFERENCES goals(id);

-- New goals table
CREATE TABLE IF NOT EXISTS goals (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  description TEXT,
  created_via TEXT NOT NULL CHECK (created_via IN ('plan', 'manual', 'ai-suggestion')),
  session_id TEXT,
  status TEXT NOT NULL CHECK (status IN ('active', 'completed', 'archived')) DEFAULT 'active',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  completed_at TEXT
);

-- Index for fast goal lookups
CREATE INDEX idx_goals_status ON goals(status);
CREATE INDEX idx_goals_session ON goals(session_id);
CREATE INDEX idx_tasks_goal ON tasks(goal_id);
```

---

## UI Component Changes

### 1. TasksWidget Redesign (packages/ui/src/components/workspace/TasksWidget.tsx)

Create as separate component (extracted from Workspace.tsx):

```typescript
interface TasksWidgetProps {
  // Tab state
  activeTab: 'active' | 'work-items' | 'goals';
  onTabChange: (tab: 'active' | 'work-items' | 'goals') => void;

  // Tier 1: Active Sessions
  activeSessions: ActiveSession[];

  // Tier 2: Work Items
  workItems: ExtractedTask[];
  recentlyCompleted: ExtractedTask[];  // Last 5, shown briefly

  // Tier 3: Goals
  goals: Goal[];
  inboxGoal: Goal;  // Special "Inbox" goal for ungrouped tasks

  // Actions
  onDismissTask: (taskId: string) => void;
  onCompleteTask: (taskId: string) => void;
  onMoveToGoal: (taskId: string, goalId: string) => void;
  onCreateGoal: (title: string) => void;
  onArchiveGoal: (goalId: string) => void;
  onSuggestGoalGroupings: () => void;  // Trigger AI suggestion

  // Execution
  onSendToTerminal: (taskId: string, terminalId?: string) => void;
}
```

### 2. Tab Layout

```
┌─────────────────────────────────────────────────────────────┐
│  ● Active (2)    ○ Work Items (5)    ○ Goals (3)           │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  Content for selected tab...                                │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

### 3. Active Sessions Tab (Tier 1)

```
┌─ Active Sessions ───────────────────────────────────────────┐
│                                                             │
│  🟢 claude-code (terminal-1)                    2m 34s     │
│     "Implementing auth middleware"                          │
│     ━━━━━━━━━━━━━━━━░░░░░░ (streaming...)                  │
│                                                             │
│  🟢 claude-code (terminal-2)                       45s     │
│     "Running test suite"                                    │
│     ━━━━━━━━░░░░░░░░░░░░░░ (streaming...)                  │
│                                                             │
│  ─── Recently Completed ───                                 │
│  ✓ "Fixed login redirect bug"              terminal-1  3m │
│  ✓ "Updated dependencies"                  terminal-2  1m │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

### 4. Work Items Tab (Tier 2)

```
┌─ Work Items ────────────────────────────────────────────────┐
│                                                             │
│  ◉ In Progress (2)                                         │
│  ├─ Add rate limiting to API endpoints          [•••]      │
│  └─ Update user schema with new fields          [•••]      │
│                                                             │
│  ○ Planned (3)                                              │
│  ├─ Write integration tests for auth            [•••]      │
│  ├─ Migrate existing users to new schema        [•••]      │
│  └─ Update API documentation                    [•••]      │
│                                                             │
│  💡 Suggested (1)                                           │
│  └─ Consider adding caching layer               [•••]      │
│                                                             │
│  [•••] menu: Run in terminal, Move to Goal, Dismiss        │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

### 5. Goals Tab (Tier 3)

```
┌─ Goals ─────────────────────────────────────────────────────┐
│                                                   [+ New]   │
│                                                             │
│  ▼ 📋 Auth System Refactor                    4/7 ━━━━░░  │
│    ├─ ✓ Set up JWT middleware                              │
│    ├─ ✓ Create login endpoint                              │
│    ├─ ✓ Create register endpoint                           │
│    ├─ ✓ Add password hashing                               │
│    ├─ ○ Write integration tests                            │
│    ├─ ○ Add refresh token support                          │
│    └─ ○ Update API documentation                           │
│                                                             │
│  ▶ 📋 Database Migration                      0/3 ░░░░░░  │
│                                                             │
│  ▼ 📥 Inbox                                         2 items│
│    ├─ ○ Review PR #123                                     │
│    └─ ○ Update README                                      │
│                                                             │
│  ─────────────────────────────────────────────────────────  │
│  [🤖 Suggest Groupings]  ← AI analyzes and suggests goals  │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

---

## Server-Side Changes

### 1. New API Endpoints

```typescript
// Goals CRUD
POST   /goals                    // Create goal
GET    /goals                    // List goals (with task counts)
GET    /goals/:id                // Get goal with tasks
PATCH  /goals/:id                // Update goal
DELETE /goals/:id                // Archive goal

// Task-Goal association
POST   /tasks/:id/move-to-goal   // Move task to goal
POST   /tasks/:id/remove-from-goal

// AI Suggestions
POST   /goals/suggest            // Get AI-suggested groupings

// Active Sessions
GET    /sessions/active          // Currently running prompts
```

### 2. Session Tracking (packages/server/src/adapters/session-manager.ts)

Add event emissions for prompt lifecycle:

```typescript
// When user sends prompt
this.emit('session.prompt.started', {
  sessionId,
  agentId,
  agentName,
  promptText,
  summary: await this.summarizePrompt(promptText),  // Quick Haiku call
  startedAt: new Date(),
});

// When turn completes
this.emit('session.prompt.completed', {
  sessionId,
  durationMs,
  status: 'completed' | 'failed',
});
```

### 3. Prompt Summarization

Add a fast summarization function for incoming prompts:

```typescript
async summarizePrompt(prompt: string): Promise<string> {
  // Use Haiku with minimal tokens for speed
  const result = await this.sdk.query({
    prompt: `Summarize this user request in 3-8 words, imperative voice:\n\n${prompt.slice(0, 500)}`,
    options: {
      model: 'haiku',
      maxTurns: 1,
      effort: 'low',
    },
  });
  return result.slice(0, 60);
}
```

### 4. Auto-Grouping Logic

When extracting tasks from a session, check for existing Goal with same sessionId:

```typescript
async function assignTaskToGoal(task: ExtractedTask, sessionId: string): Promise<void> {
  // 1. Check if session already has a goal
  const existingGoal = await goalStore.findBySessionId(sessionId);

  if (existingGoal) {
    await goalStore.addTask(existingGoal.id, task.id);
    return;
  }

  // 2. Otherwise, add to Inbox
  const inbox = await goalStore.getOrCreateInbox();
  await goalStore.addTask(inbox.id, task.id);
}
```

### 5. AI Goal Suggestion

```typescript
async function suggestGoalGroupings(taskIds: string[]): Promise<SuggestedGrouping[]> {
  const tasks = await taskStore.getMany(taskIds);

  const result = await sdk.query({
    prompt: `Given these tasks, suggest logical groupings into goals:

${tasks.map(t => `- ${t.summary}: ${t.fullText}`).join('\n')}

Return JSON: { "suggestions": [{ "goalTitle": "...", "taskIds": ["..."] }] }`,
    options: {
      model: 'haiku',
      outputFormat: { type: 'json_schema', schema: GROUPING_SCHEMA },
    },
  });

  return result.suggestions;
}
```

---

## WebSocket Events

### New Events

```typescript
// Active session events (Tier 1)
'session.prompt.started'   // Prompt begins executing
'session.prompt.completed' // Prompt finishes

// Task events (Tier 2)
'task.created'             // New task extracted
'task.updated'             // Status change
'task.moved'               // Moved to different goal

// Goal events (Tier 3)
'goal.created'             // New goal created
'goal.updated'             // Goal modified
'goal.completed'           // All tasks done
'goal.suggestions.ready'   // AI suggestions available
```

---

## Implementation Phases

### Phase 1: Data Model & Summarization (Backend)
- [ ] Add `summary` field to extraction schema
- [ ] Update EXTRACTOR_SYSTEM_PROMPT for summarization
- [ ] Add `source` discriminator to task model
- [ ] Create Goals table and store
- [ ] Migrate existing tasks (set summary = first 60 chars of text)

### Phase 2: Session Tracking (Backend)
- [ ] Add prompt lifecycle events to SessionManager
- [ ] Implement `summarizePrompt()` for active sessions
- [ ] Create `/sessions/active` endpoint
- [ ] Add WebSocket events for session state

### Phase 3: Goals System (Backend)
- [ ] Goals CRUD endpoints
- [ ] Task-Goal association endpoints
- [ ] Auto-grouping by session
- [ ] Inbox goal creation

### Phase 4: Widget Redesign (Frontend)
- [ ] Extract TasksWidget to separate component
- [ ] Implement tab navigation
- [ ] Active Sessions tab with real-time updates
- [ ] Work Items tab with status grouping
- [ ] Goals tab with expand/collapse

### Phase 5: AI Suggestions (Backend + Frontend)
- [ ] `/goals/suggest` endpoint
- [ ] UI for reviewing and applying suggestions
- [ ] Drag-drop for manual task-to-goal assignment

### Phase 6: Polish
- [ ] "Recently Completed" section with auto-dismiss
- [ ] Progress bars for goals
- [ ] Keyboard navigation
- [ ] Empty states and loading states

---

## Migration Path

1. **Database migration**: Add new columns with defaults
2. **Backfill summaries**: Run extraction on existing task texts
3. **Create Inbox goal**: Move all ungrouped tasks to Inbox
4. **UI feature flag**: Roll out new widget behind flag
5. **Remove flag**: Once stable, remove old widget code

---

## Final Design Decisions

| Question | Decision |
|----------|----------|
| **Default tab** | Active (see what's running) |
| **Summary generation** | Lazy on display (faster extraction, loading state OK) |
| **Recently Completed duration** | Until manually dismissed |
| **Goal visualization** | Tree view (expand/collapse like file explorer) |
| **Goal completion behavior** | Mark as completed, keep visible. User archives manually. |
| **Cross-terminal goals** | Yes, via manual assignment or AI suggestion |
| **Task deduplication** | Task can only belong to one goal. First assignment wins. |
