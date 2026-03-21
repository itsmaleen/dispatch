# Workspace-Scoped Data System Plan

## Problem Statement

When opening a new folder/path, the app does not clean up data from the previous workspace:
- **Terminals persist** across workspace switches (they should be closed or scoped)
- **Layout persists** globally instead of per-workspace
- **No data isolation** between different projects

The system needs workspace-specific data management, similar to how **tasks are already scoped** via `project_path`.

## Goals

1. **Terminals scoped to workspace** - Close/hide terminals when switching projects
2. **Terminal persistence** - Survive page refresh, resume sessions
3. **Per-workspace layouts** - Remember panel arrangements per project
4. **Extensible pattern** - Support future widget types (browser, preview, logs, etc.)
5. **Context layering** - Workspace context vs. App/Orchestrator context

## Current Architecture

### What's Working (Reference Implementation)

The **task system** already implements workspace scoping correctly:

```sql
-- Migration 4 in task-store.ts
ALTER TABLE tasks ADD COLUMN project_path TEXT;
ALTER TABLE goals ADD COLUMN project_path TEXT;
ALTER TABLE active_sessions ADD COLUMN project_path TEXT;
CREATE INDEX idx_tasks_project_path ON tasks(project_path);
```

```typescript
// All query methods accept optional projectPath
listTasks(options: { projectPath?: string }): Task[]
getActiveTasks(projectPath?: string): Task[]
```

### What's Broken

| Component | Current State | Issue |
|-----------|--------------|-------|
| Terminals | React `useState` only | No persistence, no workspace scoping |
| Layout | localStorage (global key) | Same layout for all projects |
| Widget types | Hardcoded `'terminal' \| 'tasks' \| 'agent-status'` | Not extensible |
| Workspace change | No cleanup event | Old terminals remain open |

### Key Files

| File | Role |
|------|------|
| `packages/ui/src/components/workspace/Workspace.tsx` | Terminal state, lifecycle |
| `packages/ui/src/stores/workspace.ts` | Layout tree, widget types |
| `packages/server/src/persistence/task-store.ts` | Reference pattern |
| `packages/server/src/server.ts` | REST endpoints |

---

## Design: Widget Type Expansion

Before implementing workspace-scoped terminals, we need to plan for expanding widget types.

### Current Widget Types

```typescript
// packages/ui/src/stores/workspace.ts
export type WidgetType = 'terminal' | 'tasks' | 'agent-status';
```

### Future Widget Types

| Widget Type | Description | Workspace-Scoped? |
|-------------|-------------|-------------------|
| `terminal` | Agent chat sessions | Yes |
| `tasks` | Task/goal list | Yes (already via tasks table) |
| `agent-status` | Agent health overview | No (global) |
| `browser` | Embedded browser/preview | Yes |
| `logs` | System/agent logs viewer | Configurable |
| `files` | File tree explorer | Yes |
| `diff` | Git diff viewer | Yes |
| `preview` | Live preview (web apps) | Yes |
| `notes` | Scratchpad/markdown | Yes |

### Proposed Widget Registry Pattern

```typescript
// New: packages/ui/src/lib/widgets/registry.ts

export interface WidgetDefinition {
  type: string;
  label: string;
  icon: string;
  workspaceScoped: boolean;
  singleton?: boolean;  // Only one instance allowed (e.g., tasks)
  persistable: boolean; // Can be saved/restored
  component: React.ComponentType<WidgetProps>;
}

export const widgetRegistry = new Map<string, WidgetDefinition>();

// Register built-in widgets
widgetRegistry.set('terminal', {
  type: 'terminal',
  label: 'Terminal',
  icon: 'terminal',
  workspaceScoped: true,
  singleton: false,
  persistable: true,
  component: TerminalWidget,
});

widgetRegistry.set('tasks', {
  type: 'tasks',
  label: 'Tasks',
  icon: 'check-square',
  workspaceScoped: true,
  singleton: true,
  persistable: true,
  component: TasksWidget,
});
```

### Database Schema for Generic Widgets

```sql
-- Future: Generic widget instances table
CREATE TABLE IF NOT EXISTS widget_instances (
  id TEXT PRIMARY KEY,
  widget_type TEXT NOT NULL,
  project_path TEXT,              -- NULL = global widget
  config TEXT,                    -- JSON: widget-specific settings
  state TEXT,                     -- JSON: widget-specific state
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_widget_instances_project_path ON widget_instances(project_path);
CREATE INDEX idx_widget_instances_type ON widget_instances(widget_type);
```

---

## Phase 1: Terminal Persistence & Workspace Scoping

### 1.1 Database Schema

Add to `task-store.ts` migrations (Migration 5):

```sql
CREATE TABLE IF NOT EXISTS terminals (
  id TEXT PRIMARY KEY,
  agent_id TEXT NOT NULL,
  agent_name TEXT NOT NULL,
  agent_type TEXT NOT NULL CHECK (agent_type IN ('claude-code', 'openclaw')),
  project_path TEXT NOT NULL,
  thread_id TEXT,                 -- Claude Code session ID for resumption
  session_active INTEGER DEFAULT 0,
  status TEXT CHECK (status IN ('active', 'closed', 'error')) DEFAULT 'active',
  path_override TEXT,             -- Custom working directory
  settings TEXT,                  -- JSON: TerminalSettings
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  closed_at TEXT
);

CREATE INDEX idx_terminals_project_path ON terminals(project_path);
CREATE INDEX idx_terminals_status ON terminals(status);
CREATE INDEX idx_terminals_thread_id ON terminals(thread_id);
```

