# Testing Dispatch

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
Use `autoAccept: true` for headless/non-TTY so the CLI does not hang on approval prompts. Optional `turnTimeoutMs` ensures the adapter eventually completes.

```bash
curl -X POST http://localhost:3333/adapters \
  -H "Content-Type: application/json" \
  -d '{
    "id": "cc1",
    "kind": "claude-code",
    "name": "Claude Code",
    "cwd": "/tmp",
    "options": {
      "model": "sonnet",
      "autoAccept": true,
      "turnTimeoutMs": 300000
    }
  }'
```

### 2. Connect
```bash
curl -X POST http://localhost:3333/adapters/cc1/connect
```

### 3. View the result (run in a second terminal)
Output is streamed over the WebSocket only. Run the watch script, then send a message from another terminal to see the reply.

**Terminal A** (watch output):
```bash
cd packages/server
bun run watch-output
```

**Terminal B** (send message):
```bash
curl -X POST http://localhost:3333/adapters/cc1/send \
  -H "Content-Type: application/json" \
  -d '{"message": "What is 2+2? Reply with just the number."}'
```

**Expected in Terminal A:**
```
Connected to ws://localhost:3333 - send a message to an adapter to see output.

2+2 equals 4.

--- turn.completed: completed ---
```

### 4. Check State
```bash
curl http://localhost:3333/adapters | jq '.adapters[0].state'
```
After a turn finishes, `status` should be `ready` and `activeTurnId` should be absent.

### 5. Server logs
Server stdout shows adapter lifecycle: `Claude Code process spawned, stdin closed`, `Claude Code first output received`, `Claude Code exited with code 0 (...ms)`.

### Notes
- Uses `claude -p` (print mode) for single-shot execution
- Each `send` spawns a new Claude process
- State transitions: disconnected → connecting → ready → running → ready

## Test OpenClaw Adapter

The OpenClaw adapter uses the config-receiver `/task` endpoint, which is installed on docker/EC2 agents.

### Prerequisites
- A running OpenClaw instance with config-receiver (docker or EC2)
- The instance's tunnel URL (e.g., `https://agent-name.viewholly.com`)
- The gateway token

### 1. Check Instance Status
```bash
curl https://YOUR-AGENT.viewholly.com/status
# Should return {"status":"idle","busy":false}
```

### 2. Create Adapter
```bash
curl -X POST http://localhost:3333/adapters \
  -H "Content-Type: application/json" \
  -d '{
    "id": "oc1",
    "kind": "openclaw",
    "name": "Remote Agent",
    "options": {
      "gatewayUrl": "https://YOUR-AGENT.viewholly.com",
      "gatewayToken": "YOUR_GATEWAY_TOKEN",
      "model": "moonshot/kimi-k2.5"
    }
  }'
```

### 3. Connect
```bash
curl -X POST http://localhost:3333/adapters/oc1/connect
```

### 4. Send Task
```bash
curl -X POST http://localhost:3333/adapters/oc1/send \
  -H "Content-Type: application/json" \
  -d '{"message": "What is 2+2?"}'
```

### Notes
- Uses config-receiver `/task` endpoint
- Agent runs task in isolated session
- Results retrieved via polling (config-receiver v2.17+ supports callbacks)

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
