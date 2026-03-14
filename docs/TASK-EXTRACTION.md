# Task Extraction System

Semantic task extraction from agent outputs to create a reliable "source of truth" for what agents are working on.

## Problem

The original heuristic-based extraction matched ANY numbered/bulleted list, causing false positives:
- Explanatory lists extracted as tasks
- Code examples extracted as tasks
- Options/alternatives extracted as tasks

## Solution

Use an LLM (Haiku) as a semantic classifier to understand intent and extract only actionable tasks.

---

## Architecture

```
┌─────────────────┐     ┌──────────────────┐     ┌─────────────┐     ┌─────┐
│  Agent Output   │ ──▶ │  TaskClassifier  │ ──▶ │  TaskStore  │ ──▶ │ API │
│  (turn ends)    │     │  (Haiku LLM)     │     │  (SQLite)   │     │     │
└─────────────────┘     └──────────────────┘     └─────────────┘     └─────┘
                               │
                         Returns JSON:
                         {
                           doing: Task[],
                           planned: Task[],
                           completed: Task[],
                           suggested: Task[]
                         }
```

## Task Categories

| Category | Description | Example | Initial Status |
|----------|-------------|---------|----------------|
| `doing` | Agent is actively working on NOW | "Reading config files..." | `doing` |
| `planned` | Agent will do next (committed) | "I'll then update the API" | `pending` |
| `completed` | Agent just finished | "Created src/utils.ts" | `completed` |
| `suggested` | Recommendations (not committed) | "You might want to add tests" | `suggested` |

## Task Lifecycle

```
                    ┌─────────────┐
                    │   pending   │ (from 'planned')
                    └──────┬──────┘
                           │ agent starts working
                           ▼
┌─────────────┐      ┌─────────────┐
│  suggested  │      │    doing    │ (from 'doing')
└──────┬──────┘      └──────┬──────┘
       │                    │ turn ends (auto)
       │ user dismisses     ▼
       ▼              ┌─────────────┐
┌─────────────┐      │  completed  │
│  dismissed  │      └─────────────┘
└─────────────┘
```

---

## Implementation Status

### ✅ Phase 1: Task Classifier (COMPLETE)

**Files:**
- `packages/server/src/services/task-classifier.ts`
- `packages/server/src/persistence/task-store.ts`

**Features:**
- Haiku-based semantic classification
- Confidence scores (0-1)
- Deduplication via text hash
- Auto-complete "doing" tasks when turn ends

### ⬜ Phase 2: Tasks Panel UI

**Location:** `packages/ui/src/components/workspace/TasksPanel.tsx`

**Design:**
```
┌─ Tasks ─────────────────────────────────────┐
│ 🔄 ACTIVE (2)                               │
│   ┌─────────────────────────────────────┐   │
│   │ 📖 Reading config files             │   │
│   │    Claude Code · 0:32               │   │
│   └─────────────────────────────────────┘   │
│   ┌─────────────────────────────────────┐   │
│   │ 🔍 Researching API docs             │   │
│   │    Scout · 1:15                     │   │
│   └─────────────────────────────────────┘   │
│                                             │
│ 📋 PENDING (3)                              │
│   • Update package.json                     │
│   • Add error handling                      │
│   • Refactor utils module                   │
│                                             │
│ 💡 SUGGESTED (2)                            │
│   • Consider adding tests          [✓] [✗]  │
│   • Could optimize the query       [✓] [✗]  │
│                                             │
│ ✅ COMPLETED (today: 5)            [expand] │
└─────────────────────────────────────────────┘
```

**Implementation:**
```typescript
// packages/ui/src/components/workspace/TasksPanel.tsx

interface TasksPanelProps {
  onTaskClick?: (task: Task) => void;
  onAcceptSuggestion?: (taskId: string) => void;
  onDismissSuggestion?: (taskId: string) => void;
}

function TasksPanel({ ... }: TasksPanelProps) {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [counts, setCounts] = useState({ doing: 0, pending: 0, suggested: 0, completed: 0 });

  // Fetch tasks
  useEffect(() => {
    fetch('/extracted-tasks').then(r => r.json()).then(d => setTasks(d.tasks));
    fetch('/extracted-tasks/counts').then(r => r.json()).then(d => setCounts(d.counts));
  }, []);

  // Listen for real-time updates via WebSocket
  useEffect(() => {
    const ws = new WebSocket('ws://localhost:3333/events');
    ws.onmessage = (e) => {
      const data = JSON.parse(e.data);
      if (data.event?.type === 'tasks.updated') {
        setTasks(data.event.payload);
      }
    };
    return () => ws.close();
  }, []);

  return (
    <div className="tasks-panel">
      <ActiveTasksSection tasks={tasks.filter(t => t.status === 'doing')} />
      <PendingTasksSection tasks={tasks.filter(t => t.status === 'pending')} />
      <SuggestedTasksSection 
        tasks={tasks.filter(t => t.status === 'suggested')}
        onAccept={onAcceptSuggestion}
        onDismiss={onDismissSuggestion}
      />
      <CompletedTasksSection count={counts.completed} />
    </div>
  );
}
```

