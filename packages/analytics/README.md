# @dispatch/analytics

Anonymous telemetry for Dispatch. Based on [T3Code's telemetry implementation](https://github.com/pingdotgg/t3code).

## Features

- **Privacy-first**: Uses hashed installation IDs, no PII collection
- **PostHog integration**: Industry-standard product analytics
- **Opt-out support**: Respects user privacy preferences
- **Best-effort**: Never crashes the app, fails silently

## Installation

```bash
bun add @dispatch/analytics
```

## Usage

### Basic Usage

```typescript
import { createAnalytics, DispatchEvents } from '@dispatch/analytics';

const analytics = createAnalytics({
  posthogKey: process.env.DISPATCH_POSTHOG_KEY!,
  appVersion: '0.1.0',
  clientType: 'desktop',
});

// Record events
analytics.record(DispatchEvents.APP_LAUNCHED, {
  platform: process.platform,
});

// On app shutdown
await analytics.shutdown();
```

### Using Environment Variables

```typescript
import { createAnalyticsFromEnv } from '@dispatch/analytics';

const analytics = createAnalyticsFromEnv({
  appVersion: '0.1.0',
  clientType: 'desktop',
});
```

### Testing

```typescript
import { createMockAnalytics } from '@dispatch/analytics';

const analytics = createMockAnalytics();

// Your code that uses analytics...

// Assert events were recorded
const events = analytics.getEvents();
expect(events).toContainEqual({
  event: 'app.launched',
  properties: expect.anything(),
});
```

## Configuration

### Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `DISPATCH_POSTHOG_KEY` | PostHog project API key | Required |
| `DISPATCH_POSTHOG_HOST` | PostHog host URL | `https://us.i.posthog.com` |
| `DISPATCH_TELEMETRY_ENABLED` | Enable/disable telemetry | `true` |

### Programmatic Config

```typescript
interface AnalyticsConfig {
  posthogKey: string;           // Required: PostHog API key
  posthogHost?: string;         // Optional: PostHog host
  enabled?: boolean;            // Optional: Enable/disable (default: true)
  appVersion: string;           // Required: App version
  clientType: 'desktop' | 'cli'; // Required: Client type
  flushBatchSize?: number;      // Optional: Batch size (default: 20)
  maxBufferedEvents?: number;   // Optional: Max buffered (default: 1000)
}
```

## Events

Standard events are defined in `DispatchEvents`:

| Event | Description |
|-------|-------------|
| `app.launched` | App started |
| `app.shutdown` | App closed |
| `session.created` | Agent session created |
| `session.connected` | Agent session connected |
| `session.disconnected` | Agent session disconnected |
| `agent.turn.sent` | Message sent to agent |
| `agent.turn.completed` | Agent response received |
| `task.extracted` | Tasks extracted from conversation |
| `view.changed` | UI view changed |
| `error.occurred` | Error occurred |

## Privacy

### What we collect

- Hashed installation ID (cannot be traced back to you)
- Platform and architecture (darwin/linux/win32, arm64/x64)
- App version
- Event names and metadata (no message content)

### What we DON'T collect

- Personal information
- Message content
- File contents
- API keys or credentials

### Opt-out

Set `DISPATCH_TELEMETRY_ENABLED=false` or pass `enabled: false` in config.

## Getting a PostHog Key

1. Go to [app.posthog.com/signup](https://app.posthog.com/signup)
2. Create a free account (1M events/month free)
3. Go to Project Settings → Project API Key
4. Copy the key to `DISPATCH_POSTHOG_KEY`

## Development

```bash
# Install dependencies
bun install

# Build
bun run build

# Test
bun run test

# Test watch mode
bun run test:watch
```
