# Activity Log Fix v2 - Complete Diagnosis

## Root Cause Found

**The SDK is NOT emitting `stream_event` messages because we're missing a required option!**

### SDK Option Discovery
```typescript
// From @anthropic-ai/claude-agent-sdk/sdk.d.ts:

/**
 * Include partial/streaming message events in the output.
 * When true, `SDKPartialAssistantMessage` events will be emitted during streaming.
 */
includePartialMessages?: boolean;
```

**We never set `includePartialMessages: true`**, so the SDK only emits final messages (`user`, `assistant`, `result`), not streaming events.

---

## What We're Currently Getting (from logs)

```
[SDK] user                  ← User message (our prompt)
[SDK] Unhandled: user       ← We don't handle this
[SDK] assistant             ← Full response (no streaming)
[SDK] user                  ← Tool result (if any)
```

## What We SHOULD Be Getting (with `includePartialMessages: true`)

```
[SDK] user
[SDK] stream_event          ← content_block_start (thinking)
[SDK] stream_event          ← content_block_delta (thinking text)
[SDK] stream_event          ← content_block_stop
[SDK] stream_event          ← content_block_start (tool_use: "Read")
[SDK] stream_event          ← content_block_delta (input_json)
[SDK] stream_event          ← content_block_stop
[SDK] tool_use_summary      ← Tool completed
[SDK] assistant             ← Full message
[SDK] user                  ← Tool result
[SDK] stream_event          ← content_block_start (text)
[SDK] stream_event          ← content_block_delta (text)
[SDK] stream_event          ← content_block_stop
[SDK] assistant             ← Final response
[SDK] result                ← Usage/cost
```

---

## The Fix

### 1. Add `includePartialMessages: true` to SDK options

**File:** `packages/server/src/adapters/claude-code.ts`

```typescript
// In processNextMessage(), add to sdkOptions:
const sdkOptions: Options = {
  cwd: this.config.cwd ?? process.cwd(),
  permissionMode: this.config.options?.permissionMode ?? 'bypassPermissions',
  includePartialMessages: true,  // ← ADD THIS
  // ... rest of options
};
```

### 2. Handle all SDK message types properly

The SDK emits these message types (from `SDKMessage` union):
- `user` - User messages (ignore)
- `assistant` - Full assistant message
- `stream_event` - Streaming events (SDKPartialAssistantMessage)
- `result` - Usage/cost data
- `system` - Status updates
- `tool_progress` - Long-running tool progress
- `tool_use_summary` - Tool completion summary
- `task_started` / `task_progress` - Task lifecycle

### 3. Map SDK events to activities

| SDK Event Type | Activity Type | Label |
|----------------|---------------|-------|
| `stream_event` → `content_block_start` (tool_use) | file_read/file_write/command | "Reading file" / "Editing file" / "Running command" |
| `stream_event` → `content_block_start` (thinking) | thinking | "Thinking..." |
| `stream_event` → `content_block_delta` (input_json_delta) | (update detail) | - |
| `stream_event` → `content_block_stop` | (mark completed) | - |
| `tool_use_summary` | tool | Tool name from summary |
| `tool_progress` | tool | Tool name + elapsed time |

---

## Implementation Steps

1. [ ] Add `includePartialMessages: true` to SDK options
2. [ ] Verify `stream_event` messages start appearing in logs
3. [ ] Existing `handleStreamEvent()` logic should then work
4. [ ] Test with real task that reads/writes files

---

## SDK Message Type Reference

```typescript
// SDKPartialAssistantMessage (what stream_event contains)
type SDKPartialAssistantMessage = {
  type: 'stream_event';
  event: BetaRawMessageStreamEvent;  // This is the Anthropic API event
  parent_tool_use_id: string | null;
  uuid: UUID;
  session_id: string;
};

// BetaRawMessageStreamEvent contains:
// - content_block_start
// - content_block_delta
// - content_block_stop
// - message_start
// - message_delta
// - message_stop
```

---

## Other Potentially Useful SDK Messages

### SDKToolUseSummaryMessage
```typescript
type SDKToolUseSummaryMessage = {
  type: 'tool_use_summary';
  summary: string;              // Human-readable summary
  preceding_tool_use_ids: string[];
  uuid: UUID;
  session_id: string;
};
```
→ Could emit as activity with the summary text

### SDKToolProgressMessage
```typescript
type SDKToolProgressMessage = {
  type: 'tool_progress';
  tool_name: string;
  elapsed_time_seconds: number;
  // ...
};
```
→ Already handling this one

---

## Testing

After fix, logs should show:
```
[SDK] user
[SDK] stream_event/message_start
[SDK] stream_event/content_block_start (tool_use: Read)
[SDK] stream_event/content_block_delta (input_json_delta)
[SDK] stream_event/content_block_stop
[SDK] tool_use_summary
...
```

And UI should show:
- "Reading file: src/App.tsx" (running)
- "Reading file: src/App.tsx" (completed)
- etc.
