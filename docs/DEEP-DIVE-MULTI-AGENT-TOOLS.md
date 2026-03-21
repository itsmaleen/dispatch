# Deep Dive: Multi-Agent Coding Orchestration Tools

> **Research Date**: March 21, 2026  
> **Purpose**: Comprehensive analysis for Dispatch feature development  
> **Scope**: Architecture patterns, code analysis, and feature recommendations

---

## Executive Summary: Top 5 Insights for Dispatch

### 1. **SQLite is the Universal Coordination Layer**

Every serious orchestrator converges on SQLite for inter-agent coordination. Overstory uses it for mail queues, AMUX uses it for atomic task claiming, gastown uses it for the beads ledger. The pattern is clear: WAL mode SQLite provides the perfect balance of simplicity, reliability, and concurrent access that multi-agent systems need.

**For Dispatch**: Implement an SQLite-based message/task queue. It's battle-tested and works even when agents crash.

### 2. **Attention Management is the Bottleneck, Not Agent Speed**

The shift from "AI is too slow" to "I can only review so fast" is the core insight from the agentmaxxing movement. cmux's notification rings, AMUX's mobile PWA, and Dorothy's Telegram integration all solve the same problem: knowing which agent needs you *right now*.

**For Dispatch**: Notification system with urgency tiers should be a first-class feature, not an afterthought.

### 3. **The Merge UX Gap is Real**

parallel-code's built-in diff viewer and one-click merge stands out because *nobody else does this well*. Most tools punt on merge UX entirely. Reviewing 5 agents' output and merging their branches is where velocity dies.

**For Dispatch**: Invest heavily in review/merge UX. This is the bottleneck.

### 4. **Self-Healing is Table Stakes for Unattended Operation**

AMUX's watchdog pattern (auto-compact at 20% context, restart + replay on corruption) is essential for overnight runs. Agents die from context overflow, not bugs. Any tool targeting "AI coding while you sleep" needs mechanical recovery.

**For Dispatch**: Implement health monitoring and automatic recovery for agent sessions.

### 5. **Terminal + Worktree + Browser is the Winning Trifecta**

constellagent bundles terminal + editor + worktree per agent. cmux adds a browser. Jean adds Monaco and git staging. The tools converging on "everything the agent touches in one view" are winning mindshare.

**For Dispatch**: Your Workspace Groups feature is the right direction. Go further.

---

## Tool-by-Tool Deep Dives

### 1. Overstory (by jayminwest)

**GitHub**: github.com/jayminwest/overstory  
**Stars**: ~1.1k (as of March 2026)  
**Stack**: Bun/TypeScript, SQLite (WAL), tmux

#### Core Architecture

Overstory uses a **coordinator → lead → worker** hierarchy with configurable depth limits:

```
Orchestrator (your Claude Code session)
 → Coordinator (persistent orchestrator at project root)
   → Lead (team lead, depth 1)
     → Workers: Scout, Builder, Reviewer, Merger (depth 2)
```

#### Key Abstractions

1. **SQLite Mail System** (`src/mail/queue.ts`)
   - WAL mode for concurrent access (~1-5ms per query)
   - 8 typed message types: `worker_done`, `merge_ready`, `dispatch`, `escalation`, etc.
   - Broadcast addresses: `@all`, `@builders`, `@scouts`
   - Debouncing on `mail check` to prevent context pollution

2. **Tiered Watchdog**
   - Tier 0: Mechanical daemon (tmux/pid liveness)
   - Tier 1: AI-assisted failure triage  
   - Tier 2: Monitor agent for continuous fleet patrol

3. **FIFO Merge Queue**
   - 4-tier conflict resolution
   - SQLite-backed ordering
   - Prevents race conditions on merges

4. **Agent Runtime Abstraction**
   - `AgentRuntime` interface for swappable backends
   - Adapters: Claude Code, Pi, Gemini CLI, Codex, Cursor, Copilot, Sapling, OpenCode
   - Guard mechanisms vary by runtime (hooks for Claude, `.sapling/guards.json` for Sapling)

#### Agent Capabilities Model

| Agent | Role | Access |
|-------|------|--------|
| Coordinator | Persistent orchestrator | Read-only |
| Scout | Exploration/research | Read-only |
| Builder | Implementation | Read-write |
| Reviewer | Validation | Read-only |
| Lead | Team coordination | Read-write |
| Merger | Branch integration | Read-write |
| Monitor | Fleet health | Read-only |

