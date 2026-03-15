# Orchestration Engine Migration Plan

> Adopting T3 Code's event-sourcing patterns for Dispatch (ACC)

## Executive Summary

T3 Code implements a **server-authoritative event-sourcing architecture** for managing coding agent sessions. This doc outlines how to adopt these patterns in Dispatch to gain:

- **Durable task history** — Every action persisted, replayable
- **Rollback/undo** — Return to any checkpoint  
- **Multi-agent orchestration** — Clean provider abstraction
- **Rich observability** — Activity feeds, diffs, cost tracking

**Estimated effort:** 2-3 weeks for core patterns

---

## T3 Code Architecture Overview

### Service Graph

```
                              ┌───────────────────────────┐
                              │       WebSocket API       │
                              │       (transport)         │
                              └─────────────┬─────────────┘
                                            │ dispatchCommand
                                            ▼
                              ┌───────────────────────────┐
                              │  OrchestrationCommandRouter│
                              │  (validate, authorize)     │
                              └─────────────┬─────────────┘
                                            │
                                            ▼
                              ┌───────────────────────────┐
                              │ OrchestrationCommandHandlers│
                              │ (command → event mapping)  │
                              └─────────────┬─────────────┘
                                            │
                                            ▼
                              ┌───────────────────────────┐
                              │  OrchestrationEventStore  │
                              │      (SQLite)             │
                              └─────────────┬─────────────┘
                                            │
                                            ▼
                              ┌───────────────────────────┐
                              │ OrchestrationProjectionService │
                              │ (events → read models)    │
                              └─────────────┬─────────────┘
                                            │
          ┌─────────────────────────────────┼─────────────────────────────────┐
          │                                 │                                 │
          ▼                                 ▼                                 ▼
   ┌─────────────┐                 ┌─────────────────┐               ┌───────────────┐
   │  Snapshot   │                 │ ProviderRuntime │               │  Checkpoint   │
   │   Queries   │                 │   Ingestion     │               │   Service     │
   └─────────────┘                 └─────────────────┘               └───────────────┘
```

### Core Concepts

| Concept | Description | Dispatch Equivalent |
|---------|-------------|---------------------|
| **Project** | Workspace config (scripts, default model) | Could map to "Workspace" or "Repo" |
| **Thread** | Conversation within project (supports git branches) | "Task" or "Session" |
| **Turn** | User message → agent response cycle | "Step" or "Interaction" |
| **Session** | Runtime state of active provider | "AgentProcess" |
| **Checkpoint** | Git-backed snapshot after each turn | New — enables rollback |
| **Activity** | Tool calls, approvals, errors | "Event" or "Log Entry" |

---

## Key Patterns to Adopt

### 1. Event Sourcing

**What it is:** Instead of mutating state directly, dispatch *commands* that produce *events*. Events are immutable and persisted. Current state is derived by replaying events.

**T3 Code implementation:**
```typescript
// Command types (what users/system want to do)
type ClientOrchestrationCommand = 
  | { type: 'thread.create'; threadId; projectId; title; model; ... }
  | { type: 'thread.turn.start'; threadId; message; ... }
  | { type: 'thread.turn.interrupt'; threadId; ... }
  | { type: 'thread.approval.respond'; threadId; requestId; decision; ... }
  | { type: 'thread.checkpoint.revert'; threadId; turnCount; ... }
  // ... 15+ command types

// Event types (what happened)
type OrchestrationEvent =
  | { type: 'thread.created'; payload: ThreadCreatedPayload; ... }
  | { type: 'thread.message-sent'; payload: ThreadMessageSentPayload; ... }
  | { type: 'thread.turn-start-requested'; ... }
  | { type: 'thread.activity-appended'; ... }
  | { type: 'thread.turn-diff-completed'; ... }
  // ... 20+ event types
```

**Why it matters for Dispatch:**
- Full audit trail of every task interaction
- Debug any issue by replaying events
- Time-travel debugging
- Easy to add new projections later

### 2. Command/Event Separation

**What it is:** Clear boundary between client commands and internal system commands.

