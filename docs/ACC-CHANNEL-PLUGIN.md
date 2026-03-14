# ACC Channel Plugin for OpenClaw

> Native channel plugin that makes Dispatch a first-class OpenClaw surface (like Telegram/Discord).

## Overview

Instead of using a hook + CLI spawning, this plugin integrates ACC directly into OpenClaw's channel system:

```
ACC Server ←WebSocket→ OpenClaw (acc channel) ←direct→ Agent Sessions
```

**Benefits:**
- No CLI spawn overhead (~1-2s saved per task)
- Direct session access with streaming
- Proper lifecycle management
- Multi-session support
- Standard OpenClaw config/auth patterns

## Quick Install

```bash
# Install from npm (when published)
openclaw plugins install @openclaw/acc-channel

# Or install from local path
openclaw plugins install /path/to/acc-channel
```

Then configure in `openclaw.json`:

```json
{
  "channels": {
    "acc": {
      "enabled": true,
      "accounts": {
        "default": {
          "serverUrl": "ws://localhost:3333/channel",
          "agentName": "my-agent",
          "token": "your-acc-token"
        }
      }
    }
  }
}
```

Restart the gateway: `openclaw gateway restart`

## Protocol

### Connection

The plugin maintains a persistent WebSocket to the ACC server:

```
ws://<serverUrl>/channel
Headers:
  Authorization: Bearer <token>
  X-Agent-Name: <agentName>
```

### Messages (ACC → OpenClaw)

#### `task.send`
```json
{
  "type": "task.send",
  "taskId": "uuid",
  "message": "Fix the login bug",
  "context": {
    "projectPath": "/path/to/project",
    "files": ["src/auth.ts"]
  }
}
```

#### `task.cancel`
```json
{
  "type": "task.cancel",
  "taskId": "uuid"
}
```

#### `ping`
```json
{ "type": "ping" }
```

### Messages (OpenClaw → ACC)

#### `register`
```json
{
  "type": "register",
  "metadata": {
    "agentName": "my-agent",
    "capabilities": ["streaming", "tools", "spawn"],
    "model": "anthropic/claude-sonnet-4-20250514",
    "version": "1.0.0"
  }
}
```

#### `task.started`
```json
{
  "type": "task.started",
  "taskId": "uuid",
  "metadata": { "startedAt": "2026-03-12T20:00:00Z" }
}
```

#### `content.delta`
```json
{
  "type": "content.delta",
  "taskId": "uuid",
  "content": "Analyzing the auth module..."
}
```

#### `task.completed`
```json
{
  "type": "task.completed",
  "taskId": "uuid",
  "content": "Fixed the login bug by...",
  "status": "completed",
  "metadata": {
    "durationMs": 45000,
    "tokensUsed": 1234
  }
}
```

#### `task.error`
```json
{
  "type": "task.error",
  "taskId": "uuid",
  "error": "Task timeout",
  "status": "failed"
}
```

## Config Reference

```json5
{
  "channels": {
    "acc": {
      "enabled": true,
      // Optional: default account to use
      "defaultAccount": "default",
      
      "accounts": {
        "default": {
          "enabled": true,
          // ACC server WebSocket URL
          "serverUrl": "ws://localhost:3333/channel",
          // Agent name shown in ACC dashboard
          "agentName": "openclaw-agent",
          // Auth token (or use ACC_TOKEN env var)
          "token": "your-token",
          // Optional: model override for this account
          "model": "anthropic/claude-sonnet-4-20250514",
          // Optional: task timeout in ms
          "taskTimeout": 300000,
          // Optional: reconnect interval in ms
          "reconnectInterval": 5000
        },
        // Multiple ACC servers supported
        "production": {
          "serverUrl": "wss://acc.example.com/channel",
          "agentName": "prod-agent",
          "token": "${ACC_PROD_TOKEN}"
        }
      }
    }
  }
}
```

## Environment Variables