#### Notable Commands

```bash
ov init              # Initialize project
ov coordinator start # Start persistent orchestrator
ov sling <task-id>   # Assign work to agent
ov mail check --inject # Check inbox, inject into context
ov dashboard         # Live TUI monitoring
ov merge --all       # Merge all agent branches
```

#### What Dispatch Should Steal

1. **Typed message protocol** with broadcast groups
2. **Tiered watchdog** architecture (mechanical + AI triage)
3. **Agent capability model** (scout vs builder vs reviewer)
4. **`ov feed` real-time event stream** concept

---

### 2. AMUX (by mixpeek)

**GitHub**: github.com/mixpeek/amux  
**Stack**: Python (single file ~23k lines), tmux, SQLite

#### Core Architecture

AMUX is radically simple: one Python file, no build step. It's designed for "dozens of parallel agents unattended."

#### Key Features

1. **Self-Healing Watchdog**

| Condition | Action |
|-----------|--------|
| Context < 20% | Sends `/compact` (5-min cooldown) |
| `redacted_thinking ... cannot be modified` | Restarts + replays last message |
| Stuck waiting + CC_AUTO_CONTINUE=1 | Auto-responds based on prompt type |
| YOLO session + safety prompt | Auto-answers |

2. **Agent-to-Agent REST API**

```bash
# Send task to another session
curl -X POST -d '{"text":"implement login endpoint"}' \
  $AMUX_URL/api/sessions/worker-1/send

# Atomically claim board item
curl -X POST $AMUX_URL/api/board/PROJ-5/claim

# Watch another session's output
curl "$AMUX_URL/api/sessions/worker-1/peek?lines=50"
```

3. **SQLite CAS Task Claiming**
   - Atomic compare-and-swap prevents duplicate work
   - Kanban board with auto-generated keys

4. **Mobile PWA**
   - Works on iOS/Android with Background Sync
   - Offline support with command queuing

5. **Status Detection Without Hooks**
   - Parses ANSI-stripped tmux output
   - No modifications to Claude Code required

#### Web Dashboard Features

- Session cards with live status
- Peek mode with full scrollback and search
- Workspace for tiled multi-agent viewing
- Board with iCal sync

#### What Dispatch Should Steal

1. **REST API for agent-to-agent orchestration**
2. **Atomic task claiming** (SQLite CAS)
3. **Self-healing watchdog** with auto-compact
4. **ANSI output parsing** for hook-free status detection
5. **Mobile PWA** pattern for away-from-desk monitoring

---

### 3. cmux (by manaflow-ai)

**GitHub**: github.com/manaflow-ai/cmux  
**Stars**: 7.7k in first month  
**Stack**: Swift/AppKit, libghostty (GPU-accelerated)

#### Philosophy: "The Zen of cmux"

> "cmux is a primitive, not a solution... Nobody has figured out the best way to work with agents yet. Give a million developers composable primitives and they'll collectively find the most efficient workflows."

#### Core Features

1. **Notification Rings**
   - OSC 9/99/777 terminal sequences
   - CLI: `cmux notify`
   - Blue ring on pane when agent waiting
   - Tab badge in sidebar
   - `Cmd+Shift+U` jumps to most recent unread

2. **Scriptable Browser**
   - Ported from `agent-browser` by Vercel Labs
   - Agents can snapshot a11y tree, get element refs, click, fill forms, evaluate JS
   - Split browser pane next to terminal

3. **Socket API**
   - Create workspaces/tabs
   - Split panes
   - Send keystrokes
   - Open URLs

4. **Native Performance**
   - Swift/AppKit (not Electron)
   - GPU-accelerated via libghostty
   - Reads existing `~/.config/ghostty/config`

#### Keyboard Shortcuts (Selection)

| Action | Shortcut |
|--------|----------|
| New workspace | ⌘ N |
| Jump to workspace 1-8 | ⌘ 1-8 |
| New surface | ⌘ T |
| Split right | ⌘ D |
| Split down | ⌘ ⇧ D |
| Open browser in split | ⌘ ⇧ L |
| Show notifications panel | ⌘ I |
| Jump to latest unread | ⌘ ⇧ U |

#### What Dispatch Should Steal