```typescript
// Client can only dispatch these (from UI)
type ClientOrchestrationCommand = 
  | ProjectCreateCommand
  | ThreadCreateCommand
  | ThreadTurnStartCommand
  | ThreadApprovalRespondCommand
  // ...

// Server-only commands (from provider runtime)
type InternalOrchestrationCommand =
  | ThreadSessionSetCommand
  | ThreadMessageAssistantDeltaCommand
  | ThreadActivityAppendCommand
  // ...
```

**Why it matters:** Security + clean architecture. UI can't fake internal events.

### 3. Durable Session Registry

**What it is:** Provider sessions survive server restarts.

```typescript
// Session state persisted in SQLite
interface ProviderSessionRuntime {
  threadId: string;
  sessionId: string;
  status: 'starting' | 'running' | 'stopped' | 'error';
  providerName: string;
  runtimeCursor: string; // For resume
}
```

**Why it matters for Dispatch:**
- Restart server without losing active Claude Code sessions
- Track which agent owns which task
- Clean up dead sessions on startup

### 4. Projection-Based Read Models

**What it is:** Events are persisted, but queries read from denormalized projection tables.

```sql
-- Projection tables (derived from events)
projection_projects (id, title, workspace_root, ...)
projection_threads (id, project_id, title, model, latest_turn_id, ...)
projection_thread_messages (thread_id, message_id, role, text, ...)
projection_thread_activities (thread_id, activity_id, kind, summary, ...)
projection_checkpoints (thread_id, turn_id, checkpoint_ref, files, ...)

-- Projection state tracking
projection_state (projector_name, last_applied_sequence)
```

**Why it matters:**
- Fast queries without replaying all events
- Can rebuild projections from events if schema changes
- Separation of write model (events) and read model (projections)

### 5. Thread-Keyed Checkpoints

**What it is:** Git snapshots tied to thread identity, not ephemeral session ID.

```typescript
interface CheckpointSummary {
  threadId: string;
  turnId: string;
  turnCount: number;
  checkpointRef: string; // Git SHA
  status: 'ready' | 'missing' | 'error';
  files: Array<{ path, kind, additions, deletions }>;
}
```

**Why it matters:**
- Rollback to any turn in a task
- Continue work across sessions
- Diff visualization between any two turns

### 6. Activity Feed

**What it is:** Structured log of tool calls, approvals, errors per turn.

```typescript
interface ThreadActivity {
  id: string;
  tone: 'info' | 'tool' | 'approval' | 'error';
  kind: string; // 'file_read', 'command_run', 'approval_required', etc.
  summary: string;
  payload: unknown;
  turnId: string | null;
  createdAt: string;
}
```

**Why it matters:** This is exactly what Dispatch's Gantt/timeline view needs.

---

## Migration Plan

### Phase 1: Event Store Foundation (Week 1)

**Goal:** Persist all task actions as events.

#### 1.1 Define Event Schema

Create `packages/contracts/src/orchestration.ts`:

```typescript
// Task events (our equivalent of Thread events)
export type TaskEvent =
  | { type: 'task.created'; taskId; title; workspacePath; ... }
  | { type: 'task.step.started'; taskId; stepId; prompt; ... }
  | { type: 'task.step.completed'; taskId; stepId; result; cost; ... }
  | { type: 'task.message.delta'; taskId; stepId; delta; ... }
  | { type: 'task.activity.logged'; taskId; activity; ... }
  | { type: 'task.checkpoint.created'; taskId; stepId; ref; files; ... }
  | { type: 'task.status.changed'; taskId; status; ... }
```

#### 1.2 Create Event Store

```typescript
// packages/server/src/persistence/event-store.ts
interface EventStore {
  append(event: TaskEvent): Promise<{ sequence: number }>;
  replay(fromSequence?: number): AsyncIterable<TaskEvent>;
  getLatestSequence(): Promise<number>;
}

// SQLite schema
CREATE TABLE task_events (
  sequence INTEGER PRIMARY KEY AUTOINCREMENT,
  event_id TEXT UNIQUE NOT NULL,
  event_type TEXT NOT NULL,
  task_id TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  occurred_at TEXT NOT NULL,
  command_id TEXT,
  INDEX idx_task_events_task_id (task_id),
  INDEX idx_task_events_type (event_type)
);
```

