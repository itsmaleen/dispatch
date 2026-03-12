# Testing Agent Command Center

## Prerequisites

```bash
cd agent-command-center
bun install
```

## Start the Server

```bash
cd packages/server
bun run.ts
# Server runs on http://localhost:3333
```

## Test Claude Code Adapter

### 1. Create Adapter
```bash
curl -X POST http://localhost:3333/adapters \
  -H "Content-Type: application/json" \
  -d '{
    "id": "cc1",
    "kind": "claude-code",
    "name": "Claude Code",
    "cwd": "/tmp",
    "options": {
      "model": "sonnet"
    }
  }'
```

### 2. Connect
```bash
curl -X POST http://localhost:3333/adapters/cc1/connect
```

### 3. Send Message
```bash
curl -X POST http://localhost:3333/adapters/cc1/send \
  -H "Content-Type: application/json" \
  -d '{"message": "What is 2+2? Reply with just the number."}'
```

### 4. Check State
```bash
curl http://localhost:3333/adapters | jq '.adapters[0].state'
```

### 5. View Server Logs
Check `/tmp/acc-server.log` for Claude Code output.

### Notes
- Uses `claude -p` (print mode) for single-shot execution
- Each `send` spawns a new Claude process
- State transitions: disconnected → connecting → ready → running → ready

## Test OpenClaw Adapter

### 1. Get Gateway Info
Your OpenClaw config is at `~/.openclaw/openclaw.json`. Find:
- `gateway.port` (default: 18789)
- `gateway.auth.token`

### 2. Create Adapter
```bash
curl -X POST http://localhost:3333/adapters \
  -H "Content-Type: application/json" \
  -d '{
    "id": "oc1",
    "kind": "openclaw",
    "name": "OpenClaw Local",
    "options": {
      "gatewayUrl": "http://localhost:18789",
      "gatewayToken": "YOUR_TOKEN_HERE",
      "model": "groq/llama-3.3-70b-versatile"
    }
  }'
```

### 3. Connect
```bash
curl -X POST http://localhost:3333/adapters/oc1/connect
```

### 4. Send Message
```bash
curl -X POST http://localhost:3333/adapters/oc1/send \
  -H "Content-Type: application/json" \
  -d '{"message": "What is 2+2?"}'
```

### Notes
- Spawns an isolated session via `/api/sessions/spawn`
- Polls for completion every 5 seconds
- Results arrive via polling (no streaming)

## Test with Remote OpenClaw (EC2)

### 1. Get Instance Info
From deploy service or your agent fleet:
- Tunnel URL (e.g., `https://dottie.viewholly.com`)
- Gateway token

### 2. Create Adapter
```bash
curl -X POST http://localhost:3333/adapters \
  -H "Content-Type: application/json" \
  -d '{
    "id": "ec2-agent",
    "kind": "openclaw",
    "name": "EC2 Agent",
    "options": {
      "gatewayUrl": "https://YOUR-AGENT.viewholly.com",
      "gatewayToken": "YOUR_GATEWAY_TOKEN",
      "model": "moonshot/kimi-k2.5"
    }
  }'
```

## WebSocket Events

Connect to `ws://localhost:3333` to receive real-time events:

```javascript
const ws = new WebSocket('ws://localhost:3333');
ws.onmessage = (e) => console.log(JSON.parse(e.data));
```

Event types:
- `session.started` / `session.ended`
- `session.state.changed`
- `turn.started` / `turn.completed`
- `content.delta` (streaming text)

## Cleanup

```bash
# Delete adapter
curl -X DELETE http://localhost:3333/adapters/cc1

# Stop server
pkill -f "bun run.ts"
```
