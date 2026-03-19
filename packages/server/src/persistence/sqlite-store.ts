/**
 * SQLite-based Thread Store
 * 
 * Persistent storage for threads and messages using Node.js 22+ built-in SQLite.
 * No native modules - works in any Node.js 22+ runtime including Electron.
 */

import { DatabaseSync } from 'node:sqlite';
import * as fs from 'fs';
import * as path from 'path';

const SCHEMA_SQL = `
-- Threads table (aggregate root)
CREATE TABLE IF NOT EXISTS threads (
  id TEXT PRIMARY KEY,
  name TEXT,
  project_path TEXT NOT NULL,
  worktree_path TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  last_active_at TEXT NOT NULL DEFAULT (datetime('now')),
  session_id TEXT,
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

-- Indexes
CREATE INDEX IF NOT EXISTS idx_messages_thread_id ON messages(thread_id);
CREATE INDEX IF NOT EXISTS idx_messages_thread_timestamp ON messages(thread_id, timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_threads_last_active ON threads(last_active_at DESC);
`;

export interface ThreadRow {
  id: string;
  name: string | null;
  project_path: string;
  worktree_path: string | null;
  created_at: string;
  last_active_at: string;
  session_id: string | null;
  metadata_json: string;
}

export interface MessageRow {
  id: number;
  thread_id: string;
  turn_id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: string;
  input_tokens: number | null;
  output_tokens: number | null;
  cost_usd: number | null;
}

export interface Thread {
  id: string;
  name?: string;
  projectPath: string;
  worktreePath?: string;
  createdAt: Date;
  lastActiveAt: Date;
  sessionId?: string;
  metadata?: Record<string, unknown>;
}

export interface Message {
  id: number;
  threadId: string;
  turnId: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: Date;
  usage?: {
    inputTokens: number;
    outputTokens: number;
    costUsd?: number;
  };
}

export interface ListThreadsOptions {
  limit?: number;
  offset?: number;
}

export interface ListMessagesOptions {
  limit?: number;
  beforeId?: number;  // Cursor-based pagination
  afterId?: number;
}

const DB_DIR = path.join(process.env.HOME || '~', '.acc');
const DB_PATH = path.join(DB_DIR, 'threads.db');

export class SqliteThreadStore {
  private db: DatabaseSync;
  