### 1.2 TerminalStore Class

New file: `packages/server/src/persistence/terminal-store.ts`

```typescript
export interface Terminal {
  id: string;
  agentId: string;
  agentName: string;
  agentType: 'claude-code' | 'openclaw';
  projectPath: string;
  threadId?: string;
  sessionActive: boolean;
  status: 'active' | 'closed' | 'error';
  pathOverride?: string;
  settings?: TerminalSettings;
  createdAt: string;
  updatedAt: string;
  closedAt?: string;
}

export interface CreateTerminalInput {
  id: string;
  agentId: string;
  agentName: string;
  agentType: 'claude-code' | 'openclaw';
  projectPath: string;
  threadId?: string;
  pathOverride?: string;
  settings?: TerminalSettings;
}

export class TerminalStore {
  constructor(private db: Database) {}

  createTerminal(input: CreateTerminalInput): Terminal { ... }
  getTerminal(id: string): Terminal | null { ... }
  listTerminals(projectPath: string): Terminal[] { ... }
  getActiveTerminals(projectPath: string): Terminal[] { ... }
  updateTerminal(id: string, updates: Partial<Terminal>): void { ... }
  setThreadId(id: string, threadId: string): void { ... }
  setSessionActive(id: string, active: boolean): void { ... }
  closeTerminal(id: string): void { ... }
  closeAllTerminals(projectPath: string): void { ... }
}
```

### 1.3 API Endpoints

Add to `packages/server/src/server.ts`:

```typescript
// List terminals for workspace
app.get('/terminals', async (req, res) => {
  const { projectPath } = req.query;
  const terminals = terminalStore.listTerminals(projectPath as string);
  res.json({ terminals });
});

// Create terminal
app.post('/terminals', async (req, res) => {
  const terminal = terminalStore.createTerminal(req.body);
  broadcastRaw({ type: 'terminal_created', terminal });
  res.json({ terminal });
});

// Update terminal
app.patch('/terminals/:id', async (req, res) => {
  terminalStore.updateTerminal(req.params.id, req.body);
  const terminal = terminalStore.getTerminal(req.params.id);
  broadcastRaw({ type: 'terminal_updated', terminal });
  res.json({ terminal });
});

// Close terminal
app.delete('/terminals/:id', async (req, res) => {
  terminalStore.closeTerminal(req.params.id);
  broadcastRaw({ type: 'terminal_closed', terminalId: req.params.id });
  res.json({ success: true });
});

// Close all terminals for workspace (used on workspace switch)
app.post('/terminals/close-all', async (req, res) => {
  const { projectPath } = req.body;
  terminalStore.closeAllTerminals(projectPath);
  broadcastRaw({ type: 'terminals_closed', projectPath });
  res.json({ success: true });
});
```

### 1.4 Frontend: Workspace Change Detection

Update `Workspace.tsx`:

```typescript
// Track previous workspace path
const previousPathRef = useRef<string | null>(null);

// Handle workspace changes
useEffect(() => {
  const previousPath = previousPathRef.current;

  if (workspacePath && workspacePath !== previousPath) {
    // Cleanup: Close terminals for previous workspace
    if (previousPath) {
      terminals.forEach(terminal => {
        // Close active sessions gracefully
        if (terminal.sessionActive && terminal.threadId) {
          api.closeSession(terminal.threadId).catch(console.error);
        }
      });

      // Mark all terminals as closed in DB
      api.post('/terminals/close-all', { projectPath: previousPath })
        .catch(console.error);

      // Clear local state
      setTerminals([]);
    }

    // Load: Get terminals for new workspace
    api.get(`/terminals?projectPath=${encodeURIComponent(workspacePath)}`)
      .then(res => res.json())
      .then(data => {
        const restoredTerminals = data.terminals
          .filter(t => t.status === 'active')
          .map(restoreTerminalFromDb);
        setTerminals(restoredTerminals);
      })
      .catch(console.error);
  }

  previousPathRef.current = workspacePath;
}, [workspacePath]);
```

### 1.5 Terminal Creation Updates

```typescript
const handleNewTerminal = async (agentId: string) => {
  const agent = agents.find(a => a.id === agentId);
  if (!agent || !workspacePath) return;

  const id = `term-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

  // Persist to database FIRST
  try {
    await api.post('/terminals', {
      id,
      agentId: agent.id,
      agentName: agent.name,
      agentType: agent.type,
      projectPath: workspacePath,
    });
  } catch (err) {
    console.error('Failed to persist terminal:', err);
  }

  // Then add to local state
  const newTerminal: TerminalState = {
    id,
    agent,
    lines: [],
    isStreaming: false,
    settings: { ...DEFAULT_TERMINAL_SETTINGS },
  };

  setTerminals(prev => [...prev, newTerminal]);
};
```

---

## Phase 2: Per-Workspace Layouts

### 2.1 Layout Storage Key

Update `packages/ui/src/stores/workspace.ts`:

```typescript
// Change from:
const LAYOUT_STORAGE_KEY = 'workspace-layout-v1';

// To function:
function getLayoutStorageKey(projectPath: string | null): string {
  if (!projectPath) return 'workspace-layout-default';
  // Hash the path to avoid filesystem characters in key
  const hash = btoa(projectPath).replace(/[+/=]/g, '');
  return `workspace-layout-v1-${hash}`;
}
```

### 2.2 Save/Restore with Workspace Path

```typescript
saveLayout: (projectPath: string | null) => {
  const { layoutTree } = get();
  if (layoutTree) {
    try {
      localStorage.setItem(getLayoutStorageKey(projectPath), JSON.stringify(layoutTree));
    } catch (e) {
      console.warn('[WorkspaceStore] Failed to save layout:', e);
    }
  }
},