| Variable | Description |
|----------|-------------|
| `ACC_TOKEN` | Default auth token |
| `ACC_SERVER_URL` | Default server URL |
| `ACC_AGENT_NAME` | Default agent name |

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                         Dispatch                             │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐         │
│  │   Task UI   │  │  Dashboard  │  │   Widgets   │         │
│  └──────┬──────┘  └──────┬──────┘  └──────┬──────┘         │
│         │                │                │                 │
│         └────────────────┼────────────────┘                 │
│                          ▼                                  │
│                 ┌─────────────────┐                         │
│                 │   ACC Server    │                         │
│                 │  (WebSocket)    │                         │
│                 └────────┬────────┘                         │
└──────────────────────────┼──────────────────────────────────┘
                           │ WebSocket
                           ▼
┌──────────────────────────────────────────────────────────────┐
│                      OpenClaw Gateway                         │
│  ┌────────────────────────────────────────────────────────┐  │
│  │               ACC Channel Plugin                        │  │
│  │  ┌──────────┐  ┌──────────┐  ┌──────────┐             │  │
│  │  │ Inbound  │  │ Session  │  │ Outbound │             │  │
│  │  │ Handler  │→ │ Manager  │→ │ Streamer │             │  │
│  │  └──────────┘  └──────────┘  └──────────┘             │  │
│  └────────────────────────────────────────────────────────┘  │
│                          │                                    │
│                          ▼                                    │
│  ┌────────────────────────────────────────────────────────┐  │
│  │              Agent Session (Claude, etc.)               │  │
│  │  - Tools access                                         │  │
│  │  - File operations                                      │  │
│  │  - Memory context                                       │  │
│  └────────────────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────────────┘
```

## Implementation Details

### Session Management

Tasks create isolated sessions via `sessions_spawn`:
- Each task gets a fresh session
- Session inherits workspace context
- Results stream back via `content.delta`
- Session cleanup on completion/cancel

### Streaming

The plugin uses OpenClaw's native streaming:
1. Task arrives via WebSocket
2. Plugin spawns isolated session
3. Output chunks → `content.delta` messages
4. Final result → `task.completed`

### Reconnection

The plugin handles disconnects gracefully:
- Exponential backoff on reconnect
- Re-registers agent on reconnect
- Active tasks continue (results buffered)

## Comparison with Hook Approach

| Aspect | Hook + CLI | Native Channel |
|--------|-----------|----------------|
| Latency | ~1-2s spawn overhead | Direct, ~10ms |
| Streaming | Via stdout capture | Native streaming |
| Session access | CLI only | Full API |
| Config | Separate hook file | Standard channel config |
| Multi-account | Manual | Built-in |
| Lifecycle | Hook process | Gateway managed |

## Development

### Local Development

```bash
cd packages/acc-channel
pnpm install
pnpm build

# Link to OpenClaw
openclaw plugins install -l .
```

### Testing

```bash
# Start ACC server
cd packages/server && pnpm dev

# In another terminal, restart OpenClaw gateway
openclaw gateway restart

# Check plugin loaded
openclaw plugins list
# Should show: acc (enabled)

# Check channel status
openclaw channel status acc
```

## Troubleshooting

### "Connection refused"
- Check ACC server is running
- Verify `serverUrl` is correct
- Check firewall/network

### "Unauthorized"
- Verify token matches ACC server config
- Check `Authorization` header format

### "Agent not registering"
- Check `agentName` is unique
- Look at ACC server logs
- Verify WebSocket upgrade succeeds

### Tasks not streaming
- Check `content.delta` handler in ACC UI
- Verify session spawning works: `openclaw agent --local "test"`

## Next Steps

1. **Implement plugin** - See `packages/acc-channel/src/`
2. **Test locally** - Use development setup above
3. **Publish to npm** - `@openclaw/acc-channel`
4. **Add to OpenClaw docs** - Submit PR to docs.openclaw.ai
