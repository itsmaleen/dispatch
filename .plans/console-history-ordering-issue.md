# Console History Ordering Issue - Investigation

**Date:** 2026-03-26
**Issue:** Conversation history loading out of order - not seeing the last message/output, but instead seeing other output (possibly what was last saved in database)

## Problem Summary

When resuming a console session with persisted history, the lines appear in the wrong order in the UI. Users report not seeing the most recent messages at the bottom where they expect them.

## Root Cause Analysis

### The Data Flow

```
Database → API → UI → Display
  (DESC)    (DESC)  (DESC)  (WRONG!)
```

### Step-by-Step Breakdown

#### 1. Database Query (`console-line-store.ts:100-108`)

```typescript
getRecentLines(consoleId: string, limit: number = 1000): ConsoleLinesResult {
  const rows = this.db.prepare(`
    SELECT * FROM console_lines
    WHERE console_id = ?
    ORDER BY sequence DESC  // ← Returns NEWEST first
    LIMIT ?
  `).all(consoleId, limit) as ConsoleLineRow[];

  return this.rowsToResult(rows);
}
```

**Output:** `[newest, ..., oldest]` (DESC order)

#### 2. API Endpoint (`server.ts:1993-2008`)

```typescript
this.app.get('/api/consoles/:consoleId/lines', async (c) => {
  const consoleId = c.req.param('consoleId');
  const limit = parseInt(c.req.query('limit') || '1000');

  const store = getConsoleLineStore();
  const result = store.getRecentLines(consoleId, limit);  // ← Still DESC
  return c.json({ ok: true, ...result });  // ← Returns DESC to client
});
```

**Output:** JSON with `lines: [newest, ..., oldest]`

#### 3. UI Fetch (`Workspace.tsx:2943-2975`)

```typescript
const fetchConsoleLines = useCallback(async (consoleId: string, limit: number = 1000) => {
  const res = await fetch(`${getApiUrl()}/api/consoles/${consoleId}/lines?limit=${limit}`);
  const data = await res.json();
  return data;  // ← Still DESC: lines: [newest, ..., oldest]
}, []);
```

**Output:** `data.lines = [newest, ..., oldest]`

#### 4. UI Display Logic (`Workspace.tsx:4608-4646`)

**THE BUG:**

```typescript
const historyLines: ConsoleLine[] = data.lines.map(line => ({
  // ... convert to ConsoleLine format
}));

// historyLines is still: [newest, ..., oldest]

const newLines = [separatorLine, ...historyLines, systemLine];
//                                  ^^^^^^^^^^^^^^^
//                                  BUG: Should be reversed!

// Result: [separator, newest, ..., oldest, "Session resumed"]
// Expected: [separator, oldest, ..., newest, "Session resumed"]
```

The lines are spread directly without reversing, causing the display to show newest→oldest instead of oldest→newest.

## Why This Happens

### Evidence from Other Functions

Looking at `getLinesAfter` in `console-line-store.ts:132-145`:

```typescript
getLinesAfter(...): ConsoleLinesResult {
  const rows = this.db.prepare(`
    SELECT * FROM console_lines
    WHERE console_id = ? AND sequence > ?
    ORDER BY sequence ASC  // ← ASC here
    LIMIT ?
  `).all(consoleId, afterSequence, limit) as ConsoleLineRow[];

  return this.rowsToResult(rows.reverse());  // ← Then REVERSES to make DESC!
}
```

This shows that:
1. `rowsToResult()` **expects** rows in DESC order (newest first)
2. Other functions explicitly reverse when needed

### The Inconsistency

- `getRecentLines()`: Returns DESC, UI expects ASC → **BUG**
- `getLinesBefore()`: Returns DESC, UI expects DESC → OK (lazy load older)
- `getLinesAfter()`: Reverses to DESC, UI expects DESC → OK

## The Fix

### Option 1: Fix at Database Layer (Recommended)

**Reverse in `getRecentLines()` to match UI expectation:**

```typescript
getRecentLines(consoleId: string, limit: number = 1000): ConsoleLinesResult {
  const rows = this.db.prepare(`
    SELECT * FROM console_lines
    WHERE console_id = ?
    ORDER BY sequence DESC
    LIMIT ?
  `).all(consoleId, limit) as ConsoleLineRow[];

  return this.rowsToResult(rows.reverse());  // ← Add .reverse()
}
```

**Why this is best:**
- Matches the pattern from `getLinesAfter()`
- Centralizes the ordering logic
- UI receives data in expected order
- No changes needed to UI code

### Option 2: Fix at UI Layer

**Reverse in the UI when spreading:**

```typescript
const newLines = [separatorLine, ...historyLines.reverse(), systemLine];
```

**Why this is worse:**
- UI has to know about database ordering internals
- Inconsistent with how other endpoints work
- Harder to maintain

### Option 3: Change Database Query

**Change ORDER BY to ASC:**

```typescript
SELECT * FROM console_lines
WHERE console_id = ?
ORDER BY sequence ASC  // ← Change to ASC
LIMIT ?
```

**Why this is worst:**
- `rowsToResult()` expects DESC (see `oldestSequence` and `newestSequence` logic)
- Would break metadata calculation
- Inconsistent with other queries

## Related Code

### Metadata Calculation in `rowsToResult` (`console-line-store.ts:360-369`)

```typescript
private rowsToResult(rows: ConsoleLineRow[]): ConsoleLinesResult {
  const lines = rows.map(row => this.rowToLine(row));

  return {
    lines,
    hasMore: rows.length > 0,
    oldestSequence: rows[rows.length - 1]?.sequence ?? 0,  // ← Last item
    newestSequence: rows[0]?.sequence ?? 0,  // ← First item
  };
}
```