restoreLayout: (projectPath: string | null) => {
  try {
    const saved = localStorage.getItem(getLayoutStorageKey(projectPath));
    if (saved) {
      const tree = JSON.parse(saved) as LayoutNode;
      set({ layoutTree: tree });
      return tree;
    }
  } catch (e) {
    console.warn('[WorkspaceStore] Failed to restore layout:', e);
  }
  return null;
},
```

### 2.3 Future: Database Storage

For cross-device sync, layouts should eventually move to the database:

```sql
CREATE TABLE IF NOT EXISTS workspace_layouts (
  project_path TEXT PRIMARY KEY,
  layout_tree TEXT NOT NULL,     -- JSON blob
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
```

---

## Phase 3: Context Layering

### Workspace Context vs. App Context

| Layer | Scope | Examples |
|-------|-------|----------|
| **App/Orchestrator** | Global | Agent registry, server connection, user preferences |
| **Workspace** | Per-project | Terminals, tasks, goals, layout, git state |
| **Widget** | Per-instance | Terminal settings, scroll position, filters |

### Implementation

```typescript
// New: packages/ui/src/context/WorkspaceContext.tsx

interface WorkspaceContextValue {
  projectPath: string;
  terminals: Terminal[];
  tasks: Task[];
  goals: Goal[];
  layout: LayoutNode | null;

  // Actions
  createTerminal: (agentId: string) => Promise<void>;
  closeTerminal: (id: string) => Promise<void>;
  // ... more actions
}

export const WorkspaceContext = createContext<WorkspaceContextValue | null>(null);

export function WorkspaceProvider({ projectPath, children }) {
  // Load workspace-specific data
  const terminals = useWorkspaceTerminals(projectPath);
  const tasks = useWorkspaceTasks(projectPath);
  const goals = useWorkspaceGoals(projectPath);

  // Cleanup on unmount or path change
  useEffect(() => {
    return () => {
      // Save state, close sessions
    };
  }, [projectPath]);

  return (
    <WorkspaceContext.Provider value={{ projectPath, terminals, tasks, goals, ... }}>
      {children}
    </WorkspaceContext.Provider>
  );
}
```

---

## Phase 4: Session Recovery (Deep Dive)

This phase is the core of the session resume feature. Based on research into how Claude Code handles sessions, we have a clear understanding of what's possible and how to implement it.

### 4.1 Claude Code Session Fundamentals

**Key Finding: Sessions Never Expire**

Claude Code sessions are stored as `.jsonl` files in `~/.claude/projects/<encoded-cwd>/` and persist indefinitely. There is no automatic expiration or TTL.

| Storage Location | Purpose |
|------------------|---------|
| `~/.claude/history.jsonl` | Global history index with timestamps, project paths, session IDs |
| `~/.claude/projects/<encoded-cwd>/*.jsonl` | Individual session transcripts |
| `~/.claude/projects/<encoded-cwd>/sessions-index.json` | Metadata and summaries |

**Resumability Conditions:**

| Condition | Resumable? | Notes |
|-----------|------------|-------|
| Same machine, same CWD | ✅ Yes | Perfect case |
| Same machine, different CWD | ⚠️ No | Session files are stored per-CWD |
| Different machine | ⚠️ No | Files are local to original machine |
| Session file deleted | ❌ No | User must manually delete |
| After app restart | ✅ Yes | As long as session file exists |
| After closing console | ✅ Yes | We just need to track the session ID |

### 4.2 SDK Functions for Session Management

```typescript
// From @anthropic-ai/claude-agent-sdk

// Resume options when creating a session
const options: Options = {
  continue: true,           // Resume most recent session in CWD
  resume: 'session-id',     // Resume specific session by ID
  forkSession: true,        // Fork instead of continuing in-place
  persistSession: false,    // (TypeScript only) Don't write to disk
};

// List all sessions for a project
import { listSessions, getSessionMessages } from '@anthropic-ai/claude-agent-sdk';

const sessions = await listSessions({ cwd: '/path/to/project' });

// Get messages from a specific session (for history display)
const messages = await getSessionMessages(sessionId, { cwd: '/path/to/project' });
```

**What Gets Restored on Resume:**
- Full conversation history (prompts and responses)
- Tool results (files read, commands executed, code modified)
- Context from previous work

**What Does NOT Get Restored:**
- Session-scoped permissions (must be re-approved)

### 4.3 Session Lifecycle State Machine

```
                    ┌──────────────────┐
                    │   NOT_STARTED    │
                    │  (no session ID) │
                    └────────┬─────────┘
                             │ User sends first message
                             ▼
                    ┌──────────────────┐
                    │     ACTIVE       │◄──────────────────┐
                    │  (SDK running)   │                   │
                    └────────┬─────────┘                   │
                             │                             │
           ┌─────────────────┼─────────────────┐           │
           │                 │                 │           │
           ▼                 ▼                 ▼           │
    ┌────────────┐   ┌────────────┐   ┌────────────┐       │
    │  SUSPENDED │   │   CLOSED   │   │   ERROR    │       │
    │ (app quit) │   │ (user X'd) │   │(SDK crash) │       │
    └──────┬─────┘   └──────┬─────┘   └──────┬─────┘       │
           │                │                │             │
           │                │                │             │
           └────────────────┴────────────────┘             │
                             │                             │
                             │ Resume with session ID      │
                             └─────────────────────────────┘
```

**Key insight**: `SUSPENDED`, `CLOSED`, and `ERROR` states are ALL resumable as long as:
- We have the `sessionId` stored
- The session file exists on disk (`~/.claude/projects/...`)
- We're on the same machine with same CWD

### 4.4 Updated Database Schema

Replace the original `terminals` table with a more comprehensive `sessions` table:

```sql
CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,                    -- Our internal ID
  session_id TEXT,                        -- Claude Code session ID (from SDK)
  project_path TEXT NOT NULL,             -- Workspace scope
  name TEXT,                              -- User-editable name
  agent_id TEXT NOT NULL,                 -- Which agent type
  agent_name TEXT NOT NULL,               -- Display name
  agent_type TEXT NOT NULL CHECK (agent_type IN ('claude-code', 'openclaw')),

  status TEXT CHECK (status IN (
    'active',      -- Currently displayed and/or SDK running
    'suspended',   -- App closed while session was active
    'closed',      -- User closed console, can resume
    'archived'     -- Hidden from normal view, but resumable
  )) DEFAULT 'active',

  -- For resume and search
  last_prompt TEXT,                       -- Last user message (for search)
  message_count INTEGER DEFAULT 0,        -- Quick stats

  -- Layout reference
  layout_panel_id TEXT,                   -- Which panel it was in (for restore)

  -- Settings
  path_override TEXT,                     -- Custom working directory
  settings TEXT,                          -- JSON: ConsoleSettings

  -- Timestamps
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  last_active_at TEXT,                    -- When SDK last had activity
  closed_at TEXT
);

CREATE INDEX idx_sessions_project_path ON sessions(project_path);
CREATE INDEX idx_sessions_status ON sessions(status);
CREATE INDEX idx_sessions_session_id ON sessions(session_id);
CREATE INDEX idx_sessions_last_active ON sessions(last_active_at);
```

### 4.5 Session Restoration Flow

```
┌─────────────────────────────────────────────────────────────────┐
│  User opens project "/path/to/myproject"                         │
├─────────────────────────────────────────────────────────────────┤
│                                                                   │
│  1. Workspace.tsx detects path change                            │
│     └── Fetch: GET /sessions?projectPath=/path/to/myproject      │
│         └── Returns sessions with status in ('active','suspended')│
│                                                                   │
│  2. For each session with session_id:                            │
│     ├── Show console with "Reconnecting..." indicator           │
│     └── Call: POST /threads/{id}/session (resume: true)         │
│         └── SDK option: { resume: session.session_id }           │
│                                                                   │
│  3. On successful resume:                                        │
│     ├── Update status to 'active'                                │
│     ├── Show "✓ Session resumed" system message                 │
│     ├── Optionally load recent history via getSessionMessages()  │
│     └── Enable chat input                                        │
│                                                                   │
│  4. On failed resume (session file missing):                     │
│     ├── Show "Previous session ended" system message            │
│     ├── Clear session_id (no longer valid)                       │
│     └── Start fresh (input still enabled)                        │
│                                                                   │
└─────────────────────────────────────────────────────────────────┘
```

### 4.6 UI States for Console Widget

```typescript
type ConsoleConnectionState =
  | 'disconnected'     // No active session, ready to start
  | 'connecting'       // Starting new session
  | 'reconnecting'     // Resuming previous session
  | 'connected'        // Active session
  | 'error';           // Connection failed

interface ConsoleState {
  // ... existing fields
  connectionState: ConsoleConnectionState;
  sessionId?: string;           // Claude Code session ID
  canResume: boolean;           // Whether this session can be resumed
}
```

**Visual Indicators:**
- **Disconnected**: Gray status dot, "Start session" prompt
- **Connecting**: Pulsing blue dot, "Starting session..." text
- **Reconnecting**: Pulsing amber dot, "Resuming session..." text
- **Connected**: Solid green dot, normal operation
- **Error**: Red dot, error message with "Retry" button

### 4.7 "What happens when you close Agent Console?"

**Answer: The session is preserved and can be resumed.**

When user closes an Agent Console (clicks X):

1. **Stop the active SDK connection** (if running)
2. **Update session record**:
   ```typescript
   await api.patch(`/sessions/${sessionId}`, {
     status: 'closed',
     closedAt: new Date().toISOString(),
   });
   ```
3. **Remove from layout** but keep in database
4. **Session remains resumable** via:
   - "Recent Sessions" panel/list
   - Command palette: "Resume session..."
   - Session search

### 4.8 Session List UI

New panel/widget showing all sessions for current workspace:

```
┌─────────────────────────────────────────┐
│  Sessions                          [+]  │
├─────────────────────────────────────────┤
│  ● Claude Code - "Fix auth bug"         │
│    Active • 5 min ago                   │
│                                         │
│  ○ Claude Code - "Add tests"            │
│    Closed • 2 hours ago    [Resume]     │
│                                         │
│  ○ Claude Code - "Refactor API"         │
│    Closed • Yesterday      [Resume]     │
│                                         │
│  ▼ Archived (3)                         │
│    ○ Old session 1...                   │
│    ○ Old session 2...                   │
└─────────────────────────────────────────┘
```

**Actions:**
- Click active session → Focus that console
- Click "Resume" → Restore console to layout, resume SDK session
- Right-click → Archive, Delete permanently, Rename, Fork

### 4.9 Session Fork/Branch

Use SDK's `forkSession` option to create a new session that copies the original's history:

```typescript
async function forkSession(originalSessionId: string): Promise<Session> {
  // Create new session record
  const newSession = await api.post('/sessions', {
    ...originalSession,
    id: generateId(),
    name: `${originalSession.name} (fork)`,
    status: 'active',
    forkedFrom: originalSessionId,
  });

  // Start SDK with fork option
  await startSdkSession({
    resume: originalSessionId,
    forkSession: true,  // Creates new session copying history
  });

  return newSession;
}
```

### 4.10 Session Search

Search across all sessions in the workspace:

```typescript
// API endpoint
app.get('/sessions/search', async (req, res) => {
  const { projectPath, query } = req.query;

  // Search by name and last_prompt
  const sessions = db.prepare(`
    SELECT * FROM sessions
    WHERE project_path = ?
    AND (name LIKE ? OR last_prompt LIKE ?)
    ORDER BY last_active_at DESC
  `).all(projectPath, `%${query}%`, `%${query}%`);

  res.json({ sessions });
});
```

### 4.11 Conversation History (Optional Enhancement)

For displaying previous messages when resuming:

**Option A: Use SDK's getSessionMessages()**
```typescript
// On resume, fetch history from Claude Code's storage
const messages = await getSessionMessages(sessionId, { cwd: projectPath });
// Display in console
```

**Option B: Store in our database**
```sql
CREATE TABLE IF NOT EXISTS session_messages (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES sessions(id),
  role TEXT NOT NULL CHECK (role IN ('user', 'assistant', 'system', 'tool')),
  content TEXT NOT NULL,
  metadata TEXT,                  -- JSON: tool calls, costs, etc.
  created_at TEXT NOT NULL DEFAULT (datetime('now')),

  FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
);

CREATE INDEX idx_session_messages_session_id ON session_messages(session_id);
```

**Recommendation**: Start with Option A (SDK storage) since Claude Code already maintains complete history. Only implement Option B if we need:
- Faster search across message content
- Custom metadata not stored by SDK
- Offline access to history

---

## Implementation Roadmap

### Phase 1: Foundation (Backend)

| Task | Description | Effort | Priority |
|------|-------------|--------|----------|
| **1.1** | Add `sessions` table (migration 5) | S | High |
| **1.2** | Create `SessionStore` class with CRUD operations | M | High |
| **1.3** | Add `/sessions` REST endpoints | S | High |
| **1.4** | Wire up session_id capture from SDK events | S | High |

### Phase 2: Core Session Resume (Frontend + Backend)

| Task | Description | Effort | Priority |
|------|-------------|--------|----------|
| **2.1** | Add `connectionState` to ConsoleState | S | High |
| **2.2** | Implement workspace change detection | S | High |
| **2.3** | Auto-restore sessions on workspace load | M | High |
| **2.4** | Resume SDK sessions with `{ resume: sessionId }` | M | High |
| **2.5** | UI indicators for connection states | S | High |

### Phase 3: Session Management UI

| Task | Description | Effort | Priority |
|------|-------------|--------|----------|
| **3.1** | Session list panel/widget | M | Medium |
| **3.2** | Resume closed sessions from list | S | Medium |
| **3.3** | Session search functionality | M | Medium |
| **3.4** | Session rename/archive/delete actions | S | Medium |

### Phase 4: Per-Workspace Layouts

| Task | Description | Effort | Priority |
|------|-------------|--------|----------|
| **4.1** | Per-workspace layout storage keys | S | Medium |
| **4.2** | Layout save/restore with workspace path | S | Medium |
| **4.3** | Include session panel positions in layout | M | Medium |

### Phase 5: Advanced Features

| Task | Description | Effort | Priority |
|------|-------------|--------|----------|
| **5.1** | Session fork/branch functionality | M | Low |
| **5.2** | Conversation history display on resume | M | Low |
| **5.3** | WorkspaceContext provider (context layering) | M | Low |
| **5.4** | Widget registry pattern | M | Low |

**Legend**: S = Small (< 1 day), M = Medium (1-2 days), L = Large (3+ days)

### Recommended Implementation Order

```
Week 1: Foundation + Core Resume
├── 1.1-1.4: Backend sessions table & API
├── 2.1-2.2: Frontend state & workspace detection
└── 2.3-2.5: Auto-restore & resume flow

Week 2: Session Management
├── 3.1-3.4: Session list UI
└── 4.1-4.3: Per-workspace layouts

Week 3+: Polish & Advanced
└── 5.1-5.4: Fork, history, context layering
```

---

## Files to Create/Modify

### New Files

| File | Purpose |
|------|---------|
| `packages/server/src/persistence/session-store.ts` | Session CRUD operations |
| `packages/ui/src/components/workspace/SessionListWidget.tsx` | Session list panel |
| `packages/ui/src/hooks/useSessions.ts` | Session data hook |
| `packages/ui/src/context/WorkspaceContext.tsx` | Workspace-scoped React context (Phase 5) |
| `packages/ui/src/lib/widgets/registry.ts` | Widget type definitions (Phase 5) |

### Modified Files

| File | Changes |
|------|---------|
| `packages/server/src/persistence/task-store.ts` | Add migration 5 (sessions table) |
| `packages/server/src/server.ts` | Add /sessions endpoints |
| `packages/server/src/adapters/session-manager.ts` | Store session_id on session start |
| `packages/ui/src/components/workspace/Workspace.tsx` | Workspace change handling, session restore, connectionState |
| `packages/ui/src/stores/workspace.ts` | Per-workspace layout storage, WidgetType expansion |
| `packages/ui/src/stores/app.ts` | Session list state (if not using dedicated hook) |

---

## Design Principles

1. **Follow the task pattern** - Use `project_path` column + index consistently
2. **Optional filtering** - `projectPath: null` returns all (for global views)
3. **Graceful degradation** - If DB fails, still work with local state
4. **Session cleanup** - Always close sessions before switching workspaces
5. **Extensibility** - Widget registry supports future widget types
6. **Context separation** - Clear boundaries between app, workspace, and widget state

---

## Open Questions

### Resolved ✅

1. **"What happens when you close Agent Console?"**
   - **Answer**: Session is preserved with `status: 'closed'`. Can be resumed anytime via session list or command palette. Session file remains in `~/.claude/projects/`.

2. **"When can a session NOT be resumed?"**
   - **Answer**: Only when:
     - Session file is manually deleted from `~/.claude/projects/`
     - Attempting to resume on a different machine (files are local)
     - CWD has changed (sessions are per-CWD in Claude Code)

3. **"Do sessions expire?"**
   - **Answer**: No. Claude Code sessions persist indefinitely.

### Still Open 🔄

4. **Multi-window support**: Should different Electron windows share sessions or be isolated?
   - Current thinking: Share database, but only one window can have an "active" SDK connection to a session at a time.

5. **Session history limits**: How many messages to display when resuming?
   - Option A: Show last N messages (e.g., 50)
   - Option B: Show collapsed "View previous messages" expander
   - Option C: Start fresh with "Session resumed" message only

6. **Workspace deletion**: What happens to sessions when a project folder is deleted?
   - Sessions become orphaned but technically still resumable if folder recreated
   - Should we auto-archive orphaned sessions?

7. **Remote workspaces**: How to handle SSH/remote project paths?
   - Claude Code session files are local, so resume won't work across machines
   - Could sync session files, but complex

8. **Session naming**: Auto-generate names from first prompt or require manual naming?
   - Suggestion: Auto-generate from first prompt (truncated), allow rename

9. **Session list location**: Separate panel vs. integrated into existing UI?
   - Option A: New "Sessions" widget type
   - Option B: Dropdown/popover from toolbar
   - Option C: Sidebar like VS Code's "Recent" files

---

## Implementation Progress

### Completed ✅

#### Backend (Phase 1)

1. **Extended `threads` table** with session resume fields (Migration 1):
   - `status` (active, suspended, closed, archived)
   - `last_prompt` (for search/display)
   - `message_count`
   - `layout_panel_id`
   - `closed_at`

2. **Added FTS5 search** (Migration 2):
   - `threads_fts` virtual table for full-text search on user prompts

3. **Session management methods** in `sqlite-store.ts`:
   - `listSessions()` - List with filtering by projectPath, status
   - `getResumableSessions()` - Get sessions that can be resumed
   - `closeSession()` / `suspendSession()` / `activateSession()` / `archiveSession()`
   - `searchSessions()` - FTS search across session content
   - `quickSearchSessions()` - LIKE search on name/last_prompt

4. **REST API endpoints** in `server.ts`:
   - `GET /sessions` - List sessions with filters
   - `GET /sessions/resumable` - Resumable sessions for a project
   - `GET /sessions/search` - Full-text search
   - `GET /sessions/quick-search` - Quick LIKE search
   - `POST /sessions/:id/close` - Mark session as closed
   - `POST /sessions/:id/activate` - Reactivate a session
   - `POST /sessions/:id/archive` - Archive a session
   - `POST /sessions/suspend-all` - Suspend all sessions for a project

#### Frontend (Phase 2/3)

1. **"Search Agent Console" command** in command palette:
   - Lists all sessions with status, time ago, message count
   - Async loading with loading indicator
   - On selection: activates session and creates resumed console

2. **Console resume options**:
   - `ConsoleResumeOptions` interface: `threadId`, `resume`, `sessionId`, `projectPath`
   - `handleNewTerminal()` accepts resume options
   - Sets `resumeSessionId` and `path` on console state for resume

3. **Session creation with resume**:
   - Passes `resume: true` and `sessionId` to `/threads/:id/session` API
   - Passes original `projectPath` as CWD to ensure SDK finds session files

4. **Console thread reactivation**:
   - `ensureConsoleThreadAndGoal()` now checks for existing inactive threads
   - Reactivates them instead of failing with UNIQUE constraint

5. **Auto-summary on resume**:
   - When a session is resumed, automatically sends a summary prompt
   - Prompt: "Please provide a brief summary of what we were working on in the previous session, including any pending tasks or next steps."
   - Leverages Claude's built-in context from the resumed SDK session
   - User immediately sees context without manual prompting

### Known Issues ⚠️

#### SDK Session ID Mismatch (RESOLVED ✅)

**Problem**: We were storing the wrong session ID, causing resume to fail with "No conversation found".

**Root Cause**:
The `session_id` field in SDK event messages (e.g., from `system.init`) is **NOT** the same as the resumable session ID. The resumable session ID is the **filename** of the `.jsonl` file in `~/.claude/projects/`.

| ID Type | Example | Purpose |
|---------|---------|---------|
| Event `session_id` | `eb95ae3b-306b-4a42-a38b-ea40b8f5eede` | Internal SDK turn/message tracking |
| Resumable Session ID | `1f467798-2d13-4734-ab86-146cf3e57a79` | Filename, used for `--resume` |

**Solution**:
Instead of capturing `session_id` from SDK events, we now call `listSessions({ dir: cwd })` after query completion to get the **actual** session ID from Claude's storage.

```typescript
// After query completes, get the actual session ID
const sdkSessions = await listSessions({ dir: session.cwd });
const sortedSessions = [...sdkSessions].sort((a, b) =>
  new Date(b.modified).getTime() - new Date(a.modified).getTime()
);
const actualSessionId = sortedSessions[0].sessionId;  // Most recent = current
```

**Validation**:
The UI now cross-references stored session IDs with actual SDK sessions via `GET /sessions/sdk` endpoint. Invalid sessions show `✗` indicator.

#### SDK Session Resume Exit Code 1 (Under Investigation)

**Problem**: When resuming a session via the SDK's `resume: sessionId` option, the Claude Code subprocess exits with code 1.

**Note**: This may have been caused by the wrong session ID being passed. Now that we're using the correct session ID, this needs to be re-tested.

**Symptoms**:
```
[SessionManager] Attempting to resume session: <uuid> (cwd: /path/to/project)
[SessionManager] SDK event: result
[SessionManager] SDK event: system
[SessionManager] Got session ID: <uuid>
[SessionManager] processQuery error: Error: Claude Code process exited with code 1
```

**Possible causes** (if still occurring with correct ID):

1. **Session file not found**: The SDK looks for sessions in `~/.claude/projects/<encoded-cwd>/`. If the CWD doesn't match exactly, the session file won't be found.
   - **Mitigation implemented**: We now pass `projectPath` from the original session to ensure consistent CWD

2. **Session file corrupted or incompatible**: The JSONL file may have been modified or created by a different SDK version.

3. **Auth issues specific to resume**: The resume flow may require different auth handling.

4. **SDK bug**: The `resume` option may have bugs in the current SDK version (0.2.74).

**Debugging steps**:

1. Check if session file exists:
   ```bash
   ls -la ~/.claude/projects/<encoded-cwd>/<session-id>.jsonl
   ```

2. Verify the session ID matches a valid file:
   ```bash
   cat ~/.claude/projects/<encoded-cwd>/sessions-index.json | jq .
   ```

3. Try resuming manually via CLI:
   ```bash
   claude --resume <session-id>
   ```

4. Check if `continue` option works (resumes most recent):
   ```typescript
   const options = { continue: true };  // Instead of resume: sessionId
   ```

**Potential workarounds**:

1. **Use `continue` instead of `resume`**: If we only need "most recent" resume, this might work better.

2. **Don't use SDK resume**: Instead, just start a fresh session and let the user reference previous context manually.

3. **Fork instead of resume**: Use `forkSession: true` with `resume` to create a copy.

4. **Load history separately**: Don't use SDK resume, but fetch conversation history via `getSessionMessages()` and display it in the UI.

### Next Steps

1. **Debug SDK resume**:
   - Test `claude --resume <id>` directly in terminal
   - Test with `continue: true` option
   - Check SDK source/issues for known problems

2. **Implement fallback**:
   - If resume fails, show message "Previous session context unavailable"
   - Start fresh session but keep UI showing "resumed" session

3. **Add session history display**:
   - Even without SDK resume, we can show previous messages
   - Use our stored `last_prompt` or fetch from SDK's session files

4. **Test CWD matching**:
   - Log both stored `projectPath` and current `cwd`
   - Ensure they match exactly (case, trailing slashes, symlinks)

### Files Modified

| File | Changes |
|------|---------|
| `packages/server/src/persistence/sqlite-store.ts` | Migrations 1-3, session methods |
| `packages/server/src/adapters/session-manager.ts` | Resume handling, ConsoleThread reactivation |
| `packages/server/src/server.ts` | /sessions API endpoints |
| `packages/ui/src/stores/app.ts` | `SessionInfo` type, API methods |
| `packages/ui/src/stores/workspace.ts` | `ConsoleResumeOptions` interface |
| `packages/ui/src/lib/commands/default-commands.ts` | "Search Agent Console" command |
| `packages/ui/src/lib/commands/types.ts` | `getCommandsAsync` support |
| `packages/ui/src/components/command-palette/CommandPalette.tsx` | Async command loading |
| `packages/ui/src/components/workspace/Workspace.tsx` | Resume options handling, path override |

---

## Future Enhancement: Load Conversation History on Resume

### Current Implementation (v1)
When resuming a session, we automatically send a summary prompt to Claude:
> "Please provide a brief summary of what we were working on in the previous session, including any pending tasks or next steps."

This works because the SDK's `resume` option loads the full conversation context into Claude's memory.

### Enhanced Implementation Plan

**Goal**: Display actual conversation history in the console UI when resuming, similar to how Claude Code CLI shows previous messages.

### Data Sources

We have **two sources** for conversation history:

#### 1. Our Database (`messages` table)
```typescript
interface Message {
  id: number;
  threadId: string;
  turnId: string;
  role: 'user' | 'assistant';
  content: string;  // Plain text content
  timestamp: Date;
  usage?: { inputTokens, outputTokens, costUsd };
}
```
- **Pros**: Already stored, fast to query, consistent format
- **Cons**: May be missing if app wasn't running (e.g., CLI usage), only stores final text content

#### 2. SDK's `getSessionMessages()`
```typescript
import { getSessionMessages } from '@anthropic-ai/claude-agent-sdk';

type SessionMessage = {
  type: 'user' | 'assistant';
  uuid: string;
  session_id: string;
  message: unknown;  // Raw SDK message format
  parent_tool_use_id: null;
};

const messages = await getSessionMessages(sessionId, { dir: projectPath });
```
- **Pros**: Complete history from JSONL files, includes tool calls
- **Cons**: Complex `message` format, needs parsing, may include internal events

### Recommended Approach: Hybrid

1. **Primary**: Use our database (`messages` table) for history we captured
2. **Fallback**: Use SDK's `getSessionMessages()` for sessions started via CLI
3. **Transform**: Convert messages to `ConsoleLine[]` format for display

### Implementation Steps

#### Phase 1: Backend API

1. **Add `GET /threads/:id/history` endpoint**
   ```typescript
   // Returns messages from our DB, falling back to SDK if needed
   app.get('/threads/:id/history', async (c) => {
     const threadId = c.req.param('id');
     const limit = parseInt(c.req.query('limit') ?? '50');

     // Try our database first
     const dbMessages = store.getMessages(threadId, { limit });

     if (dbMessages.length > 0) {
       return c.json({ ok: true, messages: dbMessages, source: 'database' });
     }

     // Fall back to SDK session files
     const thread = store.getThread(threadId);
     if (thread?.sessionId && thread?.projectPath) {
       try {
         const sdkMessages = await getSessionMessages(thread.sessionId, {
           dir: thread.projectPath,
           limit
         });
         const parsed = parseSDKMessages(sdkMessages);
         return c.json({ ok: true, messages: parsed, source: 'sdk' });
       } catch (err) {
         return c.json({ ok: true, messages: [], source: 'none' });
       }
     }

     return c.json({ ok: true, messages: [], source: 'none' });
   });
   ```

2. **Create SDK message parser**
   ```typescript
   // The SDK's message.message field is complex - need to extract text
   function parseSDKMessages(sdkMessages: SessionMessage[]): ParsedMessage[] {
     return sdkMessages.map(msg => {
       // msg.message is the raw Anthropic API message format
       // Need to extract text blocks from content array
       const content = extractTextContent(msg.message);
       return {
         role: msg.type,
         content,
         uuid: msg.uuid,
         timestamp: extractTimestamp(msg),
       };
     });
   }

   function extractTextContent(message: unknown): string {
     // Handle Anthropic message format:
     // { role: 'user'|'assistant', content: string | ContentBlock[] }
     if (typeof message === 'object' && message !== null) {
       const m = message as { content?: unknown };
       if (typeof m.content === 'string') return m.content;
       if (Array.isArray(m.content)) {
         return m.content
           .filter(block => block.type === 'text')
           .map(block => block.text)
           .join('\n');
       }
     }
     return '[Unable to parse message]';
   }
   ```

#### Phase 2: UI Integration

1. **Extend `ConsoleResumeOptions`**
   ```typescript
   interface ConsoleResumeOptions {
     threadId: string;
     resume: boolean;
     sessionId?: string;
     projectPath?: string;
     loadHistory?: boolean;  // NEW: Whether to load history
   }
   ```

2. **Fetch history on resume**
   ```typescript
   // In handleNewTerminal(), after creating the console:
   if (resumeOptions?.resume && resumeOptions?.loadHistory !== false) {
     const history = await fetch(`${API_URL}/threads/${threadId}/history?limit=20`);
     const { messages } = await history.json();

     // Convert to ConsoleLine[] and prepend to lines
     const historyLines: ConsoleLine[] = messages.map(msg => ({
       id: `history-${msg.id || msg.uuid}`,
       type: msg.role === 'user' ? 'prompt' : 'output',
       content: msg.content,
       timestamp: msg.timestamp,
     }));

     setTerminals(prev => prev.map(t =>
       t.id === newTerminalId
         ? { ...t, lines: [...historyLines, ...t.lines] }
         : t
     ));
   }
   ```

3. **Add visual separator**
   ```typescript
   // Add a divider line between history and new messages
   const dividerLine: ConsoleLine = {
     id: 'history-divider',
     type: 'system',
     content: '─── Previous conversation ───────────────────────────',
   };
   ```

#### Phase 3: UI Polish

1. **Collapsed history view**
   - Show last 2-3 messages expanded
   - Older messages collapsed with "Show N more messages" button

2. **History indicator**
   - Add icon/badge in title bar showing "Resumed session"
   - Tooltip shows session start date

3. **Lazy loading**
   - Only load more history on scroll up
   - Use `beforeId` pagination

### Message Type Mapping

| Source Format | → | ConsoleLine Type |
|---------------|---|------------------|
| `user` message | → | `prompt` |
| `assistant` text | → | `output` |
| `assistant` thinking | → | `thinking` (if available) |
| Tool use | → | `tool_call` |
| Tool result | → | `tool_result` |
| System/error | → | `system` / `error` |

### Edge Cases

1. **Mixed sources**: Session started in CLI, then opened in ACC
   - Use SDK messages for history, then our DB for new messages

2. **Long conversations**: Sessions with 100+ messages
   - Paginate, load most recent N first
   - "Load more" button for older messages

3. **Tool calls in history**: How to display?
   - Option A: Collapsed by default, expandable
   - Option B: Just show summary "Used tool: Read file.ts"
   - Option C: Skip tool calls, only show user/assistant text

4. **Streaming indicators**: Don't show for historical messages
   - Set `isStreaming: false` for all history lines

### Complexity Estimate

| Phase | Effort | Files Modified |
|-------|--------|----------------|
| Phase 1: Backend | 2-3 hours | session-manager.ts, server.ts |
| Phase 2: UI Integration | 2-3 hours | Workspace.tsx, default-commands.ts |
| Phase 3: Polish | 3-4 hours | New HistoryPanel component |
| **Total** | **7-10 hours** | |

### Dependencies

- Understanding of SDK's message format (needs investigation)
- Decision on tool call display strategy
- Decision on collapsed vs expanded history
