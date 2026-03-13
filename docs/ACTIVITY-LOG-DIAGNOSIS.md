# Activity Log Diagnosis & Fix Plan

## Problem
Activities show generic "Processing response..." instead of specific events like:
- "Reading file: src/components/Button.tsx"
- "Thinking..."
- "Running command: npm install"
- "Editing file: package.json"

## Current State (Our Implementation)

### How SDK Events Work
The `@anthropic-ai/claude-agent-sdk` emits `SDKMessage` objects with these types:
- `assistant` - Full message with content array (after streaming completes)
- `stream_event` - Raw Anthropic API streaming events
- `result` - Usage/cost data
- `system` - Status updates
- `tool_progress` - Long-running tool progress

### Our `handleSDKMessage()` Issues

1. **`assistant` event**: We emit "Processing response..." for every assistant message
   - This is too generic - we should only emit content deltas

2. **`stream_event` handling**: We DO try to handle `content_block_start`/`content_block_delta` but:
   - Tool names aren't being captured correctly from `block.name`
   - We emit both generic and specific activities (double-emit)
   - `content_block_stop` emits TWO activities ("Block completed" + "Tool completed")

3. **Logging shows the events ARE arriving** (we log `[SDK] stream_event/content_block_start` etc) but UI shows wrong activities

### SDK Event Flow for Tool Use
```
stream_event → type: "content_block_start" → content_block.type: "tool_use" → name: "Read"
stream_event → type: "content_block_delta" → delta.type: "input_json_delta"
stream_event → type: "content_block_stop"
```

For text response:
```
stream_event → type: "content_block_start" → content_block.type: "text"
stream_event → type: "content_block_delta" → delta.type: "text_delta" → delta.text: "..."
stream_event → type: "content_block_stop"
```

For thinking:
```
stream_event → type: "content_block_start" → content_block.type: "thinking"
stream_event → type: "content_block_delta" → delta.type: "thinking_delta"
stream_event → type: "content_block_stop"
```

---

## T3 Code Comparison

### Their Architecture
- They use `CodexAppServerManager` which wraps the Codex subprocess
- Events come as `ProviderEvent` with method names like:
  - `item/started` - Tool/item started
  - `item/completed` - Tool finished
  - `item/agentMessage/delta` - Text streaming
  - `item/reasoning/textDelta` - Thinking streaming
  - `item/commandExecution/outputDelta` - Command output

### Their `mapToRuntimeEvents()` converts to canonical types:
- `item.started` → itemType: "command_execution" | "file_change" | "file_read" | "reasoning" etc
- `content.delta` → streamKind: "assistant_text" | "reasoning_text" | "command_output"
- `turn.plan.updated` → plan steps with status

### Their Work Entry Tones
```typescript
type WorkTone = "thinking" | "tool" | "info" | "error";
```

### Their UI Rendering (`MessagesTimeline.tsx`)
- Groups consecutive work entries into cards
- Shows icon based on entry type (Terminal, Eye, SquarePen, Bot, Zap, etc.)
- Previews command/detail truncated
- Collapsible when >6 entries

---

## Fix Plan

### Phase 1: Fix SDK Event Parsing (Server)

**Location:** `packages/server/src/adapters/claude-code.ts`

1. **Track active content blocks** - Store block ID → block info mapping
2. **Remove duplicate activity emissions** - Only emit once per logical event
3. **Capture tool names properly** from `content_block_start`
4. **Emit correct activity types**:

```typescript
// On content_block_start with tool_use:
if (blockType === 'tool_use' || blockType === 'server_tool_use') {
  const toolName = block.name; // e.g., "Read", "Edit", "Bash"
  activeBlocks.set(block.id, { type: blockType, name: toolName });
  
  this.ctx.emitEvent({
    type: 'activity',
    payload: {
      activityType: this.classifyTool(toolName), // file_read, file_write, command
      label: this.toolLabel(toolName),  // "Reading file", "Editing file", "Running command"
      status: 'running',
    }
  });
}

// On content_block_delta with input_json_delta:
// Accumulate input, extract file path/command when available
if (deltaType === 'input_json_delta') {
  const blockInfo = activeBlocks.get(blockId);
  if (blockInfo) {
    blockInfo.inputJson = (blockInfo.inputJson || '') + delta.partial_json;
    // Try to parse and extract detail
    try {
      const input = JSON.parse(blockInfo.inputJson);
      const detail = this.extractDetail(blockInfo.name, input);
      if (detail) {
        this.updateLastActivity({ detail });
      }
    } catch {} // Still accumulating
  }
}

// On content_block_stop:
// Mark activity as completed
```

### Phase 2: Activity State Management

Track activity state properly:
```typescript
interface ActiveActivity {
  id: string;
  blockId?: string;
  type: ActivityType;
  label: string;
  detail?: string;
  status: 'running' | 'completed';
}

private activeActivities: Map<string, ActiveActivity> = new Map();
```

### Phase 3: UI Activity Rendering (Already Done)
The `TimelineRow` and work cards are already implemented. Just need proper events.

---

## Tool Name → Activity Type Mapping

| SDK Tool Name | Activity Type | UI Label |
|---------------|---------------|----------|
| `Read` / `View` | file_read | "Reading file" |
| `Edit` / `Write` / `MultiEdit` | file_write | "Editing file" |
| `Bash` / `Execute` | command | "Running command" |
| `Glob` / `Find` | file_read | "Searching files" |
| `Grep` | file_read | "Searching content" |
| `TodoRead` | info | "Checking todos" |
| `TodoWrite` | info | "Updating todos" |
| `WebSearch` | tool | "Searching web" |
| (thinking block) | thinking | "Thinking..." |

---

## Event Type → Activity Mapping

| SDK Event | Our Activity |
|-----------|-------------|
| `content_block_start` (tool_use) | activity: running |
| `content_block_delta` (input_json) | activity: update detail |
| `content_block_stop` (tool_use) | activity: completed |
| `content_block_start` (thinking) | activity: thinking, running |
| `content_block_delta` (thinking) | content.delta: reasoning |
| `content_block_stop` (thinking) | activity: completed |
| `content_block_start` (text) | (no activity) |
| `content_block_delta` (text) | content.delta: assistant_text |
| `content_block_stop` (text) | (no activity) |

---

## Implementation Steps

1. [ ] Add `activeBlocks` Map to track content blocks
2. [ ] Remove "Processing response..." from `assistant` handler
3. [ ] Fix `content_block_start` to properly capture tool name
4. [ ] Add JSON accumulator for `input_json_delta`
5. [ ] Extract detail (file path / command) from accumulated JSON
6. [ ] Single activity emit per block lifecycle (not double)
7. [ ] Update activity detail when path/command becomes available
8. [ ] Test with real execution

## Files to Modify
- `packages/server/src/adapters/claude-code.ts` - SDK event handling