#### 1.3 Command Router

```typescript
// packages/server/src/orchestration/command-router.ts
interface CommandRouter {
  dispatch(command: TaskCommand): Promise<{ sequence: number }>;
}

// Validate command, map to event, persist, return sequence
```

### Phase 2: Provider Adapter Abstraction (Week 1-2)

**Goal:** Clean interface for multiple agent providers.

#### 2.1 Provider Adapter Interface

```typescript
// packages/contracts/src/provider.ts
interface ProviderAdapter {
  name: string;
  
  startSession(options: SessionOptions): Promise<ProviderSession>;
  sendTurn(session: ProviderSession, message: string): AsyncIterable<ProviderEvent>;
  interrupt(session: ProviderSession): Promise<void>;
  stopSession(session: ProviderSession): Promise<void>;
}

type ProviderEvent =
  | { type: 'message.delta'; text: string }
  | { type: 'message.complete'; text: string; usage: Usage }
  | { type: 'tool.started'; name: string; input: unknown }
  | { type: 'tool.completed'; name: string; output: unknown }
  | { type: 'approval.required'; requestId: string; kind: string; ... }
  | { type: 'error'; message: string }
```

#### 2.2 Claude Code Adapter (SDK-based)

```typescript
// packages/server/src/providers/claude-code-adapter.ts
class ClaudeCodeAdapter implements ProviderAdapter {
  name = 'claude-code';
  
  async *sendTurn(session, message) {
    const runtime = query({
      prompt: createPromptIterable(message),
      options: { cwd: session.workspacePath, ... }
    });
    
    for await (const sdkEvent of runtime) {
      yield this.mapSdkEvent(sdkEvent);
    }
  }
}
```

#### 2.3 Runtime Ingestion Service

```typescript
// packages/server/src/orchestration/runtime-ingestion.ts
// Subscribes to provider events, translates to orchestration commands
class RuntimeIngestionService {
  ingest(taskId: string, events: AsyncIterable<ProviderEvent>) {
    for await (const event of events) {
      switch (event.type) {
        case 'message.delta':
          await this.router.dispatch({
            type: 'task.message.delta',
            taskId,
            delta: event.text,
          });
          break;
        case 'tool.started':
          await this.router.dispatch({
            type: 'task.activity.logged',
            taskId,
            activity: { kind: 'tool', name: event.name, ... }
          });
          break;
        // ...
      }
    }
  }
}
```

### Phase 3: Projections & Read Models (Week 2)

**Goal:** Fast queries from denormalized tables.

#### 3.1 Projection Tables

```sql
CREATE TABLE projection_tasks (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  workspace_path TEXT NOT NULL,
  status TEXT NOT NULL,
  current_step_id TEXT,
  total_cost_usd REAL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE projection_task_steps (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL,
  step_number INTEGER NOT NULL,
  prompt TEXT,
  result TEXT,
  status TEXT NOT NULL,
  cost_usd REAL,
  started_at TEXT,
  completed_at TEXT,
  FOREIGN KEY (task_id) REFERENCES projection_tasks(id)
);

CREATE TABLE projection_task_activities (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL,
  step_id TEXT,
  kind TEXT NOT NULL,
  summary TEXT NOT NULL,
  payload_json TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY (task_id) REFERENCES projection_tasks(id)
);
```

#### 3.2 Projector Service

```typescript
class ProjectorService {
  async applyEvent(event: TaskEvent) {
    switch (event.type) {
      case 'task.created':
        await this.db.run(`
          INSERT INTO projection_tasks (id, title, workspace_path, status, created_at, updated_at)
          VALUES (?, ?, ?, 'pending', ?, ?)
        `, [event.taskId, event.title, event.workspacePath, event.occurredAt, event.occurredAt]);
        break;
      
      case 'task.step.completed':
        await this.db.run(`
          UPDATE projection_tasks 
          SET total_cost_usd = total_cost_usd + ?, updated_at = ?
          WHERE id = ?
        `, [event.cost, event.occurredAt, event.taskId]);
        
        await this.db.run(`
          UPDATE projection_task_steps
          SET status = 'completed', result = ?, cost_usd = ?, completed_at = ?
          WHERE id = ?
        `, [event.result, event.cost, event.occurredAt, event.stepId]);
        break;
      // ...
    }
    
    // Track projection state
    await this.db.run(`
      UPDATE projection_state SET last_applied_sequence = ? WHERE projector_name = 'main'
    `, [event.sequence]);
  }
}
```

