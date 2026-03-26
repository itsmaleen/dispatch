# Console Line Persistence Implementation Plan

## Overview

Implement SQLite-based persistence for agent console output with lazy loading, virtual scrolling, full-text search, and compression. This ensures console output survives app restarts, enables searching for session resumption and memory creation, and manages storage efficiently.

### Key Features
- ✅ **Virtual Scrolling**: Already implemented (handles 50k+ lines)
- 🆕 **Persistence**: Unlimited storage in SQLite
- 🔍 **Full-Text Search**: FTS5 for finding past sessions and creating memories
- 📦 **Compression**: Automatic compression of old lines
- ♾️ **No Pruning**: Keep indefinitely (manual cleanup only)

## Architecture

```
┌─────────────────────────────────┐
│  React UI (Workspace.tsx)       │
│  - Virtual scrolling (✓ Done)   │
│  - Displays in-memory lines     │
│  - Lazy loads on scroll to top  │
└──────────┬──────────────────────┘
           │ WebSocket/IPC
┌──────────▼──────────────────────┐
│  Server (Node.js)               │
│  - ConsoleLineStore service     │
│  - Append lines to DB           │
│  - Serve paginated queries      │
└──────────┬──────────────────────┘
           │
┌──────────▼──────────────────────┐
│  SQLite Database                │
│  ~/.acc/threads.db              │
│  - console_lines table          │
│  - Indexed by console_id        │
└─────────────────────────────────┘
```

## Database Schema

### New Table: `console_lines`

```sql
-- Console output lines for agent consoles
-- Supports unlimited output with lazy loading, search, and compression
CREATE TABLE IF NOT EXISTS console_lines (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  line_id TEXT NOT NULL UNIQUE,              -- UUID from ConsoleLine.id
  console_id TEXT NOT NULL,                  -- Which console (thread_id or adapter_id)
  sequence INTEGER NOT NULL,                 -- Order within console (auto-increment per console)
  type TEXT NOT NULL,                        -- 'prompt' | 'thinking' | 'tool_call' | etc.
  content TEXT NOT NULL,                     -- Line content (may be compressed)
  timestamp TEXT NOT NULL,                   -- ISO timestamp
  is_streaming BOOLEAN DEFAULT FALSE,        -- Currently streaming
  is_compressed BOOLEAN DEFAULT FALSE,       -- Content is gzip compressed

  -- Optional fields for special line types
  block_index INTEGER,                       -- For tool_call lines
  block_id TEXT,                             -- Block ID from SDK
  tool_name TEXT,                            -- Tool name for tool_call
  item_id TEXT,                              -- Activity item ID
  tool_input_json TEXT,                      -- Tool input (JSON)
  tool_result_json TEXT,                     -- Tool result (JSON)

  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Indexes for fast queries
CREATE INDEX IF NOT EXISTS idx_console_lines_console_id
  ON console_lines(console_id, sequence DESC);

CREATE INDEX IF NOT EXISTS idx_console_lines_timestamp
  ON console_lines(timestamp DESC);

CREATE INDEX IF NOT EXISTS idx_console_lines_line_id
  ON console_lines(line_id);

-- FTS5 virtual table for full-text search
-- Enables: session resumption, memory creation, debugging
CREATE VIRTUAL TABLE IF NOT EXISTS console_lines_fts USING fts5(
  console_id UNINDEXED,
  type UNINDEXED,
  content,
  content='console_lines',
  content_rowid='id'
);

-- Triggers to keep FTS index in sync
CREATE TRIGGER IF NOT EXISTS console_lines_fts_insert AFTER INSERT ON console_lines
BEGIN
  INSERT INTO console_lines_fts(rowid, console_id, type, content)
  VALUES (new.id, new.console_id, new.type, new.content);
END;

CREATE TRIGGER IF NOT EXISTS console_lines_fts_delete AFTER DELETE ON console_lines
BEGIN
  INSERT INTO console_lines_fts(console_lines_fts, rowid, console_id, type, content)
  VALUES('delete', old.id, old.console_id, old.type, old.content);
END;

CREATE TRIGGER IF NOT EXISTS console_lines_fts_update AFTER UPDATE OF content ON console_lines
BEGIN
  INSERT INTO console_lines_fts(console_lines_fts, rowid, console_id, type, content)
  VALUES('delete', old.id, old.console_id, old.type, old.content);
  INSERT INTO console_lines_fts(rowid, console_id, type, content)
  VALUES (new.id, new.console_id, new.type, new.content);
END;
```

