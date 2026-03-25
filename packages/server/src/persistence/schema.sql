-- ACC Thread & Session Persistence Schema
-- Event-sourced design inspired by T3 Code

-- Threads table (aggregate root)
CREATE TABLE IF NOT EXISTS threads (
  id TEXT PRIMARY KEY,
  name TEXT,
  project_path TEXT NOT NULL,
  worktree_path TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  last_active_at TEXT NOT NULL DEFAULT (datetime('now')),
  session_id TEXT,  -- SDK session ID for resume
  metadata_json TEXT DEFAULT '{}'
);

-- Messages table (separate for pagination)
CREATE TABLE IF NOT EXISTS messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  thread_id TEXT NOT NULL,
  turn_id TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
  content TEXT NOT NULL,
  timestamp TEXT NOT NULL DEFAULT (datetime('now')),
  input_tokens INTEGER,
  output_tokens INTEGER,
  cost_usd REAL,
  FOREIGN KEY (thread_id) REFERENCES threads(id) ON DELETE CASCADE
);

-- Events table (for full event sourcing if needed later)
CREATE TABLE IF NOT EXISTS events (
  sequence INTEGER PRIMARY KEY AUTOINCREMENT,
  event_id TEXT UNIQUE NOT NULL,
  thread_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  occurred_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (thread_id) REFERENCES threads(id) ON DELETE CASCADE
);

-- Console lines table (for agent console output persistence)
-- Added in Migration 5
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

-- FTS5 virtual table for console line search
CREATE VIRTUAL TABLE IF NOT EXISTS console_lines_fts USING fts5(
  console_id UNINDEXED,
  type UNINDEXED,
  content,
  content='console_lines',
  content_rowid='id'
);

-- Indexes for efficient queries
CREATE INDEX IF NOT EXISTS idx_messages_thread_id ON messages(thread_id);
CREATE INDEX IF NOT EXISTS idx_messages_thread_timestamp ON messages(thread_id, timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_events_thread_id ON events(thread_id);
CREATE INDEX IF NOT EXISTS idx_events_sequence ON events(sequence);
CREATE INDEX IF NOT EXISTS idx_threads_last_active ON threads(last_active_at DESC);
CREATE INDEX IF NOT EXISTS idx_console_lines_console_id ON console_lines(console_id, sequence DESC);
CREATE INDEX IF NOT EXISTS idx_console_lines_timestamp ON console_lines(timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_console_lines_line_id ON console_lines(line_id);
