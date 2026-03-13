# T3 Code vs ACC: Claude Code Adapter Comparison

## Executive Summary

**T3 Code uses the official `@anthropic-ai/claude-agent-sdk`** - a proper programmatic SDK maintained by Anthropic. We're spawning raw subprocesses with `-p` flag.

**Rating: T3 Code approach is significantly better for Claude Code integration.**

---

## Architecture Comparison

### T3 Code Approach

```
┌─────────────────────────────────────────────────────────┐
│ T3 Server                                               │
│                                                         │
│  ┌─────────────────────────────────────────────────┐   │
│  │ ClaudeCodeAdapter                                │   │
│  │                                                  │   │
│  │  promptQueue ──────► SDK query() ──────► Events │   │
│  │  (async iterable)    (persistent)    (SDKMessage)│   │
│  │                                                  │   │
│  │  canUseTool callback ◄─── SDK permission request │   │
│  └─────────────────────────────────────────────────┘   │
│                           │                             │
│                           ▼                             │
│  ┌─────────────────────────────────────────────────┐   │
│  │ @anthropic-ai/claude-agent-sdk                   │   │
│  │ - Manages subprocess lifecycle                   │   │
│  │ - JSON-RPC protocol handling                    │   │
│  │ - Structured event emission                      │   │
│  │ - Session resume/restore                         │   │
│  └─────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────┘
```

### ACC Approach (Current)

```
┌─────────────────────────────────────────────────────────┐
│ ACC Server                                              │
│                                                         │
│  ┌─────────────────────────────────────────────────┐   │
│  │ ClaudeCodeAdapter                                │   │
│  │                                                  │   │
│  │  spawn('claude', ['-p']) ──► stdout parsing     │   │
│  │  stdin.write(message)                            │   │
│  │  stdin.end()                                     │   │
│  │                                                  │   │
│  │  Manual event detection via regex               │   │
│  └─────────────────────────────────────────────────┘   │
│                           │                             │
│                           ▼                             │
│  ┌─────────────────────────────────────────────────┐   │
│  │ Raw subprocess                                   │   │
│  │ - No session persistence                         │   │
│  │ - Unstructured text output                       │   │
│  │ - No permission callbacks                        │   │
│  └─────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────┘
```

---

## Feature Comparison

| Feature | T3 Code | ACC | Notes |
|---------|---------|-----|-------|
| **SDK** | `@anthropic-ai/claude-agent-sdk` | Raw subprocess | T3 uses official SDK |
| **Session Lifecycle** | Persistent, resumable | Fresh per turn | SDK tracks session state |
| **Event Format** | `SDKMessage` (50+ types) | Raw text parsing | SDK emits structured events |
| **Permission Handling** | `canUseTool` callback | `--dangerously-skip-permissions` | SDK enables approval UI |
| **Model Switching** | `setModel()` in-session | N/A (new process) | SDK supports hot-swap |
| **Interrupt** | `query.interrupt()` | SIGINT | SDK handles gracefully |
| **Message Input** | Queue → async iterable | CLI arg or stdin | SDK pattern more robust |
| **Streaming** | Native via SDK events | stdout chunks | SDK provides proper deltas |
| **Session Resume** | `resume` + `resumeSessionAt` | None | SDK supports conversation continuity |
| **Error Handling** | Typed `SDKResultMessage` | Exit code + stderr | SDK provides structured errors |
| **Thinking/Reasoning** | `stream_event` with delta type | Regex detection | SDK labels content types |
| **Tool Tracking** | `content_block_start/stop` | Regex detection | SDK tracks tool lifecycle |
| **Cost/Usage** | `result.total_cost_usd`, `usage` | None | SDK provides billing data |

---

## SDK Event Types (T3 Code Gets For Free)

The SDK emits structured events that T3 Code maps to canonical `ProviderRuntimeEvent`:

```typescript
// SDK Message Types
type SDKMessage = 
  | { type: 'user'; message: SDKUserMessage }
  | { type: 'assistant'; message: AssistantMessage; uuid: string }
  | { type: 'result'; subtype: 'success' | 'error'; errors: string[]; usage: Usage }
  | { type: 'system'; subtype: 'init' | 'status' | 'task_started' | ... }
  | { type: 'stream_event'; event: ContentBlockDelta | ContentBlockStart | ... }
  | { type: 'tool_progress'; tool_use_id: string; elapsed_time_seconds: number }
  | { type: 'rate_limit_event'; ... }
  // ... 20+ more types
```

We get none of this - we're parsing raw stdout hoping to detect file changes via regex.

---

## Permission System Comparison

### T3 Code (SDK)
```typescript
const canUseTool: CanUseTool = (toolName, toolInput, options) => {
  // SDK calls this when Claude wants to use a tool
  // Return { behavior: 'allow' } or { behavior: 'deny', message: '...' }
  // Can show UI to user, wait for approval, etc.
  
  const decision = await waitForUserApproval(toolName, toolInput);
  return decision === 'accept' 
    ? { behavior: 'allow', updatedInput: toolInput }
    : { behavior: 'deny', message: 'User declined' };
};

const queryRuntime = query({
  prompt: asyncIterableOfMessages,
  options: { canUseTool, ... }
});
```

### ACC (Current)
```typescript
// We just skip permissions entirely
const args = ['-p', '--dangerously-skip-permissions'];
spawn('claude', args);
// No way to approve/deny individual operations
```

---

## Session Resume (T3 Code Feature We Don't Have)

```typescript
// T3 Code can resume conversations:
const queryOptions = {
  resume: 'previous-session-uuid',           // Resume from this session
  resumeSessionAt: 'last-assistant-msg-uuid', // At this specific point
};

// This allows:
// 1. Continuing a conversation after browser refresh
// 2. Branching from a specific point in history
// 3. Implementing undo/rollback
```

---

## Why T3 Code's Approach is Better

1. **Official SDK** - Anthropic maintains it, we don't have to reverse-engineer CLI output
2. **Structured Events** - Real event types, not regex parsing
3. **Session Persistence** - Can resume conversations, implement rollback
4. **Permission Flow** - Can build approval UI, not just bypass everything
5. **Usage Tracking** - Cost and token usage built-in
6. **Streaming** - Proper deltas with content types (text vs reasoning)
7. **Tool Lifecycle** - Know when tools start/complete, not guessing from output

---

## Recommendation

### Short-term Fix (What We Did)
- Use stdin instead of CLI args ✅
- Enable `--dangerously-skip-permissions` ✅
- Add timeouts ✅

### Medium-term (Recommended)

**Migrate to `@anthropic-ai/claude-agent-sdk`**

```bash
bun add @anthropic-ai/claude-agent-sdk
```

```typescript
import { query } from '@anthropic-ai/claude-agent-sdk';

// Replace subprocess spawn with:
const queryRuntime = query({
  prompt: asyncIterableOfUserMessages,
  options: {
    cwd: projectPath,
    model: 'claude-sonnet-4-20250514',
    permissionMode: 'bypassPermissions', // or implement canUseTool
    includePartialMessages: true,
  }
});

// Stream events properly:
for await (const event of queryRuntime) {
  switch (event.type) {
    case 'stream_event':
      // Handle deltas
      break;
    case 'result':
      // Handle completion
      break;
    // ... etc
  }
}
```

### Migration Effort
- **Estimated:** 1-2 days
- **Risk:** Low - SDK is official and well-documented
- **Benefit:** Proper Claude Code support, streaming, permissions, resume

---

## References

- T3 Code PR #179: https://github.com/pingdotgg/t3code/pull/179
- Claude Agent SDK: https://www.npmjs.com/package/@anthropic-ai/claude-agent-sdk
- SDK on GitHub: https://github.com/anthropics/claude-agent-sdk-typescript