1. **Notification ring system** with visual urgency
2. **Scriptable browser** for web dev workflows
3. **Keyboard-first navigation** with numbered workspaces
4. **Socket API** for external automation

---

### 4. parallel-code (by johannesjo)

**GitHub**: github.com/johannesjo/parallel-code  
**Stack**: Electron, SolidJS, TypeScript

#### Core Value Proposition

"Turn wait time into parallel progress" — the only tool that takes **merge UX seriously**.

#### Key Features

1. **Built-in Diff Viewer**
   - Per-task changed files list
   - Visual staging
   - Side-by-side or unified diffs

2. **One-Click Merge**
   - Merge task branch to main from sidebar
   - Conflict resolution in-app

3. **Auto-Worktree Setup**
   - Creates git worktree per task
   - Symlinks `node_modules` and gitignored dirs
   - Branch naming: `feature/task-name`

4. **Remote Monitoring**
   - QR code scan
   - Watch agents over Wi-Fi or Tailscale

5. **Theme Support**
   - 6 themes: Minimal, Graphite, Classic, Indigo, Ember, Glacier

#### Keyboard Shortcuts

| Action | Shortcut |
|--------|----------|
| New task | Ctrl+N |
| Send prompt | Ctrl+Enter |
| Merge to main | Ctrl+Shift+M |
| Push to remote | Ctrl+Shift+P |
| Close active task | Ctrl+Shift+W |
| Navigate between panels | Alt+Arrows |
| Toggle sidebar | Ctrl+B |
| New shell terminal | Ctrl+Shift+T |

#### What Dispatch Should Steal

1. **Inline diff viewer** per workspace
2. **One-click merge** workflow
3. **QR code remote monitoring**
4. **Symlinked node_modules** for worktrees

---

### 5. gastown (by Steve Yegge)

**GitHub**: github.com/steveyegge/gastown  
**Stack**: Go, SQLite (via beads), tmux

#### Core Concepts

gastown uses a unique vocabulary (Mayor, Town, Rigs, Polecats, Hooks, Convoys, Beads) but the underlying architecture is sophisticated:

1. **The Mayor** - AI coordinator with full workspace context
2. **Rigs** - Project containers (one per git repo)
3. **Polecats** - Worker agents with persistent identity but ephemeral sessions
4. **Hooks** - Git worktree-based persistent storage
5. **Convoys** - Work tracking units bundling multiple beads
6. **Beads** - Git-backed issue tracking (structured data)

#### Key Architecture

```
Mayor (AI Coordinator)
 → Town (Workspace ~/gt/)
   → Rig: Project A
     → Crew Member (your workspace)
     → Hooks (persistent storage)
     → Polecats (worker agents)
```

#### The Beads System

Bead IDs use `prefix-5char` format (e.g., `gt-abc12`). They're stored as structured data in git:

```bash
bd formula list           # List formulas
bd cook release          # Execute formula
bd mol pour release      # Create trackable instance
```

#### Activity Feed TUI (`gt feed`)

Three-panel dashboard:
- Agent Tree (hierarchical view by rig/role)
- Convoy Panel (in-progress and landed)
- Event Stream (chronological feed)

**Problems View** (`gt feed --problems`) surfaces stuck agents:

| State | Condition |
|-------|-----------|
| GUPP Violation | Hooked work with no progress |
| Stalled | Reduced progress |
| Zombie | Dead tmux session |
| Working | Active, progressing |
| Idle | No hooked work |

#### What Dispatch Should Steal

1. **Beads/formula system** for repeatable workflows
2. **Problems view** for stuck agent detection
3. **Convoy concept** for grouping related tasks
4. **Activity feed TUI** design
5. **Git-backed persistence** for crash recovery

---

### 6. constellagent (by owengretzinger)

**GitHub**: github.com/owengretzinger/constellagent  
**Stack**: Bun, xterm.js, Monaco, Electron (macOS)

#### Core Architecture

Each agent gets a complete isolated environment:
- Own terminal (xterm.js + node-pty)
- Own code editor (Monaco with syntax highlighting)
- Own git worktree
- Own cron-based automation scheduling

#### Features

1. **Integrated Monaco Editor**
   - Syntax highlighting
   - Diff viewing
   - Per-agent file context

2. **Git Staging/Committing**
   - Visual branch management
   - Worktree operations from UI

3. **Cron Automation**
   - Sleep/wake recovery
   - Coalesces missed runs when app stays open

