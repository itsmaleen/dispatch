# Console Line Persistence - Quick Reference

**Updated:** 2026-03-26
**Status:** ✅ Working

## How We Handle Session History

### TL;DR
**Claude Code's `.jsonl` files are the source of truth. We parse them once, cache in SQLite, and skip SDK event replay.**

---

## The Flow (30 Second Version)

1. **User opens console** → Client fetches `sessionId` from database
2. **Server checks** `~/.claude/projects/<path>/<sessionId>.jsonl`
3. **Parse .jsonl** → Extract all text/thinking/tool blocks
4. **Sync to database** (if not already there)
5. **Client loads from database** → Display instantly
6. **Mark as "resuming"** → Skip ALL SDK event replay
7. **SDK continues conversation** → Only new messages processed normally

---

## Key Files

| File | Purpose |
|------|---------|
| `claude-session-parser.ts` | Parses SDK `.jsonl` files into console lines |
| `session-manager.ts` (lines 179-360) | Syncs .jsonl to database on session creation |
| `Workspace.tsx` (lines 3230-3249) | Fetches sessionId from DB during layout restore |
| `Workspace.tsx` (lines 3923-3945) | Skips SDK events during resume phase |

---

## Why This Approach?

### ✅ Benefits
- **Fast**: Database already has parsed content
- **Correct**: Single source of truth (SDK .jsonl)
- **Searchable**: FTS5 full-text search across history
- **No Conflicts**: Skip SDK replay = no duplicates

### ❌ Previous Problem
- SDK event replay created empty lines during resume
- Overwrote database content → blank boxes

---

## How to Debug

### Check if sessionId is being fetched:
```javascript
// DevTools Console:
[Workspace] Fetched sessionId from database: {sessionId: "abc-123"}
[Workspace] Marked console as resuming (will skip SDK event replay)
```

### Check if .jsonl is being parsed:
```javascript
// Server logs:
[SessionManager] Syncing console lines from SDK session file: ~/.claude/...
[SessionManager] Synced 150 console lines from SDK to database
```

### Check database has content:
```bash
sqlite3 ~/.acc/threads.db "SELECT COUNT(*) FROM console_lines WHERE console_id = 'thread-...'"
```

---

## Related Docs

- **Full Architecture:** `.plans/console-persistence-architecture.md`
- **Final Implementation:** `.plans/console-persistence-final-implementation.md`

---

## Quick Fix Reference

**Blank lines appearing?**
1. Check DevTools Console for `hasSessionId: true`
2. Check server logs for "Syncing console lines"
3. Verify .jsonl exists: `ls ~/.claude/projects/*/`
4. Check database: `SELECT session_id FROM threads WHERE id = 'thread-...'`

**sessionId not found?**
- Thread may not have a saved session yet (new console)
- Expected behavior: will sync on next message

---

**Questions?** See full docs in `.plans/` directory.