**WebSocket Events:**
```typescript
// Server emits when tasks change
this.emit('tasks.updated', taskStore.listTasks({ limit: 20 }));

// Client receives
{
  type: 'event',
  event: {
    type: 'tasks.updated',
    payload: Task[]
  }
}
```

### ⬜ Phase 3: Task Actions

**Features:**
- Click pending task → start it (mark as doing)
- Accept suggestion → convert to pending
- Dismiss suggestion → mark as dismissed
- Manual task creation
- Link task to terminal (send to agent)

**API Endpoints (already implemented):**
```bash
# Start a task
POST /extracted-tasks/:id/start

# Complete a task
POST /extracted-tasks/:id/complete

# Dismiss suggestion
POST /extracted-tasks/:id/dismiss

# Update status
PATCH /extracted-tasks/:id
{ "status": "doing" | "pending" | "completed" | "suggested" | "dismissed" }
```

### ⬜ Phase 4: Dedup & Semantic Matching

**Problem:** Same task might be extracted with slightly different wording.

**Solution:**
1. Simple hash dedup (already implemented)
2. Semantic similarity via embeddings (future)

**Current dedup logic:**
```typescript
// task-store.ts
private hashText(text: string): string {
  // Normalize: lowercase, collapse whitespace, first 100 chars
  const normalized = text.toLowerCase().replace(/\s+/g, ' ').trim().slice(0, 100);
  // Simple hash
  let hash = 0;
  for (let i = 0; i < normalized.length; i++) {
    hash = ((hash << 5) - hash) + normalized.charCodeAt(i);
    hash = hash & hash;
  }
  return hash.toString(36);
}
```

**Future enhancement:**
```typescript
// Use embeddings for semantic similarity
const similarity = cosineSimilarity(
  embed(newTask.text),
  embed(existingTask.text)
);
if (similarity > 0.85) {
  // Merge or skip
}
```

---

## API Reference

### List Tasks
```
GET /extracted-tasks?status=doing&agent=claude-code&limit=50
```

### Get Counts
```
GET /extracted-tasks/counts
→ { doing: 2, pending: 5, suggested: 3, completed: 12, dismissed: 1 }
```

### Get by Status
```
GET /extracted-tasks/active    → doing tasks
GET /extracted-tasks/pending   → pending tasks
GET /extracted-tasks/suggested → suggested tasks
GET /extracted-tasks/completed → recently completed
```

### Update Task
```
PATCH /extracted-tasks/:id
{ "status": "doing" }
```

### Actions
```
POST /extracted-tasks/:id/start    → mark as doing
POST /extracted-tasks/:id/complete → mark as completed
POST /extracted-tasks/:id/dismiss  → mark as dismissed
```

---

## Database Schema

**Location:** `~/.acc/tasks.db`

```sql
CREATE TABLE tasks (
  id TEXT PRIMARY KEY,
  text TEXT NOT NULL,
  status TEXT CHECK (status IN ('doing', 'pending', 'completed', 'suggested', 'dismissed')),
  category TEXT CHECK (category IN ('doing', 'planned', 'suggested', 'completed')),
  confidence REAL DEFAULT 0.5,
  
  thread_id TEXT,
  turn_id TEXT,
  agent_id TEXT,
  agent_name TEXT,
  
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now')),
  completed_at TEXT,
  
  text_hash TEXT  -- for deduplication
);
```

---

## Classifier Prompt

The classifier uses this prompt to extract tasks:

```
You are a task extraction system. Analyze the agent output and extract ONLY actionable tasks.

EXTRACT these categories:
- "doing": Tasks the agent is ACTIVELY working on NOW
- "planned": Tasks the agent WILL do next (committed, not optional)
- "completed": Tasks the agent just FINISHED in this message
- "suggested": Tasks the agent RECOMMENDS but isn't doing

DO NOT extract:
- Explanations or descriptions
- Lists of options or alternatives
- Code content or file contents
- General information or context
- Questions

Respond with JSON:
{
  "doing": [{"text": "...", "confidence": 0.9}],
  "planned": [...],
  "completed": [...],
  "suggested": [...]
}
```

---

## Testing

```bash
# Start server
cd packages/server && bun run dev

# Test classification manually
curl -X POST http://localhost:3333/threads/test-thread/session \
  -H "Content-Type: application/json" \
  -d '{"cwd": "/tmp"}'

curl -X POST http://localhost:3333/threads/test-thread/send \
  -H "Content-Type: application/json" \
  -d '{"message": "Create a simple hello world function"}'

# Check extracted tasks
curl http://localhost:3333/extracted-tasks
curl http://localhost:3333/extracted-tasks/counts
```

---

## Future Enhancements

1. **Embeddings for dedup** - Semantic similarity instead of hash
2. **Task dependencies** - "After X, do Y"
3. **Priority inference** - Urgent vs normal
4. **Time estimates** - How long will task take
5. **Task grouping** - Group related tasks
6. **Cross-agent coordination** - Hand off tasks between agents