4. **Keyboard-Driven**
   - Quick Open
   - Tab switching
   - Full shortcut system

#### What Dispatch Should Steal

1. **Full editor integration** per agent
2. **Cron automation scheduling**
3. **Sleep/wake recovery** for scheduled tasks

---

### 7. claude-squad (by smtg-ai)

**GitHub**: github.com/smtg-ai/claude-squad  
**Stack**: Go, tmux, TUI

#### Core Value

Minimal, focused tool. Manage multiple Claude Code, Codex, Gemini, Aider instances with a simple TUI.

#### Key Features

1. **Background Completion**
   - Auto-accept mode (`--autoyes`)
   - Tasks complete without watching

2. **Review Before Apply**
   - Checkout changes before pushing
   - Pause and resume sessions

3. **Profile System**

```json
{
  "profiles": [
    { "name": "claude", "program": "claude" },
    { "name": "codex", "program": "codex" },
    { "name": "aider", "program": "aider --model ollama_chat/gemma3:1b" }
  ]
}
```

4. **Simple TUI Commands**

| Key | Action |
|-----|--------|
| n | New session |
| N | New session with prompt |
| D | Kill session |
| ↵/o | Attach to session |
| s | Commit and push |
| c | Checkout (pause) |
| r | Resume paused |
| tab | Switch preview/diff |

#### What Dispatch Should Steal

1. **Profile system** for agent presets
2. **Checkout/pause/resume** workflow
3. **Minimal TUI design**

---

### 8. Dorothy (by Charlie85270)

**GitHub**: github.com/Charlie85270/Dorothy  
**Stack**: Electron, React

#### Core Value

Full-featured desktop orchestrator with automations, Kanban, and remote control.

#### Key Features

1. **Super Agent (Orchestrator)**
   - Meta-agent that delegates to other agents
   - Creates/starts/stops agents via MCP tools
   - Responds to Telegram/Slack

2. **Automations**

Sources supported:
| Source | Method |
|--------|--------|
| GitHub | `gh` CLI - PRs, issues, releases |
| JIRA | REST API v3 - issues, bugs, tasks |

Execution pipeline:
1. Scheduler triggers on cron/interval
2. Poller fetches items from source
3. Filter applies trigger conditions
4. Deduplication skips processed items
5. Agent spawning for each item
6. Prompt injection via templates
7. Output delivery to Telegram/Slack/GitHub

3. **Kanban Task Management**

Workflow: Backlog → Planned → Ongoing → Done

Auto-assignment:
- Matches task skills to agent capabilities
- Creates agents if no match exists
- Tracks progress automatically

4. **Vault (Document Storage)**
   - Markdown docs with tags and attachments
   - SQLite FTS5 full-text search
   - Cross-agent access

5. **Remote Control (Telegram/Slack)**

Commands:
| Command | Description |
|---------|-------------|
| /status | Overview of all agents |
| /agents | Detailed agent list |
| /start_agent <name> <task> | Spawn and start |
| /ask <message> | Delegate to Super Agent |

#### What Dispatch Should Steal

1. **Automation pipeline** with external source polling
2. **Template variables** for prompt injection
3. **Vault concept** for cross-agent knowledge base
4. **Telegram/Slack integration** for remote control
5. **Kanban auto-assignment** based on skills

---

### 9. 1code (by 21st.dev)

**GitHub**: github.com/21st-dev/1code  
**Stack**: Bun, Electron

#### Core Value

"Run coding agents the right way" — visual UI for Claude Code and Codex with cloud sandboxes.

#### Key Features

1. **Visual Diff Previews**
   - See changes in real-time
   - Rollback from any message bubble

2. **Background Agents (Cloud)**
   - Close laptop, agents keep running
   - Isolated cloud sandboxes
   - Live browser previews

3. **Automations**
   - Trigger from GitHub, Linear, Slack
   - @1code mentions start agents

4. **API for Programmatic Execution**

```bash
curl -X POST https://1code.dev/api/v1/tasks \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -d '{
    "repository": "https://github.com/your-org/repo",
    "prompt": "Fix the failing CI tests"
  }'
```

5. **Chat Forking**
   - Fork sub-chat from any assistant message
   - Explore alternatives without losing context

6. **Message Queue**
   - Queue prompts while agent is working
   - Processed in order when available

#### What Dispatch Should Steal

