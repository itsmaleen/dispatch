# Multi-Agent Orchestration Landscape (March 2026)

Research on tools forking or building alternatives to cmux/t3code, and their approaches to multi-agent interaction.

## The Core Problem

> "All the exciting AI coding is happening in terminals. If you're doing multi-agent orchestration you're generally using terminal UIs roped together with Gastown, agent-deck, OpenClaw, lemonaid, or something else."
> — Joe Blubaugh

The fundamental stack everyone converges on: **tmux + git worktrees + sqlite**

## Categories of Solutions

### 1. Terminal Multiplexers (cmux/t3code space)

| Tool | Description | Key Features |
|------|-------------|--------------|
| [cmux](https://github.com/manaflow-ai/cmux) | Native macOS on libghostty | Vertical tabs, notification rings, built-in browser, GPU-accelerated. 7.7k stars in first month. |
| [t3code](https://github.com/pingdotgg/t3code) | Minimal web GUI for coding agents | Codex-first, Claude Code coming soon |
| [NTM](https://github.com/named-tmux-manager/ntm) | tmux wrapper | Named panes, cross-platform |
| [superset](https://github.com/superset-sh/superset) | "Terminal built for coding agents" | Agent-focused UX |
| [ghast](https://github.com/aidenybai/ghast) | Multitask with multiple terminals | Lightweight |
| [dmux](https://github.com/standardagents/dmux) | Parallel agents | tmux + worktrees integration |

### 2. Unattended Agent Farms

| Tool | Description | Key Features |
|------|-------------|--------------|
| [AMUX](https://github.com/mixpeek/amux) | Run dozens of agents unattended | Self-healing watchdog (auto-compact on context overflow, restart + replay on crash), agent-to-agent delegation via REST API, mobile PWA, atomic task claiming via SQLite CAS. Single Python file, no build step. |
| [Warp Oz](https://www.warp.dev/oz) | Cloud-hosted orchestration | Cron triggers, multi-repo changes, programmable SDK, flexible hosting (yours or theirs) |

### 3. Desktop Orchestrators

| Tool | Description | Key Features |
|------|-------------|--------------|
| [1code](https://github.com/21st-dev/1code) | UI for Claude Code | Local + remote agent execution |
| [constellagent](https://github.com/owengretzinger/constellagent) | macOS app | Terminal + editor + git worktree per agent |
| [parallel-code](https://github.com/johannesjo/parallel-code) | Desktop orchestrator | Built-in diff viewer, one-click merge, supports Claude/Codex/Gemini |
| [jean](https://github.com/coollabsio/jean) | Desktop/web app (coolify team) | Orchestrate across projects and worktrees |
| [dorothy](https://github.com/Charlie85270/Dorothy) | Desktop with Kanban | Automations, Kanban management, MCP servers |
| [ai-maestro](https://github.com/23blocks-OS/ai-maestro) | Dashboard | Orchestrate Claude, Aider, Cursor across machines |
| [crystal](https://github.com/stravu/crystal) | Parallel sessions | Codex + Claude Code in parallel worktrees |

### 4. Swarm Coordinators

| Tool | Description | Key Features |
|------|-------------|--------------|
| [Overstory](https://github.com/jayminwest/overstory) | Multi-agent orchestration | SQLite mail system, tiered conflict resolution, pluggable runtimes (Claude, Pi, Gemini, Codex, Cursor), coordinator + worker pattern |
| [ClawTeam](https://github.com/HKUDS/ClawTeam) | Agent Swarm Intelligence | "One Command → Full Automation" |
| [gastown](https://github.com/steveyegge/gastown) | Multi-agent orchestration (Steve Yegge) | Persistent work tracking, beads system |
| [kodo](https://github.com/ikamensh/kodo) | Autonomous orchestrator | Directs Claude/Codex/Gemini through work cycles with independent verification |
| [claude-flow](https://github.com/ruvnet/claude-flow) | Multi-agent swarms | Coordinated workflows |
| [ORCH](https://github.com/oxgeneral/ORCH) | CLI runtime | Typed agent teams with state machine, goals, and TUI |

### 5. Autonomous Loop Runners

| Tool | Description | Key Features |
|------|-------------|--------------|
| [ralph-orchestrator](https://github.com/mikeyobrien/ralph-orchestrator) | Hat-based orchestration | Keeps agents in loop until done |
| [ralph-tui](https://github.com/subsy/ralph-tui) | TUI orchestrator | Work through task lists autonomously |
| [ralphy](https://github.com/michaelshimeles/ralphy) | Simple loop runner | Runs agents until done |
| [wreckit](https://github.com/mikehostetler/wreckit) | Roadmap runner | Ralph Wiggum Loop over your roadmap |

### 6. Context Forking (Kaushik Gopal's approach)

[Blog post](https://kau.sh/blog/agent-forking/)

A thin bash + tmux script that:
1. Captures transcript from current session
2. Optionally summarizes (if too long)
3. Seeds a new agent with that context

Key insights:
- **Tool-agnostic**: Start in Codex, fork into Claude Code
- **Interactive, not one-shot**: Subagents need real sessions you can keep talking to
- **No context bloat**: Tangents stay out of main session
- **Label the subagents**: Simple tmux window naming for tracking

### 7. Kanban-Based Coordination

| Tool | Description |
|------|-------------|
| [openkanban](https://github.com/techdufus/openkanban) | TUI kanban for orchestrating agents |
| [vibe-kanban](https://github.com/BloopAI/vibe-kanban) | Kanban board for managing agents |

## Key Differentiation Angles

| Approach | Problem Solved | Examples |
|----------|----------------|----------|
| **Attention Management** | Know when agents finish/error without watching | cmux (notification rings), AMUX (mobile PWA) |
| **Unattended Operation** | Agents die overnight from context overflow | AMUX (self-healing watchdog, auto-compact, restart + replay) |
| **Context Isolation** | Merge conflicts when multiple agents edit same files | Git worktrees (everyone uses this) |
| **Agent-to-Agent Comms** | Agents need to delegate/coordinate | SQLite mail queues (Overstory), REST API (AMUX), shared memory files |
| **Review UX** | Reviewing agent output is the bottleneck | Built-in diff viewers (parallel-code), one-click merge |
| **Mobile Control** | Monitor agents away from desk | PWA dashboards (AMUX), Warp mobile |
| **Task Claiming** | Multiple agents racing for same work | Atomic SQLite CAS (AMUX) |

## The "Agentmaxxing" Pattern

From [vibecoding.app](https://vibecoding.app/blog/agentmaxxing):

The workflow:
1. **Decompose** — Break work into parallel-safe tasks
2. **Launch** — Spin up agents in separate worktrees
3. **Review** — Watch for stuck agents, validate output
4. **Merge** — Resolve conflicts, run tests

> "The bottleneck shifted from 'the AI is too slow' to 'I can only review so fast.'"

Key tools mentioned:
- cmux / NTM for terminal orchestration
- AMUX for unattended agent farms
- Claude Code Agent Teams for native coordination
- Wispr Flow for voice-driven prompting
- Codex for cloud-based parallel agents
- Git worktrees for isolation

## Infrastructure Primitives

Everyone converges on:

1. **tmux** — Pane/window management, session persistence
2. **git worktrees** — Isolated working directories per agent
3. **SQLite** — Communication queues, state tracking, atomic operations

## Relevant to Dispatch

For Workspace Groups feature, key learnings:

1. **Notification/attention system** is crucial — cmux's rings, badges
2. **One-click merge** from review UI is high value
3. **Agent status detection** without hooks (AMUX parses ANSI output)
4. **Context forking** could be a Dispatch primitive
5. **Kanban view** for task assignment is common pattern
6. **Mobile/PWA** for away-from-desk monitoring

## Sources

- [awesome-agent-orchestrators](https://github.com/andyrewlee/awesome-agent-orchestrators) — Comprehensive list
- [Agentmaxxing guide](https://vibecoding.app/blog/agentmaxxing)
- [Agent forking with tmux](https://kau.sh/blog/agent-forking/)
- [Multi-agent coding and terminal resurgence](https://joeblu.com/blog/2026_02_multi-agent-coding-and-the-resurgence-of-the-terminal/)
- [AMUX](https://amux.io/)
- [Warp Oz](https://www.warp.dev/oz)
- [Overstory](https://github.com/jayminwest/overstory)

---

*Last updated: 2026-03-21*
