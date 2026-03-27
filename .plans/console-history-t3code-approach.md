# Console History Loading - T3 Code Approach

**Date:** 2026-03-26
**Status:** Planning Phase
**Issue:** Console history not loading properly, going in wrong direction with complex sync/database approach

## Problem Summary

Current implementation is too complex and not working:
- Parsing .jsonl files into database
- Sync logic only runs during session creation
- User messages not showing despite parser fix
- Multiple layers of caching causing state issues

## How T3 Code Does It

### Architecture Discovery

**File:** `/tmp/t3code/packages/contracts/src/terminal.ts`

```typescript
export const TerminalSessionSnapshot = Schema.Struct({
  threadId: Schema.String.check(Schema.isNonEmpty()),
  terminalId: Schema.String.check(Schema.isNonEmpty()),
  cwd: Schema.String.check(Schema.isNonEmpty()),
  status: TerminalSessionStatus,
  pid: Schema.NullOr(Schema.Int.check(Schema.isGreaterThan(0))),
  history: Schema.String,  // ← THE KEY!
  exitCode: Schema.NullOr(Schema.Int),
  exitSignal: Schema.NullOr(Schema.Int),
  updatedAt: Schema.String,
});

const TerminalStartedEvent = Schema.Struct({
  ...TerminalEventBaseSchema.fields,
  type: Schema.Literal("started"),
  snapshot: TerminalSessionSnapshot,  // ← Includes full history
});

const TerminalOutputEvent = Schema.Struct({
  ...TerminalEventBaseSchema.fields,
  type: Schema.Literal("output"),
  data: Schema.String,  // ← Incremental output only
});
```

### T3 Code's Approach

**Simple and Effective:**

1. **On Terminal Start/Resume** → Send `TerminalStartedEvent` with **full history as a single string**
   - History is in `snapshot.history` field
   - Entire output buffer sent at once
   - No pagination, no database queries, no complex sync

2. **During Active Session** → Send `TerminalOutputEvent` for **new output only**
   - Just the incremental data
   - No need to track what's in database

3. **Storage** → They likely just keep history in memory or simple file
   - No complex database schema
   - No sequence numbers or pagination
   - Just a string buffer

## Why This Is Better Than Our Current Approach

### Our Current Approach (Complex)

```
┌─────────────────────────────────────────────────────┐
│ 1. SDK .jsonl file (source of truth)               │
│    ↓ Parse on session creation only                │
│ 2. Database (cache/index with sequences)           │
│    ↓ Query with ORDER BY, pagination               │
│ 3. API (/api/consoles/:id/lines?limit=1000)        │
│    ↓ Fetch, map, process                           │
│ 4. UI State (ConsoleLine[] with metadata)          │
│    ↓ Spread, reverse, display                      │
│ 5. Display (xterm.js)                              │
└─────────────────────────────────────────────────────┘

PROBLEMS:
- Sync only happens during session creation
- Database can be stale if cleared after session exists
- Ordering issues (DESC vs ASC, reversing)
- Multiple layers of transformation
- User messages not showing despite parser fix
```

### T3 Code Approach (Simple)

```
┌─────────────────────────────────────────────────────┐
│ 1. Session starts/resumes                          │
│    ↓ Load history buffer (from memory/file)        │
│ 2. Send TerminalStartedEvent with full history     │
│    ↓ Single string in snapshot.history             │
│ 3. UI receives event, writes to xterm.js           │
│    ↓ Done!                                          │
└─────────────────────────────────────────────────────┘

BENEFITS:
- One-shot load, no pagination
- No database ordering issues
- History always sent on session start
- Simple string buffer, easy to understand
```

## Proposed Implementation for ACC

### Phase 1: Parse .jsonl → Full History String

**Goal:** When resuming a console, parse the .jsonl file and return the complete output as a single string.

**Files to Modify:**
1. `packages/server/src/services/claude-session-parser.ts`
   - Add function: `parseSessionToHistoryString(sessionFilePath: string): Promise<string>`
   - Returns: Complete console output as formatted string
   - Format: Include user prompts (with `> ` prefix) and assistant outputs in chronological order

2. `packages/server/src/adapters/session-manager.ts`
   - When creating/resuming session, call `parseSessionToHistoryString()`
   - Store in session object: `session.historyBuffer = await parseSessionToHistoryString(...)`

**Example Output String:**
```
> Fix the login bug
Checking login.ts...
Found issue at line 42...
Fixed the validation logic.

> Add tests for the fix
Creating test file...
Added 3 test cases...
```

### Phase 2: Send History on Session Creation/Resume

**Goal:** When UI connects to a console, immediately send the full history.

**Files to Modify:**
1. `packages/server/src/server.ts`
   - Modify session creation response to include `historyBuffer: string`
   - OR: Add new event type `ConsoleHistoryEvent` similar to T3's `TerminalStartedEvent`

2. `packages/contracts/src/agent-console.ts`
   - Add interface:
     ```typescript
     export interface ConsoleSessionSnapshot {
       consoleId: string;
       threadId: string;
       path: string;
       history: string;  // Full output buffer
       status: 'idle' | 'running' | 'error';
       createdAt: string;
     }

     export interface ConsoleStartedEvent {
       type: 'console.started';
       snapshot: ConsoleSessionSnapshot;
     }
     ```

### Phase 3: Display History in UI

**Goal:** Write the full history to xterm.js on console load.

**Files to Modify:**
1. `packages/ui/src/components/workspace/Workspace.tsx`
   - When console is created/resumed, receive `ConsoleStartedEvent`
   - Write `snapshot.history` directly to xterm.js: `term.write(snapshot.history)`
   - Add separator: `"── Previous output ──\\r\\n"`
   - Add "Session resumed" message