### Migration: Version 5

Add this as Migration 5 in `sqlite-store.ts`:

```typescript
// Migration 5: Add console_lines table with FTS5 search and compression
if (currentVersion < 5) {
  console.log('[SqliteThreadStore] Running migration 5: Console lines with search');

  // Main table
  this.db.exec(`
    CREATE TABLE IF NOT EXISTS console_lines (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      line_id TEXT NOT NULL UNIQUE,
      console_id TEXT NOT NULL,
      sequence INTEGER NOT NULL,
      type TEXT NOT NULL,
      content TEXT NOT NULL,
      timestamp TEXT NOT NULL,
      is_streaming BOOLEAN DEFAULT FALSE,
      is_compressed BOOLEAN DEFAULT FALSE,
      block_index INTEGER,
      block_id TEXT,
      tool_name TEXT,
      item_id TEXT,
      tool_input_json TEXT,
      tool_result_json TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);

  // Indexes
  this.db.exec(`
    CREATE INDEX IF NOT EXISTS idx_console_lines_console_id
    ON console_lines(console_id, sequence DESC);
  `);

  this.db.exec(`
    CREATE INDEX IF NOT EXISTS idx_console_lines_timestamp
    ON console_lines(timestamp DESC);
  `);

  this.db.exec(`
    CREATE INDEX IF NOT EXISTS idx_console_lines_line_id
    ON console_lines(line_id);
  `);

  // FTS5 for search
  this.db.exec(`
    CREATE VIRTUAL TABLE IF NOT EXISTS console_lines_fts USING fts5(
      console_id UNINDEXED,
      type UNINDEXED,
      content,
      content='console_lines',
      content_rowid='id'
    );
  `);

  // FTS triggers
  this.db.exec(`
    CREATE TRIGGER IF NOT EXISTS console_lines_fts_insert AFTER INSERT ON console_lines
    BEGIN
      INSERT INTO console_lines_fts(rowid, console_id, type, content)
      VALUES (new.id, new.console_id, new.type, new.content);
    END;
  `);

  this.db.exec(`
    CREATE TRIGGER IF NOT EXISTS console_lines_fts_delete AFTER DELETE ON console_lines
    BEGIN
      INSERT INTO console_lines_fts(console_lines_fts, rowid, console_id, type, content)
      VALUES('delete', old.id, old.console_id, old.type, old.content);
    END;
  `);

  this.db.exec(`
    CREATE TRIGGER IF NOT EXISTS console_lines_fts_update AFTER UPDATE OF content ON console_lines
    BEGIN
      INSERT INTO console_lines_fts(console_lines_fts, rowid, console_id, type, content)
      VALUES('delete', old.id, old.console_id, old.type, old.content);
      INSERT INTO console_lines_fts(rowid, console_id, type, content)
      VALUES (new.id, new.console_id, new.type, new.content);
    END;
  `);

  this.recordMigration(5, 'Add console_lines table with FTS5 search and compression');
}
```

## TypeScript Types

### contracts/src/agent-console.ts

Add to existing agent-console types:

```typescript
/** Console line type */
export type ConsoleLineType =
  | 'prompt'
  | 'thinking'
  | 'tool_call'
  | 'tool_result'
  | 'output'
  | 'error'
  | 'info'
  | 'command'
  | 'system';

/** Persisted console line */
export interface PersistedConsoleLine {
  id: number;                    // DB auto-increment ID
  lineId: string;                // UUID from UI
  consoleId: string;             // Console/thread identifier
  sequence: number;              // Order within console
  type: ConsoleLineType;
  content: string;
  timestamp: string;             // ISO date string
  isStreaming: boolean;

