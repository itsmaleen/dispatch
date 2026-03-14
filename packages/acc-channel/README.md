# ACC Channel Plugin

Native OpenClaw channel plugin for Dispatch.

## Build

From the **repo root** (recommended; installs workspace deps and builds this package):

```bash
cd agent-command-center   # or your clone path
bun install
bun run build
```

From **this package only** (if the repo is already built):

```bash
cd packages/acc-channel
bun install
bun run build
```

Output: `dist/index.js` and `dist/index.d.ts`. The plugin is loaded via `dist/index.js` in `package.json` `openclaw.extensions`.

## Quick Install

### From npm (when published)

```bash
openclaw plugins install @acc/channel-plugin
```

### From local path

```bash
git clone https://github.com/moltyfromclaw/agent-command-center.git
cd agent-command-center
bun install
bun run build
cd packages/acc-channel
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
