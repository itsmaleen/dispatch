# Agent Command Center

Orchestrate AI coding agents from a unified interface. Built around four pillars: **Task Alignment**, **Steerability**, **Verifiability**, and **Adaptability**.

## Vision

An open-source local app that lets you orchestrate multiple AI coding agents (Claude Code, OpenClaw, etc.) with:

- **Planning View**: Describe tasks, see breakdown, confirm before execution
- **Execution View**: TMux-style widget grid for real-time visibility
- **Memory System**: Org-level knowledge that syncs to agent-native formats
- **Integrations**: GitHub, CodeRabbit, Cursor launcher

## Quick Start

```bash
# Install dependencies
bun install

# Start development
bun dev
```

## Architecture

```
┌─────────────────────────────────────┐
│          Browser/Tauri UI           │
│  (React + Tailwind + shadcn/ui)     │
└────────────────┬────────────────────┘
                 │ WebSocket
                 ▼
┌─────────────────────────────────────┐
│       Local Companion Server        │
│  - Claude Code PTY management       │
│  - OpenClaw WebSocket bridge        │
│  - GitHub CLI wrapper               │
│  - Memory sync                      │
└─────────────────────────────────────┘
```

## Packages

- `packages/ui` - React frontend with widget system
- `packages/server` - Node.js companion server
- `packages/contracts` - Shared TypeScript types

## Adapters

| Adapter | Status | Description |
|---------|--------|-------------|
| Claude Code | 🚧 In Progress | PTY-based control |
| OpenClaw | 🚧 In Progress | WebSocket channel |
| Cursor | 📋 Planned | Launcher only |
| Codex | 📋 Planned | PTY-based (T3 Code pattern) |

## Integrations

| Integration | Status | Description |
|-------------|--------|-------------|
| GitHub | 🚧 In Progress | Issues, PRs, worktrees |
| CodeRabbit | 📋 Planned | CLI-based code review |
| Browser | 📋 Planned | URL launcher |

## Widgets

| Widget | Description |
|--------|-------------|
| Log Stream | Real-time stdout/stderr |
| File Diff | Code changes as they happen |
| Terminal | Raw PTY access |
| Chat | Direct agent conversation |
| Status | Agent state indicator |
| Cost Meter | Token usage tracking |

## License

MIT