### Phase 4: Checkpoints & Rollback (Week 2-3)

**Goal:** Git-backed snapshots with undo capability.

#### 4.1 Checkpoint Service

```typescript
interface CheckpointService {
  capture(taskId: string, stepId: string): Promise<CheckpointRef>;
  diff(taskId: string, fromStep: number, toStep: number): Promise<FileDiff[]>;
  revert(taskId: string, toStep: number): Promise<void>;
}
```

#### 4.2 Diff Storage

```sql
CREATE TABLE checkpoint_diff_blobs (
  task_id TEXT NOT NULL,
  from_step INTEGER NOT NULL,
  to_step INTEGER NOT NULL,
  diff_text TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (task_id, from_step, to_step)
);
```

### Phase 5: UI Integration (Week 3)

**Goal:** Wire new backend to existing UI components.

#### 5.1 Snapshot API

```typescript
// WebSocket method: orchestration.getSnapshot
interface TaskSnapshot {
  tasks: Task[];
  // Each task includes:
  //   - steps[]
  //   - activities[]
  //   - checkpoints[]
  //   - currentSession (if active)
  snapshotSequence: number;
}
```

#### 5.2 Real-time Updates

```typescript
// Push channel: orchestration.taskEvent
// Client subscribes, receives events after snapshotSequence
// Applies locally to stay in sync
```

---

## File Structure (Target)

```
packages/
├── contracts/
│   └── src/
│       ├── orchestration.ts    # Event/command schemas
│       ├── provider.ts         # Provider adapter contracts
│       └── index.ts
│
├── server/
│   └── src/
│       ├── orchestration/
│       │   ├── command-router.ts
│       │   ├── event-store.ts
│       │   ├── projector.ts
│       │   └── runtime-ingestion.ts
│       │
│       ├── providers/
│       │   ├── adapter.ts           # Base interface
│       │   ├── claude-code-adapter.ts
│       │   └── openclaw-adapter.ts
│       │
│       ├── checkpoints/
│       │   ├── checkpoint-service.ts
│       │   └── diff-store.ts
│       │
│       └── persistence/
│           ├── migrations/
│           │   ├── 001_task_events.ts
│           │   ├── 002_projections.ts
│           │   └── 003_checkpoints.ts
│           └── sqlite-store.ts
│
└── ui/
    └── src/
        ├── hooks/
        │   └── useOrchestration.ts  # Subscribe to snapshot + events
        └── components/
            ├── TaskTimeline.tsx     # Activity feed
            └── CheckpointDiff.tsx   # File diff viewer
```

---

## Risks & Mitigations

| Risk | Mitigation |
|------|------------|
| Breaking existing UI | Keep current API working, add new endpoints incrementally |
| SQLite performance at scale | Index properly; consider WAL mode; projections keep queries simple |
| Event schema evolution | Use versioned event types; write migration projectors |
| Complexity overhead | Start with minimal event types; add as needed |

---

## Success Metrics

1. **All task actions persisted as events** — Can replay full history
2. **Restart server without losing sessions** — Durable registry working
3. **Rollback a task to previous step** — Checkpoint system functional
4. **Activity feed shows tool calls in real-time** — Ingestion + projections wired
5. **Cost tracking per task** — Aggregated from step completion events

---

## References

- T3 Code source: `/Users/m/.openclaw/workspace/t3code-source/`
- T3 Code orchestration contracts: `packages/contracts/src/orchestration.ts`
- T3 Code event-sourcing plan: `.plans/14-server-authoritative-event-sourcing-cleanup.md`
- T3 Code spec cutover: `.plans/spec-1-1-cutover-plan.md`
- Claude Agent SDK: `@anthropic-ai/claude-agent-sdk`
