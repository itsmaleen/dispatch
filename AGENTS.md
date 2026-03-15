# AGENTS.md

## Task Completion Requirements

- Both `bun lint` and `bun typecheck` must pass before considering tasks completed.
- NEVER run `bun test`. Always use `bun run test` (runs Vitest).
- Server must be rebuilt after changes: `cd packages/server && bun run build`

## Project Snapshot

Dispatch is a desktop app (Electron) for orchestrating AI coding agents. Currently supports Claude Code via the `@anthropic-ai/claude-agent-sdk`.

## Architecture

```
┌─────────────────────────────────┐
│  Electron (React + Vite)        │
│  packages/ui                    │
└──────────┬──────────────────────┘
           │ HTTP + WebSocket
┌──────────▼──────────────────────┐
│  packages/server (Node.js)      │
│  Hono HTTP + WS server          │
│  SessionManager                 │
│  ClaudeCodeAdapter (SDK)        │
└──────────┬──────────────────────┘
           │ @anthropic-ai/claude-agent-sdk
┌──────────▼──────────────────────┐
│  Claude Code CLI (claude)       │
│  User's local installation      │
└─────────────────────────────────┘
```

## Core Priorities

1. **Simple and reliable** - Direct SDK usage, minimal abstraction.
2. **Works with user's Claude auth** - No API keys needed, uses `claude auth login`.
3. **Desktop-first** - Electron spawns server, T3 Code pattern.

## Package Roles

- `packages/ui`: Electron app + React UI. Spawns server as child process.
- `packages/server`: Hono HTTP + WebSocket server. Manages Claude Code sessions.
- `packages/contracts`: Shared TypeScript types and Zod schemas.

## Key Files

- `packages/server/src/adapters/session-manager.ts` - Session lifecycle, SDK query handling
- `packages/server/src/adapters/claude-code.ts` - Direct adapter (alternative path)
- `packages/server/src/persistence/sqlite-store.ts` - Thread/message storage (node:sqlite)
- `packages/ui/electron/main.ts` - Electron main process, server spawn

## Claude Code SDK Usage

We use the official `@anthropic-ai/claude-agent-sdk`:

```typescript
import { query } from '@anthropic-ai/claude-agent-sdk'

const result = query({
  prompt: message,
  options: {
    cwd: projectPath,
    pathToClaudeCodeExecutable: '/path/to/claude',  // IMPORTANT!
    permissionMode: 'bypassPermissions',
    includePartialMessages: true,
  }
})

for await (const event of result) {
  // Handle SDK events
}
```

**Critical**: Always pass `pathToClaudeCodeExecutable` to ensure the SDK uses the user's authenticated Claude CLI.

## Common Issues

1. **"Claude Code process exited with code 1"** - User needs to run `claude auth login`
2. **"Cannot find package 'sqlite'"** - Rebuild server: `cd packages/server && bun run build`
3. **Server not connecting** - Check if port 3333 is in use, run `scripts/clean-dev.sh`

## Development

```bash
# From repo root
bun install
bun run dev        # Starts Vite + Electron + Server

# Rebuild server after changes
cd packages/server
bun run build
```

## Effect Migration (Planned)

See `docs/EFFECT-MIGRATION-PLAN.md` for the roadmap to adopt Effect-TS patterns.
