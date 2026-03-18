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

## Phase 4: Session Recovery

### 4.1 Claude Code Session Resumption

When loading terminals from database, attempt to resume active sessions:

```typescript
async function restoreTerminalFromDb(dbTerminal: DbTerminal): Promise<TerminalState> {
  const terminal: TerminalState = {
    id: dbTerminal.id,
    agent: {
      id: dbTerminal.agentId,
      name: dbTerminal.agentName,
      type: dbTerminal.agentType,
      // ...
    },
    lines: [],
    isStreaming: false,
    threadId: dbTerminal.threadId,
    sessionActive: false,
    settings: dbTerminal.settings ? JSON.parse(dbTerminal.settings) : DEFAULT_TERMINAL_SETTINGS,
  };

  // Attempt to resume session if we have a threadId
  if (dbTerminal.threadId && dbTerminal.sessionActive) {
    try {
      const sessionStatus = await api.get(`/threads/${dbTerminal.threadId}/status`);
      if (sessionStatus.active) {
        terminal.sessionActive = true;
        terminal.lines.push({
          id: `sys-${Date.now()}`,
          type: 'system',
          content: 'Session resumed',
          timestamp: makeTimestamp(),
        });
      }
    } catch {
      // Session no longer active
      terminal.lines.push({
        id: `sys-${Date.now()}`,
        type: 'system',
        content: 'Previous session ended',
        timestamp: makeTimestamp(),
      });
    }
  }

  return terminal;
}
```

### 4.2 Conversation History

Future enhancement: Store conversation history for each terminal:

```sql
CREATE TABLE IF NOT EXISTS terminal_messages (
  id TEXT PRIMARY KEY,
  terminal_id TEXT NOT NULL REFERENCES terminals(id),
  role TEXT NOT NULL CHECK (role IN ('user', 'assistant', 'system', 'tool')),
  content TEXT NOT NULL,
  metadata TEXT,                  -- JSON: tool calls, costs, etc.
  created_at TEXT NOT NULL DEFAULT (datetime('now')),

  FOREIGN KEY (terminal_id) REFERENCES terminals(id) ON DELETE CASCADE
);

CREATE INDEX idx_terminal_messages_terminal_id ON terminal_messages(terminal_id);
```

---

## Implementation Roadmap

| Phase | Task | Effort | Priority |
|-------|------|--------|----------|
| **1.1** | Add terminals table (migration 5) | S | High |
| **1.2** | Create TerminalStore class | M | High |
| **1.3** | Add /terminals API endpoints | S | High |
| **1.4** | Workspace change detection | S | High |
| **1.5** | Terminal lifecycle updates | M | High |
| **2.1** | Per-workspace layout keys | S | Medium |
| **2.2** | Layout save/restore with path | S | Medium |
| **3.1** | WorkspaceContext provider | M | Medium |
| **3.2** | Widget registry pattern | M | Medium |
| **4.1** | Session resumption logic | M | Low |
| **4.2** | Conversation history storage | L | Low |

**Legend**: S = Small (< 1 day), M = Medium (1-2 days), L = Large (3+ days)

---

## Files to Create/Modify

### New Files

| File | Purpose |
|------|---------|
| `packages/server/src/persistence/terminal-store.ts` | Terminal CRUD operations |
| `packages/ui/src/lib/widgets/registry.ts` | Widget type definitions |
| `packages/ui/src/context/WorkspaceContext.tsx` | Workspace-scoped React context |
| `packages/ui/src/hooks/useWorkspaceTerminals.ts` | Terminal data hook |

### Modified Files

| File | Changes |
|------|---------|
| `packages/server/src/persistence/task-store.ts` | Add migration 5 (terminals table) |
| `packages/server/src/server.ts` | Add /terminals endpoints |
| `packages/ui/src/components/workspace/Workspace.tsx` | Workspace change handling, persistence |
| `packages/ui/src/stores/workspace.ts` | Per-workspace layout storage, WidgetType expansion |

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

1. **Multi-window support**: Should different Electron windows share terminals or be isolated?
2. **Terminal history limits**: How many messages to persist per terminal?
3. **Workspace deletion**: What happens to terminals when a project is removed?
4. **Remote workspaces**: How to handle SSH/remote project paths?
5. **Widget plugins**: Should third-party widgets be supported?