This **assumes** rows are in DESC order:
- `rows[0]` = newest (highest sequence)
- `rows[rows.length - 1]` = oldest (lowest sequence)

If we changed the query to ASC, this metadata would be wrong!

## Test Cases to Verify Fix

### Test 1: Resume with History
1. Create console, send 5 messages
2. Close app
3. Reopen, resume console
4. **Expected:** Messages appear in chronological order (oldest → newest)
5. **Expected:** Last message is at the bottom

### Test 2: Lazy Load Older Messages
1. Resume console with >1000 lines
2. Scroll to top, load more
3. **Expected:** Older messages load in correct order above existing
4. **Expected:** No duplicates, smooth pagination

### Test 3: New Message After Resume
1. Resume console with history
2. Send new message
3. **Expected:** New message appears after history
4. **Expected:** Chronological order maintained

### Test 4: Empty History
1. Resume console with no persisted lines
2. **Expected:** Only "Session resumed" message
3. **Expected:** No errors

## Implementation Plan

### Phase 1: Add `.reverse()` to `getRecentLines()`

**File:** `packages/server/src/services/console-line-store.ts`

**Change:**
```diff
  getRecentLines(consoleId: string, limit: number = 1000): ConsoleLinesResult {
    const rows = this.db.prepare(`
      SELECT * FROM console_lines
      WHERE console_id = ?
      ORDER BY sequence DESC
      LIMIT ?
    `).all(consoleId, limit) as ConsoleLineRow[];

-   return this.rowsToResult(rows);
+   return this.rowsToResult(rows.reverse());
  }
```

### Phase 2: Add Comment Explaining Order

**Add documentation:**
```typescript
/**
 * Get recent lines for a console
 *
 * @returns Lines in ASC order (oldest → newest) for chronological display
 *
 * Note: Query fetches DESC to get most recent lines efficiently,
 * then reverses for chronological display order.
 */
getRecentLines(consoleId: string, limit: number = 1000): ConsoleLinesResult {
  // ...
}
```

### Phase 3: Add Tests

**File:** `packages/server/src/services/console-line-store.test.ts` (if exists)

```typescript
describe('ConsoleLineStore', () => {
  it('getRecentLines returns lines in chronological order', () => {
    // Insert lines with sequences 1, 2, 3, 4, 5
    store.appendLines('test-console', [
      { lineId: 'line-1', /* ... */ },
      { lineId: 'line-2', /* ... */ },
      { lineId: 'line-3', /* ... */ },
    ]);

    const result = store.getRecentLines('test-console', 10);

    // First line should have lowest sequence (oldest)
    expect(result.lines[0].sequence).toBe(1);
    // Last line should have highest sequence (newest)
    expect(result.lines[result.lines.length - 1].sequence).toBe(3);
  });
});
```

## Additional Cleanup Opportunities

### Issue 1: Confusing `rowsToResult` Behavior

The function `rowsToResult` doesn't document that it expects DESC order. Should add:

```typescript
/**
 * Convert database rows to API result format
 *
 * @param rows - Database rows in DESC order (newest first)
 * @returns Result with lines, metadata, and pagination info
 *
 * Note: Metadata (oldestSequence, newestSequence) assumes DESC order.
 * If rows are not in DESC order, metadata will be incorrect!
 */
private rowsToResult(rows: ConsoleLineRow[]): ConsoleLinesResult {
  // ...
}
```

### Issue 2: Inconsistent Ordering Conventions

Different functions have different ordering:
- `getRecentLines()`: Should return ASC for UI (currently buggy)
- `getLinesBefore()`: Returns DESC for prepending (correct)
- `getLinesAfter()`: Returns DESC for appending (correct)

**Recommendation:** Document the expected order for each function clearly.

### Issue 3: No Type Safety for Order

We could use TypeScript to make ordering explicit:

```typescript
type OrderedLines<Order extends 'ASC' | 'DESC'> = {
  order: Order;
  lines: PersistedConsoleLine[];
  // ...
};

getRecentLines(...): OrderedLines<'ASC'> {
  // Must return ASC
}

getLinesBefore(...): OrderedLines<'DESC'> {
  // Must return DESC
}
```

This would catch ordering bugs at compile time!

## Conclusion

**The bug:** `getRecentLines()` returns lines in DESC order, but the UI expects ASC order for chronological display.

**The fix:** Add `.reverse()` to `getRecentLines()` to return ASC order.

**Risk level:** Low - Single line change, matches pattern from `getLinesAfter()`

**Testing:** Manual testing with resume flow, verify chronological order

---

## File References

- **Issue Location:** `packages/server/src/services/console-line-store.ts:100-108`
- **UI Consumption:** `packages/ui/src/components/workspace/Workspace.tsx:4608-4646`
- **Related Functions:** `console-line-store.ts:132-145` (`getLinesAfter`)
- **Metadata Logic:** `console-line-store.ts:360-369` (`rowsToResult`)

---

## FIXES IMPLEMENTED - 2026-03-26

### ✅ Fix 1: Ordering in `getRecentLines()` 
**File:** `packages/server/src/services/console-line-store.ts:105-114`
- Added `.reverse()` to return chronological order (oldest → newest)
- Added documentation explaining the ordering behavior

### ✅ Fix 2: Metadata Calculation in `rowsToResult()`
**File:** `packages/server/src/services/console-line-store.ts:371-386`  
- Changed from array position to Math.min()/Math.max() on sequence values
- Now works correctly regardless of row order (ASC or DESC)

### ✅ Fix 3: Sync Logic Bug
**File:** `packages/server/src/adapters/session-manager.ts:222-230`
- Replaced non-existent `getLatestLines()` with `getLineCount()`
- Now properly checks if console has existing lines before syncing

### Status
**All fixes implemented.** Ready for rebuild and testing.
