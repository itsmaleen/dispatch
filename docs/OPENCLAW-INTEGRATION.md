# OpenClaw Integration Guide

This guide explains how to connect an OpenClaw instance to Dispatch (ACC).

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    ACC Server (Electron)                     │
│                                                              │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐          │
│  │ Claude Code │  │  OpenClaw   │  │  OpenClaw   │          │
│  │   Adapter   │  │  Agent #1   │  │  Agent #2   │    ...   │
│  └──────┬──────┘  └──────┬──────┘  └──────┬──────┘          │
│         │                │                │                  │
│         │           WebSocket         WebSocket              │
│         │          /channel           /channel               │
└─────────┼───────────────┼───────────────┼───────────────────┘
          │               │               │
          │               ▼               ▼
          │        ┌────────────┐  ┌────────────┐
          │        │  OpenClaw  │  │  OpenClaw  │
          │        │ Instance 1 │  │ Instance 2 │
          │        │            │  │            │
          │        │ acc-bridge │  │ acc-bridge │
          │        │   hook     │  │   hook     │
          │        └────────────┘  └────────────┘
          ▼
    ┌────────────┐
    │ Claude CLI │
    │  (local)   │
    └────────────┘
```

## Integration Methods

### Method 1: ACC Bridge Hook (Recommended)

The ACC Bridge Hook runs inside an OpenClaw instance and maintains a persistent WebSocket connection to the ACC server.

#### Installation

1. **Copy the hook to your OpenClaw instance:**

```bash
# Create hooks directory if needed
mkdir -p ~/.openclaw/hooks

# Copy the hook
cp packages/acc-channel/hooks/acc-bridge-hook.mjs ~/.openclaw/hooks/acc-bridge.mjs

# Make executable
chmod +x ~/.openclaw/hooks/acc-bridge.mjs
```

2. **Install dependencies:**

```bash
cd ~/.openclaw/hooks
npm init -y
npm install ws
```

3. **Configure environment variables:**

Create `~/.openclaw/hooks/.env`:
```bash
ACC_URL=ws://your-acc-server:3333/channel
ACC_AGENT_NAME=my-agent
ACC_TOKEN=your-auth-token
ACC_MODEL=anthropic/claude-sonnet-4-20250514
```

4. **Start the hook:**

```bash
# Run directly
node ~/.openclaw/hooks/acc-bridge.mjs

# Or with PM2 for persistence
pm2 start ~/.openclaw/hooks/acc-bridge.mjs --name acc-bridge
pm2 save
```

#### Configuration Options

| Variable | Default | Description |
|----------|---------|-------------|
| `ACC_URL` | `ws://localhost:3333/channel` | ACC server WebSocket URL |
| `ACC_AGENT_NAME` | `openclaw-agent` | Agent identifier in ACC |
| `ACC_TOKEN` | `dev-token` | Authentication token |
| `ACC_MODEL` | `anthropic/claude-sonnet-4-20250514` | Model for task execution |

### Method 2: Config-Receiver (Docker/EC2)

For OpenClaw instances deployed via Docker or the deploy service, you can use the existing config-receiver with callbacks.

#### Setup

1. **Update ACC server URL in adapter config:**

```javascript
{
  "id": "remote-agent",
  "kind": "openclaw",
  "options": {
    "gatewayUrl": "http://your-instance:18790",
    "gatewayToken": "your-gateway-token",
    "callbackUrl": "http://your-acc-server:3333/webhook/results"
  }
}
```

2. **Add webhook endpoint to ACC server** (if not already present):

The ACC server handles callbacks at `/webhook/results`.

## Protocol Reference

### WebSocket Messages (Agent → ACC)

#### register
Sent immediately after connection.
```json
{
  "type": "register",
  "metadata": {
    "agentName": "my-agent",
    "capabilities": ["streaming", "spawn", "tools"],
    "model": "anthropic/claude-sonnet-4-20250514",
    "version": "1.0.0"
  }
}
```

#### task.started
Acknowledge task receipt.
```json
{
  "type": "task.started",
  "taskId": "uuid",
  "metadata": { "startedAt": "ISO-8601" }
}
```

#### content.delta
Stream content during execution.
```json
{
  "type": "content.delta",
  "taskId": "uuid",
  "content": "partial response text..."
}
```

#### task.completed
Task finished successfully.
```json
{
  "type": "task.completed",
  "taskId": "uuid",
  "content": "full response",
  "status": "completed",
  "metadata": { "durationMs": 1234 }
}
```

#### task.error
Task failed.
```json
{
  "type": "task.error",
  "taskId": "uuid",
  "error": "error message",
  "status": "failed"
}
```

### WebSocket Messages (ACC → Agent)

#### task.send
Execute a task.
```json
{
  "type": "task.send",
  "taskId": "uuid",
  "message": "Task instructions..."
}
```

#### task.cancel
Cancel a running task.
```json
{
  "type": "task.cancel",
  "taskId": "uuid"
}
```

#### ping
Heartbeat check.
```json
{ "type": "ping" }
```

## Testing the Integration

### 1. Start ACC Server

```bash
cd agent-command-center/packages/server
bun run.ts
```

### 2. Start the Bridge Hook

```bash
ACC_URL=ws://localhost:3333/channel \
ACC_AGENT_NAME=test-agent \
node ~/.openclaw/hooks/acc-bridge.mjs
```

### 3. Verify Connection

```bash
# List connected agents
curl http://localhost:3333/agents
# Should show: {"agents":[{"name":"test-agent",...}]}
```

### 4. Send a Task

```bash
curl -X POST http://localhost:3333/agents/test-agent/task \
  -H "Content-Type: application/json" \
  -d '{"message": "What is 2+2?"}'
```

### 5. Check Results

The ACC server logs will show:
```
Agent registered: test-agent with capabilities: [ 'streaming', 'spawn', 'tools' ]
Task started on test-agent: <taskId>
Task completed on test-agent: <taskId>
```

## Troubleshooting

### Agent not connecting

1. Check ACC server is running: `curl http://localhost:3333/health`
2. Check WebSocket URL is correct (use `ws://` not `http://`)
3. Check firewall allows connections

### Tasks timing out

1. Check agent has network access to LLM provider
2. Increase timeout in hook config
3. Check model is available

### Tasks failing

1. Check OpenClaw CLI is in PATH: `which openclaw`
2. Check model API keys are configured
3. Check hook logs: `tail -f /tmp/acc-bridge.log`

## Security Considerations

1. **Token Authentication**: Always use strong tokens in production
2. **HTTPS/WSS**: Use secure WebSocket (wss://) in production
3. **Network Isolation**: Consider running ACC server on private network
4. **Rate Limiting**: Implement rate limiting for task submissions
