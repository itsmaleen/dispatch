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

-- Indexes for efficient queries
CREATE INDEX IF NOT EXISTS idx_messages_thread_id ON messages(thread_id);
CREATE INDEX IF NOT EXISTS idx_messages_thread_timestamp ON messages(thread_id, timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_events_thread_id ON events(thread_id);
CREATE INDEX IF NOT EXISTS idx_events_sequence ON events(sequence);
CREATE INDEX IF NOT EXISTS idx_threads_last_active ON threads(last_active_at DESC);
