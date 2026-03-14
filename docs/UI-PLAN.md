# ACC Frontend UI/UX Plan

## Design Philosophy

**Capy-inspired flow** with ACC's multi-agent superpowers:
- Clean, conversational task creation
- Real-time execution visibility (Karpathy's tmux grid)
- Multi-agent orchestration (not just one agent)

---

## Page Structure

### 1. **Home / Dashboard** (`/`)

```
┌─────────────────────────────────────────────────────────────────┐
│  🦞 Dispatch                                [Settings] [Agents] │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │                                                         │   │
│  │     "What would you like to build today?"               │   │
│  │                                                         │   │
│  │  ┌─────────────────────────────────────────────────┐   │   │
│  │  │ Describe your task...                      [→]  │   │   │
│  │  └─────────────────────────────────────────────────┘   │   │
│  │                                                         │   │
│  │  Examples:                                              │   │
│  │  • "Fix the login bug in auth.ts"                      │   │
│  │  • "Add dark mode to the settings page"                │   │
│  │  • "Review PR #42 and suggest improvements"            │   │
│  │                                                         │   │
│  └─────────────────────────────────────────────────────────┘   │
│                                                                 │
│  ─────────────────────────────────────────────────────────────  │
│                                                                 │
│  Connected Agents                              Recent Tasks     │
│  ┌──────────────┐ ┌──────────────┐    ┌────────────────────┐   │
│  │ 🟢 molty     │ │ 🟢 forge     │    │ ✅ Fix auth bug    │   │
│  │ claude-opus  │ │ kimi-k2.5    │    │    2 min ago       │   │
│  │ idle         │ │ idle         │    ├────────────────────┤   │
│  └──────────────┘ └──────────────┘    │ 🔄 Add dark mode   │   │
│  ┌──────────────┐ ┌──────────────┐    │    running...      │   │
│  │ ⚪ dottie    │ │ + Add Agent  │    ├────────────────────┤   │
│  │ offline      │ │              │    │ ✅ Review PR #41   │   │
│  └──────────────┘ └──────────────┘    │    1 hour ago      │   │
│                                        └────────────────────┘   │
└─────────────────────────────────────────────────────────────────┘
```

**Components:**
- Hero input (prominent, Capy-style)
- Connected agents grid (status indicators)
- Recent tasks list (quick re-run)

---

### 2. **Planning View** (`/task/:id/plan`)

After submitting a task, enter planning mode (like Capy's Captain):

```
┌─────────────────────────────────────────────────────────────────┐
│  ← Back                        Planning: "Fix auth bug"         │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │ 💬 Chat with your agents                                │   │
│  ├─────────────────────────────────────────────────────────┤   │
│  │                                                         │   │
│  │  You: Fix the login bug in auth.ts - users are getting │   │
│  │       logged out after 5 minutes                        │   │
│  │                                                         │   │
│  │  🦞 molty: I'll analyze the auth flow. Looking at:      │   │
│  │     • src/auth.ts - session handling                    │   │
│  │     • src/middleware/auth.ts - token refresh            │   │
│  │                                                         │   │
│  │     The issue is in the token refresh logic. The        │   │
│  │     refresh window is set to 5 minutes but should be    │   │
│  │     triggered before expiry, not after.                 │   │
│  │                                                         │   │
│  │     **Proposed fix:**                                   │   │
│  │     1. Change refresh window from 5min to 10min         │   │
│  │     2. Add refresh-before-expiry logic                  │   │
│  │     3. Add retry on 401                                 │   │
│  │                                                         │   │
│  │     Ready to execute?                                   │   │
│  │                                                         │   │
│  ├─────────────────────────────────────────────────────────┤   │
│  │ ┌─────────────────────────────────────────────────┐     │   │
│  │ │ Ask a follow-up or refine the plan...          │     │   │
│  │ └─────────────────────────────────────────────────┘     │   │
│  │                                                         │   │
│  │        [Approve & Execute]              [Cancel]        │   │
│  └─────────────────────────────────────────────────────────┘   │
│                                                                 │
│  ┌──────────────────────────┐  ┌──────────────────────────┐    │
│  │ 📁 Files to modify       │  │ 🎯 Agents assigned       │    │
│  │ • src/auth.ts            │  │ • molty (primary)        │    │
│  │ • src/middleware/auth.ts │  │                          │    │
│  └──────────────────────────┘  └──────────────────────────┘    │
└─────────────────────────────────────────────────────────────────┘
```

**Components:**
- Chat panel (main interaction)
- File preview sidebar
- Agent assignment panel
- Approve/Cancel buttons

---

### 3. **Execution View** (`/task/:id/execute`)

TMux-style grid showing real-time agent activity:

```
┌─────────────────────────────────────────────────────────────────┐
│  ← Back            Executing: "Fix auth bug"       [⏸️] [⏹️]   │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  ┌─────────────────────────────┬───────────────────────────┐   │
│  │ 🦞 molty                    │ 📝 Diff Preview           │   │
│  │ ─────────────────────────── │ ─────────────────────────  │   │
│  │ > Reading src/auth.ts...    │                           │   │
│  │ > Found refreshToken fn     │ src/auth.ts               │   │
│  │ > Analyzing token flow...   │ ───────────────────────── │   │
│  │ > Writing fix...            │ @@ -42,7 +42,7 @@         │   │
│  │                             │ - const REFRESH = 5 * 60  │   │
│  │ ▌                           │ + const REFRESH = 10 * 60 │   │
│  │                             │                           │   │
│  ├─────────────────────────────┼───────────────────────────┤   │
│  │ 📊 Stats                    │ 📋 Task Log               │   │
│  │ ─────────────────────────── │ ─────────────────────────  │   │
│  │ Duration: 00:45             │ ✅ Analyzed auth.ts       │   │
│  │ Tokens: 1,234               │ ✅ Identified issue       │   │
│  │ Cost: $0.02                 │ 🔄 Writing fix...         │   │
│  │ Files: 2 modified           │ ⏳ Tests pending          │   │
│  │                             │ ⏳ Review pending         │   │
│  └─────────────────────────────┴───────────────────────────┘   │
│                                                                 │
│  Widgets: [+ Add] [Terminal] [Diff] [Stats] [Log] [Files]      │
└─────────────────────────────────────────────────────────────────┘
```

**Components:**
- Resizable widget grid (react-resizable-panels)
- Agent output widget (streaming terminal)
- Diff preview widget
- Stats widget (time, tokens, cost)
- Task log widget (checklist style)
- Pause/Stop controls

---

### 4. **Review View** (`/task/:id/review`)

Post-execution review before commit/PR:

```
┌─────────────────────────────────────────────────────────────────┐
│  ← Back              Review: "Fix auth bug"        [Approve]    │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  Summary                                                        │
│  ───────────────────────────────────────────────────────────    │
│  Fixed token refresh bug by extending refresh window and        │
│  adding pre-expiry refresh logic.                               │
│                                                                 │
│  Changes (2 files)                                              │
│  ───────────────────────────────────────────────────────────    │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │ src/auth.ts (+12, -3)                              [▼]  │   │
│  ├─────────────────────────────────────────────────────────┤   │
│  │  42 │ - const REFRESH_WINDOW = 5 * 60 * 1000;          │   │
│  │  42 │ + const REFRESH_WINDOW = 10 * 60 * 1000;         │   │
│  │  43 │ + const REFRESH_BUFFER = 2 * 60 * 1000;          │   │
│  │ ... │                                                   │   │
│  └─────────────────────────────────────────────────────────┘   │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │ src/middleware/auth.ts (+8, -1)                    [▼]  │   │
│  └─────────────────────────────────────────────────────────┘   │
│                                                                 │
│  🤖 CodeRabbit Review                                           │
│  ───────────────────────────────────────────────────────────    │
│  ✅ No critical issues found                                    │
│  💡 Consider adding unit tests for refresh logic                │
│                                                                 │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │ Commit message:                                         │   │
│  │ fix(auth): extend refresh window and add pre-expiry... │   │
│  └─────────────────────────────────────────────────────────┘   │
│                                                                 │
│      [Create PR]    [Commit Only]    [Request Changes]          │
└─────────────────────────────────────────────────────────────────┘
```

**Components:**
- Summary card
- Diff viewer (collapsible files)
- CodeRabbit review panel
- Commit message editor
- Action buttons (PR, commit, request changes)

---

## Component Library

Using **shadcn/ui** (already in UI package) + custom:

| Component | Library | Notes |
|-----------|---------|-------|
| Layout | Custom | Electron-aware, sidebar |
| Chat | Custom | Streaming support |
| Terminal | xterm.js | Agent output |
| Diff | react-diff-viewer | File changes |
| Grid | react-resizable-panels | Widget layout |
| Cards | shadcn/ui | Agent cards, stats |
| Buttons | shadcn/ui | Actions |
| Input | shadcn/ui | Chat input |

---

## State Management

```
┌─────────────────────────────────────────────────────────────┐
│                      Electron Main                          │
│  ┌─────────────────────────────────────────────────────┐   │
│  │  IPC Bridge (preload.ts)                            │   │
│  │  - server.health()                                  │   │
│  │  - server.agents()                                  │   │
│  │  - server.sendTask()                                │   │
│  │  - server.subscribe(events)                         │   │
│  └─────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                     React (Renderer)                         │
│  ┌─────────────────────────────────────────────────────┐   │
│  │  Zustand Store                                      │   │
│  │  - agents: Map<string, Agent>                       │   │
│  │  - tasks: Map<string, Task>                         │   │
│  │  - activeTask: string | null                        │   │
│  │  - widgets: WidgetLayout                            │   │
│  └─────────────────────────────────────────────────────┘   │
│  ┌─────────────────────────────────────────────────────┐   │
│  │  React Query                                        │   │
│  │  - useAgents()                                      │   │
│  │  - useTask(id)                                      │   │
│  │  - useTaskEvents(id) // WebSocket subscription      │   │
│  └─────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────┘
```

---

## Color Palette

```css
:root {
  /* Dark theme (default) */
  --bg-primary: #0a0a0a;
  --bg-secondary: #141414;
  --bg-tertiary: #1f1f1f;
  
  --accent-primary: #6366f1;    /* Indigo - actions */
  --accent-success: #22c55e;    /* Green - success */
  --accent-warning: #f59e0b;    /* Amber - warnings */
  --accent-error: #ef4444;      /* Red - errors */
  
  --text-primary: #fafafa;
  --text-secondary: #a1a1aa;
  --text-muted: #52525b;
  
  --border: #27272a;
}
```

---

## Implementation Order

### Phase 1: Home + Agents (Week 1)
- [ ] Home page with hero input
- [ ] Agent cards (connected/offline)
- [ ] IPC bridge to server
- [ ] Basic routing

### Phase 2: Planning (Week 1-2)  
- [ ] Chat interface
- [ ] Streaming responses
- [ ] File preview sidebar
- [ ] Approve/cancel flow

### Phase 3: Execution (Week 2)
- [ ] Widget grid layout
- [ ] Terminal widget (xterm.js)
- [ ] Diff widget
- [ ] Stats widget
- [ ] Pause/stop controls

### Phase 4: Review (Week 2-3)
- [ ] Diff viewer
- [ ] CodeRabbit integration
- [ ] Commit/PR actions
- [ ] GitHub integration

---

## Decisions

1. **Multi-agent assignment** - Show which agent handles which file(s) in execution view
2. **Widget persistence** - Project-specific layouts, editable by user
3. **Project loading** - Folder select dialog OR paste path input

---

## Home Page States

### No Project Loaded (Capy-style blank)
```
┌─────────────────────────────────────────────────────────────────┐
│  🦞 Dispatch                                              [Agents]  │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│                                                                 │
│                         🦞                                      │
│                                                                 │
│                    Welcome to Dispatch                          │
│                                                                 │
│         Open a project to start working with AI agents          │
│                                                                 │
│                                                                 │
│         ┌─────────────────────────────────────────┐            │
│         │  📁 Open Folder...                      │            │
│         └─────────────────────────────────────────┘            │
│                                                                 │
│         ┌─────────────────────────────────────────┐            │
│         │  /path/to/project                   [→] │            │
│         └─────────────────────────────────────────┘            │
│                          or paste a path                        │
│                                                                 │
│                                                                 │
│         Recent Projects                                         │
│         ─────────────────                                       │
│         📁 agent-command-center    ~/workspace/acc              │
│         📁 openclaw                ~/workspace/openclaw         │
│         📁 portal                  ~/workspace/portal           │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

### Project Loaded (Active state)
```
┌─────────────────────────────────────────────────────────────────┐
│  🦞 ACC • agent-command-center          [Switch] [⚙️] [Agents]  │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │                                                         │   │
│  │     "What would you like to build?"                     │   │
│  │                                                         │   │
│  │  ┌─────────────────────────────────────────────────┐   │   │
│  │  │ Describe your task...                      [→]  │   │   │
│  │  └─────────────────────────────────────────────────┘   │   │
│  │                                                         │   │
│  └─────────────────────────────────────────────────────────┘   │
│                                                                 │
│  ... (rest of active home view)                                 │
└─────────────────────────────────────────────────────────────────┘
```