**Example Flow:**
```typescript
// In console creation handler
const handleConsoleStarted = (event: ConsoleStartedEvent) => {
  const { snapshot } = event;

  // Write history to terminal
  if (snapshot.history) {
    term.write("\\r\\n── Previous output ──\\r\\n");
    term.write(snapshot.history);
    term.write("\\r\\n");
  }

  // Add resume message
  term.write(`\\x1b[90m[Session resumed at ${new Date().toLocaleTimeString()}]\\x1b[0m\\r\\n`);
};
```

### Phase 4: Cleanup

**Goal:** Remove unused complex code.

**Files to Delete/Simplify:**
1. Remove database console lines storage:
   - Keep table for now (for future search feature?)
   - Remove sync logic from session-manager
   - Remove `/api/consoles/:id/lines` endpoint

2. Simplify console state:
   - Remove `oldestSequence`, `newestSequence`, `hasMoreHistory`
   - Just track: `id`, `threadId`, `path`, `status`, `lines[]` (for new output)

## Migration Strategy

### Option A: Full Cut-over (Recommended)
1. Implement Phase 1-3 completely
2. Test with fresh sessions
3. Test with resumed sessions
4. Remove old database sync code
5. **Pros:** Clean break, simpler code
6. **Cons:** Loses any history currently in database (but it's broken anyway)

### Option B: Gradual Migration
1. Keep database approach for existing sessions
2. Use new approach for new sessions
3. Gradually migrate old sessions
4. **Pros:** No data loss
5. **Cons:** Complex dual-system, more code to maintain

**Recommendation:** Option A - The current database approach is broken, so there's no value in keeping it.

## Testing Plan

### Test Case 1: Fresh Console
1. Create new console
2. Send message, get response
3. Close console
4. Reopen console
5. **Expected:** See previous message and response in history

### Test Case 2: Long History
1. Resume console with 50+ messages
2. **Expected:** All messages appear in chronological order (oldest → newest)
3. **Expected:** User prompts show with `> ` prefix
4. **Expected:** No lag, loads quickly (string is fast)

### Test Case 3: No History
1. Resume console with no previous messages
2. **Expected:** Just "Session resumed" message
3. **Expected:** No errors

### Test Case 4: Active Console
1. Console is already open
2. Send new message
3. **Expected:** New output appears below history
4. **Expected:** No duplication

## Open Questions

### Q1: How much history to include?
**Options:**
- A: All history (could be large for long sessions)
- B: Last N characters (e.g., 100KB)
- C: Last N messages

**Recommendation:** Start with all history, add truncation later if needed.

### Q2: Should we format the history?
**Options:**
- A: Raw text output only
- B: Include ANSI colors/formatting
- C: Include timestamps

**Recommendation:** Include ANSI colors (already in SDK events), add timestamps as `[HH:MM:SS]` prefix.

### Q3: What about database storage?
**Options:**
- A: Remove completely
- B: Keep for search feature (future)
- C: Async background sync (don't block on it)

**Recommendation:** Option B - Keep table for future FTS5 search, but don't rely on it for display.

## Key Differences from T3 Code

T3 Code uses terminals (shell sessions), we use agent consoles (Claude SDK sessions):
- **T3:** Terminal output is raw shell output
- **ACC:** Console output is structured (user messages, assistant output, tool calls)

We need to:
1. **Parse .jsonl events** → Format as readable text
2. **Include user prompts** → Show what user asked
3. **Include assistant text** → Show Claude's responses
4. **Include tool calls** → Show what tools were used (optional, can be collapsed)

## Implementation Checklist

### Phase 1: Parser
- [ ] Add `parseSessionToHistoryString()` function
- [ ] Format user messages with `> ` prefix
- [ ] Format assistant text blocks
- [ ] Format tool calls (optional: show/hide)
- [ ] Add timestamps to each message
- [ ] Test parsing various session files

### Phase 2: Server
- [ ] Add `ConsoleSessionSnapshot` interface to contracts
- [ ] Add `ConsoleStartedEvent` interface to contracts
- [ ] Load history on session creation
- [ ] Send history in session response or as event
- [ ] Test with WebSocket events

### Phase 3: UI
- [ ] Handle `ConsoleStartedEvent` in workspace
- [ ] Write history to xterm.js
- [ ] Add separator and resume message
- [ ] Test with various screen sizes
- [ ] Test scrolling behavior

### Phase 4: Cleanup
- [ ] Remove database sync from session-manager
- [ ] Remove `/api/consoles/:id/lines` endpoint (or mark deprecated)
- [ ] Simplify console state management
- [ ] Update documentation
- [ ] Remove unused imports/code

## Success Criteria

✅ **Must Have:**
1. User messages appear in history with `> ` prefix
2. Assistant responses appear in chronological order
3. History loads on console resume
4. No database ordering issues
5. Works for fresh and resumed sessions

✅ **Nice to Have:**
1. Timestamps for each message
2. ANSI colors preserved
3. Tool calls shown (collapsible)
4. Fast loading (<100ms for typical session)

## References

- **T3 Code Terminal Contract:** `/tmp/t3code/packages/contracts/src/terminal.ts:81-92`
- **Our Current Architecture:** `.plans/console-persistence-architecture.md`
- **Previous Ordering Issue:** `.plans/console-history-ordering-issue.md`
- **Console Line Store:** `packages/server/src/services/console-line-store.ts`
- **Session Parser:** `packages/server/src/services/claude-session-parser.ts`

---

## Decision

**Proceed with T3 Code approach:**
- Send full history as string on session start
- No complex database sync
- Simple, reliable, fast

**Next Steps:**
1. Review this plan with user
2. Get approval on approach
3. Implement Phase 1 (parser)
4. Test and iterate
