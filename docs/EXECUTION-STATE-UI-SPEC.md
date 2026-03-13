# Execution State UI Spec

Based on T3 Code's approach to showing what's happening during task execution.

---

## Overview

Show real-time activity during execution:
- Thinking/reasoning
- Tool calls (file reads, writes, commands)
- Approvals (future)
- Errors

---

## Data Model

### ActivityEntry

```typescript
interface ActivityEntry {
  id: string;
  createdAt: string;
  
  // What type of activity
  type: 'thinking' | 'tool_started' | 'tool_completed' | 'file_read' | 
        'file_write' | 'command' | 'info' | 'error';
  
  // Display text
  label: string;
  
  // Optional detail (e.g., file path, command text)
  detail?: string;
  
  // Status for tool calls
  status?: 'running' | 'completed' | 'failed';
  
  // Duration for completed items
  durationMs?: number;
}
```

### ActivityTone (for styling)

```typescript
type ActivityTone = 'thinking' | 'tool' | 'info' | 'error';

function getToneClass(tone: ActivityTone): string {
  switch (tone) {
    case 'error': return 'text-red-400';
    case 'tool': return 'text-zinc-400';
    case 'thinking': return 'text-zinc-500';
    default: return 'text-zinc-500';
  }
}
```

---

## SDK Events → ActivityEntry Mapping

| SDK Event | Activity Type | Label | Detail |
|-----------|--------------|-------|--------|
| `stream_event` (thinking delta) | `thinking` | "Thinking..." | content preview |
| `stream_event` (content_block_start, tool_use) | `tool_started` | Tool name | input summary |
| `stream_event` (content_block_stop) | `tool_completed` | Tool name | result summary |
| `tool_progress` | `tool_started` | Tool name | elapsed time |
| `system` (status) | `info` | Status text | - |
| `result` (error) | `error` | Error message | - |

---

## UI Components

### 1. ActivityLog (Right panel or inline)

```
┌─────────────────────────────────────────────────────────┐
│ Activity                                     [Collapse] │
├─────────────────────────────────────────────────────────┤
│ ● Thinking...                                     0.8s  │
│ ● Read file: src/server.ts                       0.2s  │
│ ● Edit file: src/adapters/claude.ts              1.2s  │
│ ◐ Running: npm test                          [running]  │
└─────────────────────────────────────────────────────────┘
```

### 2. ExecutionView Enhancement

Current:
```
┌─────────────────────────────────────────────────────────┐
│ > Starting execution...                                 │
│ > Working...                                            │
│ > Done                                                  │
└─────────────────────────────────────────────────────────┘
```

New:
```
┌─────────────────────────────────────────────────────────┐
│ ● Executing Step 2 of 4                        ⏱ 1:23   │
│ Agent: Claude Code                                      │
├─────────────────────────────────────────────────────────┤
│                                                         │
│ Activity Log                                            │
│ ─────────────────────────────────────────────────────── │
│ ✓ Read file: src/types.ts                        0.3s  │
│ ✓ Analyzed codebase structure                    1.2s  │
│ ◐ Editing: src/adapters/claude-code.ts       [running]  │
│   └─ Adding SDK integration...                          │
│                                                         │
├─────────────────────────────────────────────────────────┤
│ Output                                                  │
│ ─────────────────────────────────────────────────────── │
│ > I'll integrate the official Claude Agent SDK...       │
│ > First, let me read the current adapter code...        │
│ █                                                       │
└─────────────────────────────────────────────────────────┘
```

### 3. Activity Icons

```typescript
const ActivityIcon = ({ type }: { type: ActivityEntry['type'] }) => {
  switch (type) {
    case 'thinking': return <Brain className="w-3 h-3 text-purple-400" />;
    case 'file_read': return <FileSearch className="w-3 h-3 text-blue-400" />;
    case 'file_write': return <FilePen className="w-3 h-3 text-green-400" />;
    case 'command': return <Terminal className="w-3 h-3 text-amber-400" />;
    case 'tool_started': return <Loader2 className="w-3 h-3 animate-spin" />;
    case 'tool_completed': return <Check className="w-3 h-3 text-green-400" />;
    case 'error': return <AlertCircle className="w-3 h-3 text-red-400" />;
    default: return <Circle className="w-3 h-3" />;
  }
};
```

---

## Implementation

### 1. Update Adapter to Emit Rich Events

```typescript
// In handleSDKMessage
case 'stream_event': {
  const streamEvent = event.event as any;
  
  if (streamEvent?.type === 'content_block_start') {
    const block = streamEvent.content_block;
    if (block?.type === 'tool_use') {
      this.ctx.emitEvent({
        type: 'activity',
        threadId: this.state.activeThreadId!,
        turnId,
        payload: {
          activityType: 'tool_started',
          label: block.name,
          detail: summarizeInput(block.input),
        },
      });
    }
  }
  // ... etc
}
```

### 2. Add Activity Store

```typescript
interface ExecutionState {
  activities: ActivityEntry[];
  addActivity: (activity: ActivityEntry) => void;
  clearActivities: () => void;
}
```

### 3. ActivityLog Component

```tsx
function ActivityLog({ activities }: { activities: ActivityEntry[] }) {
  return (
    <div className="space-y-1 text-sm">
      {activities.map((activity) => (
        <div key={activity.id} className="flex items-center gap-2">
          <ActivityIcon type={activity.type} />
          <span className={getToneClass(activity.type)}>
            {activity.label}
          </span>
          {activity.detail && (
            <span className="text-zinc-500 truncate max-w-[200px]">
              {activity.detail}
            </span>
          )}
          {activity.durationMs && (
            <span className="text-zinc-600 text-xs ml-auto">
              {formatDuration(activity.durationMs)}
            </span>
          )}
        </div>
      ))}
    </div>
  );
}
```

---

## Server Changes

### New Event Type

```typescript
// In contracts/events.ts
interface ActivityEvent extends BaseEvent {
  type: 'activity';
  payload: {
    activityType: ActivityEntry['type'];
    label: string;
    detail?: string;
    status?: 'running' | 'completed' | 'failed';
  };
}
```

### WebSocket Broadcast

Activities are already emitted via `ctx.emitEvent()` and broadcast to clients.
UI needs to listen and accumulate them.

---

## Migration Steps

1. [ ] Add `ActivityEntry` type to contracts
2. [ ] Update claude-code adapter to emit `activity` events  
3. [ ] Create `ActivityLog` component
4. [ ] Update `ExecutionView` to show activity panel
5. [ ] Add activity state to store
6. [ ] Wire WebSocket to update activities in real-time

---

## T3 Code Patterns Used

1. **Activity grouping** - Tool calls grouped together
2. **Collapsible** - "Show X more" for long logs
3. **Tone-based styling** - Different colors for thinking/tool/error
4. **Detail truncation** - Long paths/commands truncated with tooltip
5. **Duration display** - Show elapsed time for each activity
