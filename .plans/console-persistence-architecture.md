# Console Line Persistence Architecture

**Date:** 2026-03-26
**Status:** Implemented (Approach 2 - Hybrid)
**Authors:** Research based on t3code analysis

## Table of Contents

1. [Problem Statement](#problem-statement)
2. [Research Summary](#research-summary)
3. [Architectural Approaches Considered](#architectural-approaches-considered)
4. [Decision: Approach 2 (Hybrid)](#decision-approach-2-hybrid)
5. [Implementation Details](#implementation-details)
6. [Migration Path](#migration-path)
7. [Testing Strategy](#testing-strategy)
8. [Future Considerations](#future-considerations)

---

## Problem Statement

### The Issue

When resuming Claude Code sessions, console content appeared as blank green boxes despite data existing in the database. The root cause was a conflict between two data sources:

1. **Database restoration**: Loaded persisted console lines from SQLite
2. **SDK event replay**: Claude Code SDK replayed `content_block_start` events during session resume
3. **Conflict**: `content_block_start` created NEW empty lines with the SAME IDs, overwriting database content

### Original Architecture (Problematic)

```
Session Resume Flow (BEFORE):
1. Load lines from database → [{id: "text-abc123", content: "actual content"}]
2. SDK resumes session → Replays content_block_start events
3. content_block_start → Creates {id: "text-abc123", content: ""} (EMPTY!)
4. Result: Blank green boxes (isStreaming=true but no content)
```

### User's Hypothesis

> "We're mixing the 2 approaches to loading session content" - The user was correct. We were:
> - Relying on database persistence for history
> - Relying on SDK event replay for streaming state
> - These two approaches conflicted during resume

---

## Research Summary

### T3Code Analysis

We analyzed [t3code](https://github.com/pingdotgg/t3code) to understand their approach to console persistence and session resumption.

#### Key Findings

**T3Code Philosophy:** "SDK owns conversation data, we just wrap it"

1. **No Console Line Database**
   - Terminal history stored in simple text files (`.logs/terminals/`)
   - Conversation history delegated to Claude Code SDK's `.jsonl` files
   - Clean separation: terminal output vs. conversation history

2. **Session Resume Strategy**
   - Passes `resume: sessionId` directly to SDK `query()` options
   - SDK handles all conversation restoration
   - No conflict between database and SDK events (no database!)

3. **Storage Locations**
   - Terminal history: `~/.acc/logs/terminals/terminal_{base64(threadId)}.log`
   - Conversation: `~/.claude/projects/<escaped-path>/<sessionId>.jsonl` (SDK-managed)

**Relevant Code:**

```typescript
// T3Code: session-manager.ts (simplified)
const queryOptions: ClaudeQueryOptions = {
  // ... other options
  ...(resumeSessionId ? { resume: resumeSessionId } : {}),
};

const session = {
  resumeCursor: {
    threadId,
    resume: sessionId,  // Just pass it to SDK
    turnCount: resumeState?.turnCount ?? 0,
  },
};
```

**File:** `/tmp/t3code/apps/server/src/provider/Layers/ClaudeAdapter.ts` (lines 2765, 2796-2806)

#### Claude Code SDK Session File Format

Claude Code stores conversations in `.jsonl` (JSON Lines) files:

**Location:**
```
~/.claude/projects/<escaped-project-path>/<sessionId>.jsonl
```

**Format:**
```jsonl
{"type":"queue-operation","operation":"dequeue","timestamp":"2026-03-16T03:06:00.564Z","sessionId":"062d8d43-..."}
{"type":"user","message":{...},"timestamp":"2026-03-16T03:06:01.000Z"}
{"type":"assistant","message":{"content":[{"type":"text","text":"actual output"}]},"timestamp":"2026-03-16T03:06:03.258Z"}
```

**Key Insight:** The SDK's `.jsonl` files contain the FULL conversation history with all content blocks. This is the canonical source of truth.

---

## Architectural Approaches Considered

We evaluated 5 different approaches:

### Approach 1: T3Code Style - Delegate to SDK Entirely

**How:** No console line database. Rely entirely on SDK `.jsonl` files.

| Pros | Cons |
|------|------|
| ✅ Simplest implementation | ❌ No search capability |
| ✅ Single source of truth | ❌ No metadata tracking |
| ✅ No conflicts | ❌ No offline access |
| ✅ Zero maintenance | ❌ Must parse `.jsonl` to display |

**Complexity:** ⭐ (Very Low)

---

### Approach 2: Hybrid - SDK as Source, Database as Cache ⭐ **CHOSEN**

**How:** Read SDK `.jsonl` on resume → populate database → display from database.

| Pros | Cons |
|------|------|
| ✅ Single source of truth (SDK) | ⚠️ Moderate complexity |
| ✅ FTS5 search capability | ⚠️ Need `.jsonl` parser |
| ✅ Rich metadata | ⚠️ Dual storage |
| ✅ No conflicts | |
| ✅ Graceful degradation | |
| ✅ Fast display | |

**Complexity:** ⭐⭐⭐ (Moderate)

---

### Approach 3: Current Fix - Check Before Creating Lines

**How:** Load from database, check if line exists before creating on `content_block_start`.

| Pros | Cons |
|------|------|
| ✅ Already partially implemented | ❌ Complex conflict resolution |
| ✅ FTS5 search | ❌ Two sources of truth |
| ✅ Rich metadata | ❌ Fragile (event ordering) |
| | ❌ Hard to debug |

**Complexity:** ⭐⭐⭐⭐ (High)

**Status:** Partially implemented but abandoned in favor of Approach 2.

---

### Approach 4: Database Only - No SDK History Replay

**How:** Only use database, don't replay SDK events for history.

| Pros | Cons |
|------|------|
| ✅ Single source (database) | ❌ Out of sync with SDK |
| ✅ Simple resume logic | ❌ No validation |
| | ❌ Data loss risk |

**Complexity:** ⭐⭐ (Low-Moderate)

---

### Approach 5: Hybrid Enhanced - Smart Sync

**How:** Check if synced, if not parse `.jsonl`, track sync state, validate on errors.

| Pros | Cons |
|------|------|
| ✅ Best of both worlds | ⚠️ Very high complexity |
| ✅ Self-healing | ⚠️ Sync state tracking |
| ✅ Fast common case | ⚠️ Many edge cases |

**Complexity:** ⭐⭐⭐⭐⭐ (Very High)

---

## Decision: Approach 2 (Hybrid)

### Rationale

1. **Aligns with T3Code Philosophy**
   - SDK owns conversation data (source of truth)
   - We add value: search, metadata, analytics

2. **Technical Benefits**
   - No conflicts (database populated from `.jsonl`, not events)
   - Single source of truth (SDK files)
   - Graceful degradation (database as backup)
   - Clean separation (reading vs. writing)

3. **Feature Preservation**
   - Keep FTS5 full-text search
   - Keep rich metadata (tool names, input/output)
   - Keep analytics capabilities

4. **Reasonable Complexity**
   - Need `.jsonl` parser (moderate effort)
   - Rest of system stays mostly the same
   - Clear error handling path

### How It Works

```
Session Resume Flow (NEW):

1. User opens console with resumeOptions.sessionId
   ↓
2. Server: Check SDK .jsonl file exists
   ~/.claude/projects/<path>/<sessionId>.jsonl
   ↓
3. Parse .jsonl → Extract content blocks
   [
     {type: 'text', text: 'actual content', id: 'msg_123'},
     {type: 'thinking', thinking: 'my thoughts', id: 'block_abc'},
     ...
   ]
   ↓
4. Populate database with parsed lines
   INSERT INTO console_lines (line_id, content, ...)
   VALUES ('text-msg_123', 'actual content', ...)
   ↓
5. Client loads from database (fast, already parsed)
   ↓
6. SDK resume continues conversation (NO event replay)
   query({ prompt, options: { resume: sessionId } })
   ↓
7. New messages → persist via streaming events (as before)
```

### Key Architectural Principles

1. **SDK `.jsonl` files are the canonical source of truth**
   - Database is a cache/index
   - If `.jsonl` and database differ, `.jsonl` wins

2. **Separation of concerns**
   - **Reading history:** Parse `.jsonl` → database → display
   - **Writing new messages:** Streaming events → database

3. **Graceful degradation**
   - If `.jsonl` file missing: Use database (may be stale)
   - If database empty: Parse `.jsonl` (slower but works)
   - If both missing: Show "Session resumed" and continue

4. **One-time sync per session**
   - Parse `.jsonl` on first resume
   - Track sync state to avoid re-parsing
   - Re-sync only if explicitly requested or on error

---

## Implementation Details

### Component 1: Claude Session Parser

**File:** `packages/server/src/services/claude-session-parser.ts`

**Purpose:** Parse Claude Code SDK `.jsonl` session files into console lines.

**Key Functions:**

```typescript
// Parse entire session file into console lines
async function parseSessionFile(sessionFilePath: string): Promise<ParsedConsoleLine[]>

// Get SDK session file path for a project + session ID
function getSessionFilePath(projectPath: string, sessionId: string): string

// Escape project path to SDK's format
function escapeProjectPath(path: string): string
```

**Input:** `~/.claude/projects/-Users-marlin-agent-command-center/062d8d43-dd3f-402e-955c-26f754a5e631.jsonl`

**Output:**
```typescript
[
  {
    blockId: 'msg_123',
    blockIndex: 0,
    type: 'output',
    content: 'I'll help you plan...',
    timestamp: '2026-03-16T03:06:03.258Z',
  },
  {
    blockId: 'block_abc',
    blockIndex: 1,
    type: 'thinking',
    content: 'Let me first explore...',
    timestamp: '2026-03-16T03:06:03.258Z',
  },
  // ...
]
```

**Event Types Handled:**
- `type: 'assistant'` → Extract content blocks
  - `content[].type === 'text'` → output line
  - `content[].type === 'thinking'` → thinking line
  - `content[].type === 'tool_use'` → tool_call line
  - `content[].type === 'tool_result'` → tool_result line
- `type: 'user'` → Ignored (not shown in console)
- `type: 'queue-operation'` → Ignored (internal SDK event)

---

### Component 2: Session Manager Sync Logic

**File:** `packages/server/src/adapters/session-manager.ts`

**Changes:**

1. **On `createSession` with `resume=true`:**
   ```typescript
   if (resume && sessionId) {
     // Get session file path
     const sessionFilePath = getSessionFilePath(cwd, sessionId);

     if (fs.existsSync(sessionFilePath)) {
       // Parse .jsonl file
       const parsedLines = await parseSessionFile(sessionFilePath);

       // Sync to database
       consoleLineStore.appendLines(threadId, parsedLines);
     }
   }
   ```

2. **Error handling:**
   - If `.jsonl` not found: Log warning, continue (database may have data)
   - If parse fails: Log error, continue (graceful degradation)
   - If database insert fails: Throw error (critical)

---

### Component 3: Client Event Replay Skip

**File:** `packages/ui/src/components/workspace/Workspace.tsx`

**Changes:**

1. **Track resume phase:**
   ```typescript
   const [resumingConsoles, setResumingConsoles] = useState<Set<string>>(new Set());
   ```

2. **Mark console as resuming:**
   ```typescript
   // When creating console with resumeOptions
   if (resumeOptions?.resume) {
     setResumingConsoles(prev => new Set(prev).add(newTerminalId));
   }
   ```

3. **Skip event processing during resume:**
   ```typescript
   if (resumingConsoles.has(terminalId)) {
     // Only watch for first user message or turn.completed
     if (msg.type === 'turn.started' || msg.type === 'turn.completed') {
       setResumingConsoles(prev => {
         const next = new Set(prev);
         next.delete(terminalId);
         return next;
       });
     }
     return; // Skip all streaming events during resume
   }
   ```

**Why this works:**
- During resume, SDK may replay events (or may not)
- We don't care - we already have the data from `.jsonl`
- Once first new message starts, resume phase is over
- Normal event handling resumes for new messages

---

### Component 4: Database Schema (No Changes)

**File:** `packages/server/src/persistence/schema.sql`

The existing schema already supports this approach:

```sql
CREATE TABLE IF NOT EXISTS console_lines (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  line_id TEXT NOT NULL UNIQUE,  -- Prevents duplicates
  console_id TEXT NOT NULL,      -- Thread ID
  sequence INTEGER NOT NULL,     -- Auto-incrementing
  type TEXT NOT NULL,            -- output, thinking, tool_call, etc.
  content TEXT NOT NULL,
  timestamp TEXT NOT NULL,
  block_index INTEGER,           -- From .jsonl parsing
  block_id TEXT,                 -- Message ID from .jsonl
  tool_name TEXT,
  -- ... other fields
);
```

**Key properties:**
- `line_id` is UNIQUE → Prevents duplicate inserts
- `sequence` auto-increments → Maintains order
- Rich metadata fields → Support analytics

---

## Migration Path

### Phase 1: Add Parser (Low Risk)

**Tasks:**
1. Create `claude-session-parser.ts`
2. Add unit tests with sample `.jsonl` files
3. Add integration test: parse real session file

**Risk:** Low - No changes to existing functionality

**Rollback:** Simply delete the file

---

### Phase 2: Sync on Resume (Medium Risk)

**Tasks:**
1. Modify `createSession` to parse and sync
2. Add logging for debugging
3. Test with multiple session scenarios

**Risk:** Medium - Affects session resume flow

**Rollback:** Remove sync code, keep existing behavior

**Validation:**
- Existing sessions: Continue to work (database already has data)
- New resumes: Sync from `.jsonl`, display correctly
- Missing `.jsonl`: Gracefully fall back to database

---

### Phase 3: Skip Event Replay (High Risk)

**Tasks:**
1. Add `resumingConsoles` state tracking
2. Skip streaming events during resume phase
3. Exit resume phase on first new message

**Risk:** High - Changes event processing logic

**Rollback:** Remove state tracking, restore event processing

**Validation:**
- Resume works without creating duplicate lines
- First new message triggers normal event handling
- Streaming state updates correctly

---

### Phase 4: Cleanup (Low Risk)

**Tasks:**
1. Remove old conflict resolution code (check before creating lines)
2. Simplify event handlers
3. Add documentation

**Risk:** Low - Removing dead code

---

## Testing Strategy

### Unit Tests

**File:** `packages/server/src/services/claude-session-parser.test.ts`

```typescript
describe('ClaudeSessionParser', () => {
  it('parses text blocks correctly', async () => {
    const mockJsonl = `
      {"type":"assistant","message":{"content":[{"type":"text","text":"Hello"}]}}
    `;
    // Test parsing logic
  });

  it('parses thinking blocks correctly', async () => {
    // Test thinking extraction
  });

  it('parses tool_use blocks correctly', async () => {
    // Test tool call extraction
  });

  it('handles malformed lines gracefully', async () => {
    // Test error handling
  });

  it('escapes project paths correctly', () => {
    expect(escapeProjectPath('/Users/name/project'))
      .toBe('-Users-name-project');
  });
});
```

### Integration Tests

**Test 1: Resume with SDK file present**

```typescript
describe('Session Resume with .jsonl', () => {
  it('loads console lines from synced database', async () => {
    // 1. Create mock .jsonl file with content
    // 2. Call createSession with resume=true
    // 3. Verify database has parsed lines
    // 4. Verify API returns correct lines
    // 5. Verify client displays content
  });
});
```

**Test 2: Resume with SDK file deleted**

```typescript
it('falls back to database when .jsonl missing', async () => {
  // 1. Database has old synced lines
  // 2. .jsonl file deleted
  // 3. Call createSession with resume=true
  // 4. Verify uses database lines (no error)
  // 5. Warn user that history may be incomplete
});
```

**Test 3: New messages after resume**

```typescript
it('persists new messages correctly after resume', async () => {
  // 1. Resume session (loads from .jsonl)
  // 2. Send new message
  // 3. Verify streaming events create new lines
  // 4. Verify no duplicates
  // 5. Verify database updated
});
```

**Test 4: Search across resumed sessions**

```typescript
it('searches synced console lines with FTS5', async () => {
  // 1. Resume session (syncs from .jsonl)
  // 2. Search for keyword in synced content
  // 3. Verify FTS5 finds matches
  // 4. Verify snippets are correct
});
```

### Manual Testing Scenarios

1. **Happy Path:**
   - Open app → Resume existing console
   - Verify: Content appears immediately
   - Send new message
   - Verify: New content streams correctly

2. **Edge Case - CWD Mismatch:**
   - Create session in `/project/path1`
   - Move to `/project/path2`
   - Resume session
   - Verify: Uses original CWD to find `.jsonl`

3. **Edge Case - Session File Deleted:**
   - Resume session
   - Delete `~/.claude/projects/.../sessionId.jsonl`
   - Reopen app
   - Verify: Shows database content, warns about missing SDK file

4. **Edge Case - Multiple Consoles:**
   - Resume 3 different sessions
   - Verify: Each loads correct content
   - Verify: No cross-contamination

---

## Future Considerations

### Optimization 1: Lazy Parsing

Instead of parsing the entire `.jsonl` file on resume, we could:
1. Parse only the last N messages
2. Load older messages on scroll (pagination)
3. Use database for very old content

**Tradeoff:** More complexity vs. faster initial load

---

### Optimization 2: Incremental Sync

Track which messages have been synced to avoid re-parsing:

```sql
ALTER TABLE console_lines ADD COLUMN synced_from_jsonl BOOLEAN DEFAULT 0;
```

On resume:
1. Check last synced message timestamp
2. Parse only new messages from `.jsonl`
3. Append to database

**Tradeoff:** More state to track vs. avoiding duplicate work

---

### Optimization 3: Background Sync

Periodically sync all active sessions in background:

```typescript
setInterval(async () => {
  const activeSessions = await listActiveSessions();
  for (const session of activeSessions) {
    await syncSessionFromJsonl(session.id);
  }
}, 60_000); // Every minute
```

**Tradeoff:** CPU usage vs. always-fresh data

---

### Alternative: Approach 5 (Enhanced Hybrid)

If we encounter issues with Approach 2, we could upgrade to Approach 5:

**Additional features:**
1. **Sync state tracking:** `threads.jsonl_last_synced_at`
2. **Validation:** Compare database vs. `.jsonl` checksums
3. **Auto-repair:** Re-sync if database seems corrupted
4. **Partial sync:** Only parse new messages since last sync

**When to consider:**
- Users report stale or missing content
- Performance issues with large `.jsonl` files
- Need better conflict resolution

---

## Comparison with T3Code

| Aspect | T3Code | Agent Command Center (Approach 2) |
|--------|--------|-----------------------------------|
| **Conversation Storage** | SDK `.jsonl` only | SDK `.jsonl` + SQLite cache |
| **Terminal Output** | Text files | SQLite (console_lines table) |
| **Resume Strategy** | Pass UUID to SDK | Parse `.jsonl` → sync to DB → display |
| **Search** | None | FTS5 full-text search |
| **Metadata** | None | Rich (tool names, I/O, timestamps) |
| **Complexity** | Very Low | Moderate |
| **Advantages** | Simple, reliable | Search, analytics, rich UI |
| **Disadvantages** | No search, no metadata | More code to maintain |

---

## References

### Key Files

**Research:**
- T3Code: `/tmp/t3code/apps/server/src/terminal/Layers/Manager.ts`
- T3Code: `/tmp/t3code/apps/server/src/provider/Layers/ClaudeAdapter.ts`

**Implementation:**
- Parser: `packages/server/src/services/claude-session-parser.ts`
- Session Manager: `packages/server/src/adapters/session-manager.ts`
- Client: `packages/ui/src/components/workspace/Workspace.tsx`
- Schema: `packages/server/src/persistence/schema.sql`

### External Documentation

- [Claude Code SDK](https://github.com/anthropics/claude-code)
- [T3Code Repository](https://github.com/pingdotgg/t3code)
- [SQLite FTS5](https://www.sqlite.org/fts5.html)

---

## Changelog

| Date | Change | Author |
|------|--------|--------|
| 2026-03-26 | Initial research and architectural decision | Agent |
| 2026-03-26 | Implementation of Approach 2 | Agent |

---

**End of Document**
