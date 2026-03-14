# Dispatch

Orchestrate AI coding agents from a unified interface. Built around four pillars: **Task Alignment**, **Steerability**, **Verifiability**, and **Adaptability**.

## Vision

An open-source Electron app that lets you orchestrate multiple AI coding agents (Claude Code, OpenClaw, etc.) with:

- **Planning View**: Describe tasks, see breakdown, confirm before execution
- **Execution View**: TMux-style widget grid for real-time visibility
- **Memory System**: Org-level + project-level knowledge (markdown files)
- **Integrations**: GitHub, CodeRabbit CLI

## Quick Start

```bash
# Install dependencies
bun install

# Build contracts
cd packages/contracts && bun run build

# Start server (port 3333)
cd packages/server && bun run run.ts

# Start UI (separate terminal)
cd packages/ui && bun dev
```

When you run the Electron app (dev or installed), it will auto-start the server if it’s not already running.

## Build

Build all packages (contracts, server, UI):

```bash
bun install
bun run build
```

Build the Electron app and install it to `/Applications` (macOS):

```bash
bun run install:app
```

This produces a DMG under `packages/ui/release/`, mounts it, and copies **Dispatch.app** to `/Applications`. Then run the app from Spotlight (Cmd+Space → “Dispatch”) or:

```bash
open '/Applications/Dispatch.app'
```

The server does not auto-start when running the installed app (it’s not bundled). Start it manually if needed:

```bash
./scripts/start-server.sh
```

## Architecture

```
┌─────────────────────────────────────┐
│         Electron App (UI)           │
│  React 19 + Tailwind + Vite         │
└────────────────┬────────────────────┘
                 │ IPC / WebSocket
                 ▼
┌─────────────────────────────────────┐
│       Local Companion Server        │
│  Hono HTTP + WebSocket (port 3333)  │
├─────────────────────────────────────┤
│  Adapters:                          │
│  - Claude Code (subprocess, -p)     │
│  - OpenClaw (WebSocket + cron API)  │
├─────────────────────────────────────┤
│  Integrations:                      │
│  - GitHub CLI (gh pr, gh issue)     │
│  - CodeRabbit CLI (cr --prompt-only)│
└─────────────────────────────────────┘
```

## Packages

| Package | Description |
|---------|-------------|
| `packages/contracts` | Shared TypeScript types (adapter, events, task, memory, widget) |
| `packages/server` | Hono HTTP server + adapters + WebSocket event streaming |
| `packages/ui` | Electron main/preload + React components |

## Server API

```bash
# Health check
GET /health

# Adapter management
GET    /adapters                    # List all adapters
POST   /adapters                    # Create adapter
POST   /adapters/:id/connect        # Connect to agent
POST   /adapters/:id/disconnect     # Disconnect
POST   /adapters/:id/send           # Send message
POST   /adapters/:id/interrupt      # Interrupt current task
DELETE /adapters/:id                # Remove adapter

# Integrations
POST /coderabbit/review             # Run CodeRabbit CLI
POST /github/pr                     # Create GitHub PR

# WebSocket
ws://localhost:3333                 # Real-time event stream
```

## Adapters

| Adapter | Status | Description |
|---------|--------|-------------|
| Claude Code | ✅ Working | Subprocess with `-p` (print mode) |
| OpenClaw | ✅ Working | WebSocket + cron API dispatch |
| Codex | 📋 Planned | Subprocess-based |

### Claude Code (headless / non-TTY)

When running the server without a TTY (e.g. in the background or from another process), set **`options.autoAccept: true`** so the adapter passes `--dangerously-skip-permissions` to the CLI. Otherwise approval prompts can hang and you may never get results. Optional **`options.turnTimeoutMs`** (e.g. `300000` for 5 minutes) ensures the adapter eventually emits `turn.completed` and returns to `ready` if the subprocess does not exit.

## Event Types

Events stream over WebSocket to the UI:

- `session.started` / `session.ended` - Adapter lifecycle
- `session.state.changed` - Status updates
- `turn.started` / `turn.completed` - Task execution
- `content.delta` - Streaming text output
- `file.changed` - File create/modify/delete
- `item.started` - Tool/command execution

## Development

```bash
# Typecheck all packages
bun run typecheck

# Run server in watch mode
cd packages/server && bun run dev

# Run Electron app (Vite + Electron)
cd packages/ui && bun dev
```

## Stack

- **Runtime**: Bun + Node.js
- **UI**: Electron + React 19 + Tailwind + Vite
- **Server**: Hono + WebSocket (ws)
- **Types**: TypeScript + Zod
- **Monorepo**: Turborepo

## License

MIT