1. **Cloud sandbox execution**
2. **API for programmatic agent runs**
3. **Chat forking** concept
4. **Message queuing** while agent busy

---

### 10. Jean (by coollabs.io)

**GitHub**: github.com/coollabsio/jean  
**Stack**: Tauri v2, React 19, Rust, TypeScript

#### Core Value

Native desktop app with strong opinions about AI-assisted development workflow.

#### Key Features

1. **Magic Commands**
   - Investigate issues/PRs/workflows
   - Code review with finding tracking
   - AI commit messages
   - PR content generation
   - Merge conflict resolution
   - Release notes generation

2. **Session Management**
   - Multiple sessions per worktree
   - Execution modes: Plan, Build, Yolo
   - Archiving and recovery
   - Auto-naming
   - Canvas views

3. **GitHub Integration**
   - Checkout PRs as worktrees
   - Auto-archive on PR merge
   - Workflow investigation

4. **Developer Tools**
   - Integrated terminal
   - Open in editor (Zed, VS Code, Cursor, Xcode)
   - Git status/diff viewer
   - File tree with preview

5. **Remote Access**
   - Built-in HTTP server
   - WebSocket support
   - Token-based auth

#### What Dispatch Should Steal

1. **Magic commands** for common workflows
2. **Execution modes** (Plan, Build, Yolo)
3. **PR-as-worktree** checkout
4. **Auto-archive on PR merge**

---

## Architecture Patterns That Emerge

### Pattern 1: The SQLite Mail Queue

Every orchestrator that coordinates multiple agents uses SQLite:

```
Agent A                      Agent B
   |                            |
   v                            v
+------+    SQLite WAL    +------+
| send |  ------------->  | recv |
+------+                  +------+
```

Properties:
- WAL mode for concurrent writes
- ~1-5ms latency
- Survives crashes
- Simple schema (from, to, subject, body, type, timestamp)

### Pattern 2: Tiered Health Monitoring

```
Tier 0: Mechanical (tmux/pid liveness)
   |
   v
Tier 1: AI Triage (analyze failure, suggest action)
   |
   v
Tier 2: Monitor Agent (continuous patrol)
```

### Pattern 3: The Worktree-Per-Agent Invariant

Every tool that works uses git worktrees. No exceptions:

```bash
git worktree add ../agent-api feature/api
git worktree add ../agent-ui feature/ui
# Each agent gets isolated working directory
```

### Pattern 4: Capability-Based Agent Roles

```
Scout     → Read-only, exploration
Builder   → Read-write, implementation
Reviewer  → Read-only, validation
Merger    → Write, branch integration
```

### Pattern 5: Status Detection Without Hooks

AMUX pattern: parse ANSI-stripped terminal output to detect:
- Working vs idle
- Waiting for input
- Error state
- Completion

No patches to underlying CLI needed.

---

## Features Dispatch Should Steal/Adapt

### Critical (Must Have)

| Feature | Source | Why |
|---------|--------|-----|
| SQLite message queue | Overstory, AMUX | Universal coordination |
| Self-healing watchdog | AMUX | Unattended operation |
| Notification urgency system | cmux | Attention management |
| Built-in diff viewer | parallel-code | Review bottleneck |
| One-click merge | parallel-code | Review bottleneck |
| Agent capability types | Overstory | Task assignment |
| REST API for agents | AMUX | Inter-agent orchestration |

### High Value (Should Have)

| Feature | Source | Why |
|---------|--------|-----|
| Activity feed TUI | gastown | Fleet visibility |
| Problems view | gastown | Stuck agent detection |
| Kanban auto-assignment | Dorothy | Task pipeline |
| Template variables | Dorothy | Prompt injection |
| Profile system | claude-squad | Agent presets |
| Chat forking | 1code | Context exploration |
| Message queue | 1code | Async prompting |

### Differentiators (Could Have)

| Feature | Source | Why |
|---------|--------|-----|
| Mobile PWA | AMUX | Away-from-desk |
| Telegram/Slack control | Dorothy | Remote management |
| Scriptable browser | cmux | Web dev workflows |
| Magic commands | Jean | Common workflow automation |
| Vault/knowledge base | Dorothy | Cross-agent memory |
| Cloud sandboxes | 1code | Background execution |
| Beads/formula system | gastown | Repeatable workflows |

---

## Gaps in the Market Dispatch Could Fill