  // Optional fields
  blockIndex?: number;
  blockId?: string;
  toolName?: string;
  itemId?: string;
  toolInput?: unknown;           // Parsed from JSON
  toolResult?: unknown;          // Parsed from JSON

  createdAt: string;             // When persisted
}

/** Options for querying console lines */
export interface GetConsoleLinesOptions {
  consoleId: string;
  limit?: number;                // Default: 1000
  beforeSequence?: number;       // Cursor-based pagination
  afterSequence?: number;        // For loading newer lines
}

/** Result of console lines query */
export interface ConsoleLinesResult {
  lines: PersistedConsoleLine[];
  hasMore: boolean;              // More lines available
  oldestSequence: number;        // For pagination
  newestSequence: number;
}

/** Search result for console lines */
export interface ConsoleLineSearchResult {
  line: PersistedConsoleLine;
  rank: number;                  // FTS5 relevance score
  snippet: string;               // Highlighted snippet
}

/** Options for searching console lines */
export interface SearchConsoleLinesOptions {
  query: string;                 // FTS5 search query
  consoleId?: string;            // Filter by console (optional)
  type?: ConsoleLineType;        // Filter by type (optional)
  limit?: number;                // Default: 50
}
```

## Service Implementation

### packages/server/src/services/console-line-store.ts

```typescript
/**
 * Console Line Store
 *
 * Persistent storage for agent console output lines.
 * Supports unlimited output with cursor-based pagination.
 */

import { DatabaseSync } from 'node:sqlite';
import type {
  PersistedConsoleLine,
  GetConsoleLinesOptions,
  ConsoleLinesResult
} from '@acc/contracts';

export interface ConsoleLineRow {
  id: number;
  line_id: string;
  console_id: string;
  sequence: number;
  type: string;
  content: string;
  timestamp: string;
  is_streaming: number;  // SQLite boolean (0/1)
  is_compressed: number; // SQLite boolean (0/1)
  block_index: number | null;
  block_id: string | null;
  tool_name: string | null;
  item_id: string | null;
  tool_input_json: string | null;
  tool_result_json: string | null;
  created_at: string;
}

export class ConsoleLineStore {
  constructor(private db: DatabaseSync) {}

