# ACC Channel Plugin

Native OpenClaw channel plugin for Agent Command Center.

## Quick Install

### From npm (when published)

```bash
openclaw plugins install @acc/channel-plugin
```

### From local path

```bash
git clone https://github.com/moltyfromclaw/agent-command-center.git
cd agent-command-center/packages/acc-channel
pnpm install && pnpm build
openclaw plugins install .
```

### From URL (for remote agents)

```bash
# Download and install
curl -sL https://raw.githubusercontent.com/moltyfromclaw/agent-command-center/main/packages/acc-channel/install.sh | bash
```

## Configuration

Add to your `openclaw.json`:

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

Or use environment variables:

```bash
export ACC_SERVER_URL=ws://localhost:3333/channel
export ACC_AGENT_NAME=my-agent
export ACC_TOKEN=your-token
```

Then restart:

```bash
openclaw gateway restart
```

## Verify Installation

```bash
# Check plugin is loaded
openclaw plugins list

# Check channel status
openclaw channel status acc
```

## Documentation

Full docs: [ACC-CHANNEL-PLUGIN.md](../../docs/ACC-CHANNEL-PLUGIN.md)

## Protocol

The plugin speaks WebSocket to the ACC server:

- **Inbound:** `task.send`, `task.cancel`, `ping`
- **Outbound:** `register`, `task.started`, `content.delta`, `task.completed`, `task.error`

Tasks are executed via OpenClaw's native session spawning with streaming output.