  constructor(dbPath: string = DB_PATH) {
    // Ensure directory exists
    const dir = path.dirname(dbPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    
    this.db = new DatabaseSync(dbPath);
    this.db.exec('PRAGMA journal_mode = WAL');
    this.db.exec('PRAGMA foreign_keys = ON');
    this.init();
  }

  private init(): void {
    this.db.exec(SCHEMA_SQL);
    console.log('[SqliteThreadStore] Initialized database');
  }

  // ==================== Thread Operations ====================

  createThread(thread: Omit<Thread, 'createdAt' | 'lastActiveAt'>): Thread {
    const now = new Date().toISOString();
    const stmt = this.db.prepare(`
      INSERT INTO threads (id, name, project_path, worktree_path, created_at, last_active_at, session_id, metadata_json)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);
    
    stmt.run(
      thread.id,
      thread.name ?? null,
      thread.projectPath,
      thread.worktreePath ?? null,
      now,
      now,
      thread.sessionId ?? null,
      JSON.stringify(thread.metadata ?? {})
    );

    return {
      ...thread,
      createdAt: new Date(now),
      lastActiveAt: new Date(now),
    };
  }

  getThread(threadId: string): Thread | null {
    const stmt = this.db.prepare(`SELECT * FROM threads WHERE id = ?`);
    const row = stmt.get(threadId) as ThreadRow | undefined;
    return row ? this.rowToThread(row) : null;
  }

  listThreads(options: ListThreadsOptions = {}): Thread[] {
    const { limit = 50, offset = 0 } = options;
    const stmt = this.db.prepare(`
      SELECT * FROM threads 
      ORDER BY last_active_at DESC 
      LIMIT ? OFFSET ?
    `);
    const rows = stmt.all(limit, offset) as ThreadRow[];
    return rows.map(r => this.rowToThread(r));
  }

  updateThread(threadId: string, update: Partial<Pick<Thread, 'name' | 'metadata' | 'worktreePath'>> & { sessionId?: string | null }): void {
    const sets: string[] = ['last_active_at = datetime(\'now\')'];
    const values: unknown[] = [];

    if (update.name !== undefined) {
      sets.push('name = ?');
      values.push(update.name);
    }
    if (update.sessionId !== undefined) {
      sets.push('session_id = ?');
      values.push(update.sessionId ?? null); // Support clearing sessionId with null
    }
    if (update.metadata !== undefined) {
      sets.push('metadata_json = ?');
      values.push(JSON.stringify(update.metadata));
    }
    if ('worktreePath' in update) {
      sets.push('worktree_path = ?');
      values.push(update.worktreePath === undefined ? null : update.worktreePath);
    }

    values.push(threadId);
    const stmt = this.db.prepare(`UPDATE threads SET ${sets.join(', ')} WHERE id = ?`);
    stmt.run(...values);
  }

  touchThread(threadId: string): void {
    const stmt = this.db.prepare(`UPDATE threads SET last_active_at = datetime('now') WHERE id = ?`);
    stmt.run(threadId);
  }

  deleteThread(threadId: string): void {
    const stmt = this.db.prepare(`DELETE FROM threads WHERE id = ?`);
    stmt.run(threadId);
  }

  // ==================== Message Operations ====================

  appendMessage(message: Omit<Message, 'id' | 'timestamp'>): Message {
    const now = new Date().toISOString();
    const stmt = this.db.prepare(`
      INSERT INTO messages (thread_id, turn_id, role, content, timestamp, input_tokens, output_tokens, cost_usd)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);
    
    const result = stmt.run(
      message.threadId,
      message.turnId,
      message.role,
      message.content,
      now,
      message.usage?.inputTokens ?? null,
      message.usage?.outputTokens ?? null,
      message.usage?.costUsd ?? null
    );

    // Touch the thread's last_active_at
    this.touchThread(message.threadId);

    return {
      ...message,
      id: Number(result.lastInsertRowid),
      timestamp: new Date(now),
    };
  }

  getMessages(threadId: string, options: ListMessagesOptions = {}): Message[] {
    const { limit = 100, beforeId, afterId } = options;
    
    let sql = `SELECT * FROM messages WHERE thread_id = ?`;
    const params: unknown[] = [threadId];

    if (beforeId !== undefined) {
      sql += ` AND id < ?`;
      params.push(beforeId);
    }
    if (afterId !== undefined) {
      sql += ` AND id > ?`;
      params.push(afterId);
    }

    sql += ` ORDER BY id ${afterId !== undefined ? 'ASC' : 'DESC'} LIMIT ?`;
    params.push(limit);

    const stmt = this.db.prepare(sql);
    const rows = stmt.all(...params) as MessageRow[];
    
    // If we fetched in DESC order (for beforeId), reverse to chronological
    if (afterId === undefined) {
      rows.reverse();
    }

    return rows.map(r => this.rowToMessage(r));
  }

  getMessageCount(threadId: string): number {
    const stmt = this.db.prepare(`SELECT COUNT(*) as count FROM messages WHERE thread_id = ?`);
    const result = stmt.get(threadId) as { count: number };
    return result.count;
  }

  getLastMessage(threadId: string): Message | null {
    const stmt = this.db.prepare(`
      SELECT * FROM messages WHERE thread_id = ? ORDER BY id DESC LIMIT 1
    `);
    const row = stmt.get(threadId) as MessageRow | undefined;
    return row ? this.rowToMessage(row) : null;
  }

  // ==================== Fork ====================

  forkThread(sourceThreadId: string, newThreadId: string, options: { name?: string; upToMessageId?: number } = {}): Thread {
    const source = this.getThread(sourceThreadId);
    if (!source) {
      throw new Error(`Thread ${sourceThreadId} not found`);
    }

    // Create new thread
    const forked = this.createThread({
      id: newThreadId,
      name: options.name ?? `Fork of ${source.name}`,
      projectPath: source.projectPath,
      worktreePath: source.worktreePath,
      metadata: { forkedFrom: sourceThreadId },
    });

    // Copy messages
    let sql = `
      INSERT INTO messages (thread_id, turn_id, role, content, timestamp, input_tokens, output_tokens, cost_usd)
      SELECT ?, turn_id, role, content, timestamp, input_tokens, output_tokens, cost_usd
      FROM messages WHERE thread_id = ?
    `;
    const params: unknown[] = [newThreadId, sourceThreadId];

    if (options.upToMessageId !== undefined) {
      sql += ` AND id <= ?`;
      params.push(options.upToMessageId);
    }

    sql += ` ORDER BY id`;
    
    const stmt = this.db.prepare(sql);
    stmt.run(...params);

    return forked;
  }

  // ==================== Helpers ====================

  private rowToThread(row: ThreadRow): Thread {
    return {
      id: row.id,
      name: row.name ?? undefined,
      projectPath: row.project_path,
      worktreePath: row.worktree_path ?? undefined,
      createdAt: new Date(row.created_at),
      lastActiveAt: new Date(row.last_active_at),
      sessionId: row.session_id ?? undefined,
      metadata: JSON.parse(row.metadata_json || '{}'),
    };
  }

  private rowToMessage(row: MessageRow): Message {
    const message: Message = {
      id: row.id,
      threadId: row.thread_id,
      turnId: row.turn_id,
      role: row.role,
      content: row.content,
      timestamp: new Date(row.timestamp),
    };

    if (row.input_tokens !== null || row.output_tokens !== null) {
      message.usage = {
        inputTokens: row.input_tokens ?? 0,
        outputTokens: row.output_tokens ?? 0,
        costUsd: row.cost_usd ?? undefined,
      };
    }

    return message;
  }

  close(): void {
    this.db.close();
  }
}

// Singleton
let _store: SqliteThreadStore | null = null;

export function getThreadStore(): SqliteThreadStore {
  if (!_store) {
    _store = new SqliteThreadStore();
  }
  return _store;
}

// Async version for compatibility (just wraps sync)
export async function getThreadStoreAsync(): Promise<SqliteThreadStore> {
  return getThreadStore();
}