  /**
   * Append new lines to a console
   */
  appendLines(
    consoleId: string,
    lines: Array<{
      lineId: string;
      type: string;
      content: string;
      timestamp: string;
      isStreaming?: boolean;
      blockIndex?: number;
      blockId?: string;
      toolName?: string;
      itemId?: string;
      toolInput?: unknown;
      toolResult?: unknown;
    }>
  ): void {
    if (lines.length === 0) return;

    const stmt = this.db.prepare(`
      INSERT INTO console_lines (
        line_id, console_id, sequence, type, content, timestamp,
        is_streaming, block_index, block_id, tool_name, item_id,
        tool_input_json, tool_result_json
      ) VALUES (?, ?,
        COALESCE((SELECT MAX(sequence) FROM console_lines WHERE console_id = ?), 0) + 1,
        ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
      )
    `);

    // Batch insert in transaction for performance
    this.db.exec('BEGIN TRANSACTION');
    try {
      for (const line of lines) {
        stmt.run(
          line.lineId,
          consoleId,
          consoleId,  // For subquery
          line.type,
          line.content,
          line.timestamp,
          line.isStreaming ? 1 : 0,
          line.blockIndex ?? null,
          line.blockId ?? null,
          line.toolName ?? null,
          line.itemId ?? null,
          line.toolInput ? JSON.stringify(line.toolInput) : null,
          line.toolResult ? JSON.stringify(line.toolResult) : null
        );
      }
      this.db.exec('COMMIT');
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }

  /**
   * Get recent lines for a console
   */
  getRecentLines(consoleId: string, limit: number = 1000): ConsoleLinesResult {
    const rows = this.db.prepare(`
      SELECT * FROM console_lines
      WHERE console_id = ?
      ORDER BY sequence DESC
      LIMIT ?
    `).all(consoleId, limit) as ConsoleLineRow[];

    return this.rowsToResult(rows);
  }

  /**
   * Get lines before a specific sequence (for lazy loading older lines)
   */
  getLinesBefore(
    consoleId: string,
    beforeSequence: number,
    limit: number = 500
  ): ConsoleLinesResult {
    const rows = this.db.prepare(`
      SELECT * FROM console_lines
      WHERE console_id = ? AND sequence < ?
      ORDER BY sequence DESC
      LIMIT ?
    `).all(consoleId, beforeSequence, limit) as ConsoleLineRow[];

    return this.rowsToResult(rows);
  }

  /**
   * Get lines after a specific sequence (for loading newer lines)
   */
  getLinesAfter(
    consoleId: string,
    afterSequence: number,
    limit: number = 500
  ): ConsoleLinesResult {
    const rows = this.db.prepare(`
      SELECT * FROM console_lines
      WHERE console_id = ? AND sequence > ?
      ORDER BY sequence ASC
      LIMIT ?
    `).all(consoleId, afterSequence, limit) as ConsoleLineRow[];

    return this.rowsToResult(rows.reverse());  // Reverse to DESC order
  }

  /**
   * Prune old lines, keeping only the most recent N
   */
  pruneOldLines(consoleId: string, keepLast: number = 50000): number {
    const result = this.db.prepare(`
      DELETE FROM console_lines
      WHERE console_id = ?
      AND sequence < (
        SELECT sequence FROM console_lines
        WHERE console_id = ?
        ORDER BY sequence DESC
        LIMIT 1 OFFSET ?
      )
    `).run(consoleId, consoleId, keepLast - 1);

    return result.changes ?? 0;
  }

  /**
   * Clear all lines for a console
   */
  clearConsole(consoleId: string): number {
    const result = this.db.prepare(`
      DELETE FROM console_lines WHERE console_id = ?
    `).run(consoleId);

    return result.changes ?? 0;
  }

  /**
   * Get line count for a console
   */
  getLineCount(consoleId: string): number {
    const row = this.db.prepare(`
      SELECT COUNT(*) as count FROM console_lines WHERE console_id = ?
    `).get(consoleId) as { count: number };

    return row.count;
  }

  /**
   * Search console lines using FTS5
   * Use cases: session resumption, memory creation, debugging
   */
  searchLines(
    query: string,
    options: {
      consoleId?: string;
      type?: string;
      limit?: number;
    } = {}
  ): ConsoleLineSearchResult[] {
    const { consoleId, type, limit = 50 } = options;

    let sql = `
      SELECT
        cl.*,
        fts.rank,
        snippet(console_lines_fts, 2, '<mark>', '</mark>', '...', 32) as snippet
      FROM console_lines_fts fts
      JOIN console_lines cl ON cl.id = fts.rowid
      WHERE console_lines_fts MATCH ?
    `;

    const params: any[] = [query];

    if (consoleId) {
      sql += ` AND cl.console_id = ?`;
      params.push(consoleId);
    }

    if (type) {
      sql += ` AND cl.type = ?`;
      params.push(type);
    }

    sql += ` ORDER BY fts.rank LIMIT ?`;
    params.push(limit);

    const rows = this.db.prepare(sql).all(...params) as Array<ConsoleLineRow & { rank: number; snippet: string }>;

    return rows.map(row => ({
      line: this.rowToLine(row),
      rank: row.rank,
      snippet: row.snippet,
    }));
  }

  /**
   * Compress old lines to save space
   * Compresses lines older than N sequences
   */
  compressOldLines(consoleId: string, olderThan: number = 1000): number {
    const { gzipSync } = require('node:zlib');
    let compressed = 0;

    // Get uncompressed old lines
    const rows = this.db.prepare(`
      SELECT id, content FROM console_lines
      WHERE console_id = ?
      AND is_compressed = 0
      AND sequence < (
        SELECT MAX(sequence) - ? FROM console_lines WHERE console_id = ?
      )
      LIMIT 500
    `).all(consoleId, olderThan, consoleId) as Array<{ id: number; content: string }>;

    if (rows.length === 0) return 0;

    const stmt = this.db.prepare(`
      UPDATE console_lines
      SET content = ?, is_compressed = 1
      WHERE id = ?
    `);

    this.db.exec('BEGIN TRANSACTION');
    try {
      for (const row of rows) {
        const compressed = gzipSync(Buffer.from(row.content)).toString('base64');
        stmt.run(compressed, row.id);
        compressed++;
      }
      this.db.exec('COMMIT');
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }

    return compressed;
  }

  /**
   * Export console to text format (optional feature)
   */
  exportToText(consoleId: string): string {
    const rows = this.db.prepare(`
      SELECT type, content, is_compressed, timestamp FROM console_lines
      WHERE console_id = ?
      ORDER BY sequence ASC
    `).all(consoleId) as Array<{
      type: string;
      content: string;
      is_compressed: number;
      timestamp: string;
    }>;

    return rows.map(row => {
      const time = new Date(row.timestamp).toISOString();
      let content = row.content;

      // Decompress if needed
      if (row.is_compressed) {
        const { gunzipSync } = require('node:zlib');
        content = gunzipSync(Buffer.from(content, 'base64')).toString('utf-8');
      }

      return `[${time}] [${row.type}] ${content}`;
    }).join('\n');
  }

  // ==================== Private Helpers ====================

  private rowsToResult(rows: ConsoleLineRow[]): ConsoleLinesResult {
    const lines = rows.map(this.rowToLine);

    return {
      lines,
      hasMore: rows.length > 0,  // Simplified - caller can check if limit reached
      oldestSequence: rows[rows.length - 1]?.sequence ?? 0,
      newestSequence: rows[0]?.sequence ?? 0,
    };
  }

  private rowToLine(row: ConsoleLineRow): PersistedConsoleLine {
    let content = row.content;

    // Decompress if needed
    if (row.is_compressed === 1) {
      const { gunzipSync } = require('node:zlib');
      content = gunzipSync(Buffer.from(content, 'base64')).toString('utf-8');
    }

    return {
      id: row.id,
      lineId: row.line_id,
      consoleId: row.console_id,
      sequence: row.sequence,
      type: row.type as any,
      content,
      timestamp: row.timestamp,
      isStreaming: row.is_streaming === 1,
      blockIndex: row.block_index ?? undefined,
      blockId: row.block_id ?? undefined,
      toolName: row.tool_name ?? undefined,
      itemId: row.item_id ?? undefined,
      toolInput: row.tool_input_json ? JSON.parse(row.tool_input_json) : undefined,
      toolResult: row.tool_result_json ? JSON.parse(row.tool_result_json) : undefined,
      createdAt: row.created_at,
    };
  }
}
```

## Integration Points

### 1. Text Delta Batcher Integration

In `Workspace.tsx`, integrate with the existing text delta batcher:

```typescript
// Modify createTextDeltaBatcher to also persist to DB
const batcher = createTextDeltaBatcher((batch) => {
  // Existing in-memory state update
  setTerminals(prev => {
    // ... existing logic ...
  });

  // NEW: Persist to database (async, non-blocking)
  for (const [terminalKey, { text, isThinking }] of batch) {
    persistConsoleLines(terminalKey, batch).catch(err =>
      console.error('Failed to persist console lines:', err)
    );
  }
});
```

### 2. Server API Endpoints

Add to `server.ts`:

```typescript
// Get recent console lines (on console open/resume)
app.get('/api/consoles/:consoleId/lines', async (req, res) => {
  const { consoleId } = req.params;
  const limit = parseInt(req.query.limit as string) || 1000;

  const result = consoleLineStore.getRecentLines(consoleId, limit);
  res.json(result);
});

// Get older lines (lazy loading)
app.get('/api/consoles/:consoleId/lines/before/:sequence', async (req, res) => {
  const { consoleId, sequence } = req.params;
  const limit = parseInt(req.query.limit as string) || 500;

  const result = consoleLineStore.getLinesBefore(
    consoleId,
    parseInt(sequence),
    limit
  );
  res.json(result);
});

// Search console lines (for session resumption, memory creation)
app.get('/api/consoles/search', async (req, res) => {
  const { q, consoleId, type, limit } = req.query;

  if (!q) {
    return res.status(400).json({ error: 'Query parameter "q" is required' });
  }

  const results = consoleLineStore.searchLines(q as string, {
    consoleId: consoleId as string | undefined,
    type: type as string | undefined,
    limit: limit ? parseInt(limit as string) : undefined,
  });

  res.json(results);
});

// Export console (optional feature)
app.get('/api/consoles/:consoleId/export', async (req, res) => {
  const { consoleId } = req.params;
  const text = consoleLineStore.exportToText(consoleId);

  res.setHeader('Content-Type', 'text/plain');
  res.setHeader('Content-Disposition', `attachment; filename="console-${consoleId}.txt"`);
  res.send(text);
});
```

### 3. Frontend Lazy Loading

In `Workspace.tsx`, add scroll detection for lazy loading:

```typescript
const [isLoadingOlder, setIsLoadingOlder] = useState(false);
const [hasMoreLines, setHasMoreLines] = useState(true);

const handleScroll = useCallback((e: React.UIEvent<HTMLDivElement>) => {
  const target = e.currentTarget;
  const scrollTop = target.scrollTop;

  // Near top? Load more lines from DB
  if (scrollTop < 200 && !isLoadingOlder && hasMoreLines) {
    loadOlderLines();
  }
}, [isLoadingOlder, hasMoreLines]);

const loadOlderLines = async () => {
  setIsLoadingOlder(true);
  try {
    const oldestSequence = consoleState.lines[0]?.sequence ?? 0;
    const response = await fetch(
      `/api/consoles/${consoleState.id}/lines/before/${oldestSequence}?limit=500`
    );
    const result: ConsoleLinesResult = await response.json();

    // Prepend to existing lines
    setTerminals(prev => prev.map(t =>
      t.id === consoleState.id
        ? { ...t, lines: [...result.lines, ...t.lines] }
        : t
    ));

    setHasMoreLines(result.hasMore);
  } catch (error) {
    console.error('Failed to load older lines:', error);
  } finally {
    setIsLoadingOlder(false);
  }
};
```

## Memory Management Strategy

### In-Memory Limits

```typescript
const IN_MEMORY_LINE_LIMIT = 10_000;  // Keep 10k lines in React state
const LAZY_LOAD_BATCH = 500;          // Load 500 lines at a time
const COMPRESSION_THRESHOLD = 1000;   // Compress lines older than 1k sequences
```

### Storage Strategy

**No Automatic Pruning** - Lines are kept indefinitely for:
- Session resumption
- Memory creation
- Historical debugging
- Manual cleanup only (future feature)

### Compression Strategy

Automatically compress old lines to save space:

```typescript
// In server.ts, periodic compression
setInterval(() => {
  const consoles = getAllActiveConsoleIds();
  for (const consoleId of consoles) {
    // Compress lines older than 1000 sequences
    const compressed = consoleLineStore.compressOldLines(consoleId, 1000);
    if (compressed > 0) {
      console.log(`Compressed ${compressed} lines from console ${consoleId}`);
    }
  }
}, 10 * 60 * 1000);  // Every 10 minutes
```

**Compression Benefits:**
- ~60-70% size reduction for typical console output
- Transparent decompression on read
- Only compresses old lines (keeps recent uncompressed for speed)
- Uses Node.js built-in zlib (no dependencies)

## Testing Strategy

### Unit Tests

```typescript
// packages/server/src/services/console-line-store.test.ts

describe('ConsoleLineStore', () => {
  test('append and retrieve lines', () => {
    // Test basic CRUD operations
  });

  test('cursor-based pagination', () => {
    // Test lazy loading
  });

  test('pruning old lines', () => {
    // Test cleanup logic
  });

  test('export to text', () => {
    // Test export functionality
  });
});
```

### Integration Tests

1. **High-volume output**: Generate 100k+ lines and verify performance
2. **Resume after restart**: Verify lines persist across app restarts
3. **Lazy loading**: Scroll to top and verify older lines load
4. **Concurrent writes**: Multiple consoles writing simultaneously

## Performance Considerations

### Write Performance

- **Batch inserts**: Use transactions for 32ms batches
- **Non-blocking**: Persist async, don't block UI updates
- **WAL mode**: SQLite Write-Ahead Logging for concurrent reads

### Read Performance

- **Indexed queries**: All queries use indexes
- **Cursor pagination**: No offset/limit (O(n)) queries
- **Virtual scrolling**: Only render visible lines

### Memory Usage

| Scenario | In-Memory | Database | Storage (Compressed) |
|----------|-----------|----------|---------------------|
| Small (1k lines) | 1k | 1k | ~200 KB (uncompressed) |
| Medium (10k lines) | 10k | 10k | ~2 MB (~800 KB) |
| Large (50k lines) | 10k | 50k | ~10 MB (~3.5 MB) |
| Huge (500k lines) | 10k | 500k | ~100 MB (~35 MB) |

*Compression ratio: ~60-70% for typical console output*

## Migration Plan

### Phase 1: Core Persistence + Search (Week 1)
- ✅ Add migration with FTS5 to sqlite-store.ts
- ✅ Add TypeScript types to contracts
- ✅ Create ConsoleLineStore service with search
- ✅ Add compression support
- ⚠️ Test migration on existing database

### Phase 2: Backend Integration (Week 2)
- ✅ Integrate with text delta batcher
- ✅ Add HTTP API endpoints (CRUD + search)
- ✅ Add compression background job
- ✅ Unit tests for store

### Phase 3: Frontend Integration (Week 3)
- ✅ Load initial lines from DB on console open
- ✅ Add lazy loading on scroll to top
- ✅ Add search UI component
- ✅ Add "Loading..." indicator
- ✅ Handle edge cases (empty, error states)

### Phase 4: Polish & Testing (Week 4)
- ✅ Integration tests (high-volume, search, compression)
- ✅ Performance optimization
- ⏸️ Export feature (optional, if needed)
- ⏸️ Manual cleanup UI (future)

## Open Questions & Decisions

1. **Console cleanup**: ✅ **DECIDED** - Keep indefinitely, manual cleanup only (future feature)
2. **Compression**: ✅ **DECIDED** - Yes, automatic compression of old lines (>1000 sequences)
3. **Search**: ✅ **DECIDED** - Yes, FTS5 for session resumption and memory creation
4. **Export**: ✅ **DECIDED** - Optional feature, lower priority
5. **Limits per console type**: ✅ **DECIDED** - Same limits for all (revisit if needed)

## Success Metrics

- ✅ Virtual scrolling handles 50k+ lines smoothly
- ⬜ Console output survives app restart
- ⬜ Lazy loading works seamlessly (no jank)
- ⬜ Search returns relevant results in <100ms
- ⬜ Compression reduces storage by ~60%
- ⬜ Database stays under 1GB for typical use (6-12 months)
- ⬜ No memory leaks after 1 hour of continuous output

---

**Status**: Phase 1 - Planning Complete & Updated with Requirements

**Key Changes from Review:**
- ✅ Added FTS5 full-text search (HIGH PRIORITY)
- ✅ Added compression support (gzip for old lines)
- ✅ Removed automatic pruning (keep indefinitely)
- ✅ Made export feature optional/lower priority

**Next Steps:**
1. Add Migration 5 to sqlite-store.ts (with FTS5 + compression)
2. Add types to contracts/agent-console.ts
3. Create ConsoleLineStore service with search + compression
4. Test migration on existing database
5. Begin Phase 2 backend integration

**Estimated Time:** 4 weeks (phased rollout)