### Gap 1: Review-First Architecture

Most tools are build-first: launch agents, hope for the best, deal with merge conflicts. Nobody designs around the human review bottleneck.

**Opportunity**: Design Dispatch's workflow backwards from review. What does the human need to see? How do you minimize merge conflicts? How do you present 5 agents' output coherently?

### Gap 2: Cross-Repo Orchestration

gastown hints at "Orchestrator (multi-repo coordinator of coordinators)" but nobody does this well. Modern codebases span multiple repos.

**Opportunity**: First-class multi-repo support with dependency tracking between repos.

### Gap 3: Goal/Intent Visibility

Your Workspace Groups spec mentions "Goal Overlay" — this is unique. No tool currently shows *what the agent is trying to do* and *what success looks like*.

**Opportunity**: Make agent intent explicit and visible. Show expected patterns, deviation detection, success criteria.

### Gap 4: The Keyboard-Only Experience

cmux gets this partially right, but most tools require mouse for critical actions. Power users want to orchestrate entirely from keyboard.

**Opportunity**: Full keyboard navigation with numbered workspaces, vim-style movement, command palette.

### Gap 5: Intelligent Task Decomposition

Everyone punts this to the human. "Break your work into tasks that can run in parallel" is the entire skill, and no tool helps.

**Opportunity**: AI-assisted decomposition that analyzes a feature spec and suggests parallel-safe tasks with dependency graphs.

---

## Recommended Architecture for Dispatch

Based on this research, here's the recommended architecture:

```
┌────────────────────────────────────────────────────────────────┐
│                        DISPATCH                                 │
├────────────────────────────────────────────────────────────────┤
│  UI Layer (Electron + React)                                   │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐          │
│  │ Canvas   │ │ Terminal │ │ Diff     │ │ Activity │          │
│  │ View     │ │ Grid     │ │ Viewer   │ │ Feed     │          │
│  └──────────┘ └──────────┘ └──────────┘ └──────────┘          │
├────────────────────────────────────────────────────────────────┤
│  Orchestration Layer                                           │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐          │
│  │ Message  │ │ Watchdog │ │ Task     │ │ Merge    │          │
│  │ Queue    │ │ (3-tier) │ │ Router   │ │ Queue    │          │
│  └────┬─────┘ └────┬─────┘ └────┬─────┘ └────┬─────┘          │
│       └────────────┴────────────┴────────────┘                 │
│                        │                                        │
│                   SQLite WAL                                    │
├────────────────────────────────────────────────────────────────┤
│  Agent Layer                                                    │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐          │
│  │ Claude   │ │ Codex    │ │ Gemini   │ │ Custom   │          │
│  │ Adapter  │ │ Adapter  │ │ Adapter  │ │ Adapter  │          │
│  └────┬─────┘ └────┬─────┘ └────┬─────┘ └────┬─────┘          │
│       └────────────┴────────────┴────────────┘                 │
│                        │                                        │
│                   Git Worktrees                                 │
└────────────────────────────────────────────────────────────────┘
```

### Core Components

1. **SQLite Message Queue**
   - WAL mode
   - Typed messages (worker_done, merge_ready, escalation, etc.)
   - Broadcast groups (@all, @builders)
   - Debounced polling

2. **3-Tier Watchdog**
   - Tier 0: Process liveness (mechanical)
   - Tier 1: Output parsing (ANSI → status)
   - Tier 2: AI triage (failure analysis)

3. **Task Router**
   - Capability matching (scout, builder, reviewer)
   - Atomic claiming (SQLite CAS)
   - Priority queuing

4. **Merge Queue**
   - FIFO ordering
   - Conflict detection pre-merge
   - Integrated diff viewer
   - One-click merge action

5. **Agent Adapters**
   - Uniform interface
   - Runtime-specific hooks/guards
   - Session management (spawn, attach, kill)

---

## Conclusion

The multi-agent orchestration space is converging on a shared set of primitives: SQLite coordination, git worktrees, tiered health monitoring, and capability-based agent roles. The gaps are in **review UX**, **cross-repo orchestration**, and **intelligent decomposition**.

Dispatch's Workspace Groups feature is positioned well. The key differentiator will be taking the review/merge experience seriously — that's where all the other tools fall short.

---

*Research compiled for Dispatch (agent-command-center)*  
*Last updated: March 21, 2026*
