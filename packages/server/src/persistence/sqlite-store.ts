/**
 * SQLite-based Thread Store
 * 
 * Persistent storage for threads and messages using sql.js (pure JavaScript SQLite).
 * No native modules - works in any JavaScript runtime including Electron.
 */

import initSqlJs, { type Database as SqlJsDatabase } from 'sql.js';
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
  private db: SqlJsDatabase | null = null;
  private dbPath: string;
  private saveTimer: ReturnType<typeof setTimeout> | null = null;
  private dirty = false;
  
  constructor(dbPath: string = DB_PATH) {
    this.dbPath = dbPath;
  }

  /** Initialize the database - must be called before use */
  async init(): Promise<void> {
    // Ensure directory exists
    const dir = path.dirname(this.dbPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    // Initialize sql.js
    const SQL = await initSqlJs();
    
    // Load existing database or create new
    if (fs.existsSync(this.dbPath)) {
      const buffer = fs.readFileSync(this.dbPath);
      this.db = new SQL.Database(buffer);
    } else {
      this.db = new SQL.Database();
    }

    // Enable foreign keys
    this.db.run('PRAGMA foreign_keys = ON');
    
    // Initialize schema
    this.db.run(SCHEMA_SQL);
    
    console.log('[SqliteThreadStore] Initialized database');
  }

  private getDb(): SqlJsDatabase {
    if (!this.db) {
      throw new Error('Database not initialized. Call init() first.');
    }
    return this.db;
  }

  /** Mark database as dirty and schedule save */
  private markDirty(): void {
    this.dirty = true;
    if (!this.saveTimer) {
      this.saveTimer = setTimeout(() => {
        this.saveTimer = null;
        this.save();
      }, 1000); // Debounce saves by 1 second
    }
  }

  /** Save database to disk */
  save(): void {
    if (!this.dirty || !this.db) return;
    
    const data = this.db.export();
    const buffer = Buffer.from(data);
    fs.writeFileSync(this.dbPath, buffer);
    this.dirty = false;
  }

  // ==================== Thread Operations ====================

  createThread(thread: Omit<Thread, 'createdAt' | 'lastActiveAt'>): Thread {
    const db = this.getDb();
    const now = new Date().toISOString();
    
    db.run(`
      INSERT INTO threads (id, name, project_path, worktree_path, created_at, last_active_at, session_id, metadata_json)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `, [
      thread.id,
      thread.name ?? null,
      thread.projectPath,
      thread.worktreePath ?? null,
      now,
      now,
      thread.sessionId ?? null,
      JSON.stringify(thread.metadata ?? {})
    ]);

    this.markDirty();

    return {
      ...thread,
      createdAt: new Date(now),
      lastActiveAt: new Date(now),
    };
  }

  getThread(threadId: string): Thread | null {
    const db = this.getDb();
    const stmt = db.prepare(`SELECT * FROM threads WHERE id = ?`);
    stmt.bind([threadId]);
    
    if (stmt.step()) {
      const row = stmt.getAsObject() as unknown as ThreadRow;
      stmt.free();
      return this.rowToThread(row);
    }
    
    stmt.free();
    return null;
  }

  listThreads(options: ListThreadsOptions = {}): Thread[] {
    const db = this.getDb();
    const { limit = 50, offset = 0 } = options;
    
    const stmt = db.prepare(`
      SELECT * FROM threads 
      ORDER BY last_active_at DESC 
      LIMIT ? OFFSET ?
    `);
    stmt.bind([limit, offset]);
    
    const threads: Thread[] = [];
    while (stmt.step()) {
      const row = stmt.getAsObject() as unknown as ThreadRow;
      threads.push(this.rowToThread(row));
    }
    stmt.free();
    
    return threads;
  }

  updateThread(threadId: string, update: Partial<Pick<Thread, 'name' | 'sessionId' | 'metadata'>>): void {
    const db = this.getDb();
    const sets: string[] = ["last_active_at = datetime('now')"];
    const values: unknown[] = [];

    if (update.name !== undefined) {
      sets.push('name = ?');
      values.push(update.name);
    }
    if (update.sessionId !== undefined) {
      sets.push('session_id = ?');
      values.push(update.sessionId);
    }
    if (update.metadata !== undefined) {
      sets.push('metadata_json = ?');
      values.push(JSON.stringify(update.metadata));
    }

    values.push(threadId);
    db.run(`UPDATE threads SET ${sets.join(', ')} WHERE id = ?`, values);
    this.markDirty();
  }

  touchThread(threadId: string): void {
    const db = this.getDb();
    db.run(`UPDATE threads SET last_active_at = datetime('now') WHERE id = ?`, [threadId]);
    this.markDirty();
  }

  deleteThread(threadId: string): void {
    const db = this.getDb();
    db.run(`DELETE FROM threads WHERE id = ?`, [threadId]);
    this.markDirty();
  }

  // ==================== Message Operations ====================

  appendMessage(message: Omit<Message, 'id' | 'timestamp'>): Message {
    const db = this.getDb();
    const now = new Date().toISOString();
    
    db.run(`
      INSERT INTO messages (thread_id, turn_id, role, content, timestamp, input_tokens, output_tokens, cost_usd)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `, [
      message.threadId,
      message.turnId,
      message.role,
      message.content,
      now,
      message.usage?.inputTokens ?? null,
      message.usage?.outputTokens ?? null,
      message.usage?.costUsd ?? null
    ]);

    // Get the last inserted row id
    const result = db.exec('SELECT last_insert_rowid() as id');
    const id = result[0]?.values[0]?.[0] as number;

    // Touch the thread's last_active_at
    this.touchThread(message.threadId);
    this.markDirty();

    return {
      ...message,
      id,
      timestamp: new Date(now),
    };
  }

  getMessages(threadId: string, options: ListMessagesOptions = {}): Message[] {
    const db = this.getDb();
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

    const stmt = db.prepare(sql);
    stmt.bind(params);
    
    const messages: Message[] = [];
    while (stmt.step()) {
      const row = stmt.getAsObject() as unknown as MessageRow;
      messages.push(this.rowToMessage(row));
    }
    stmt.free();
    
    // If we fetched in DESC order (for beforeId), reverse to chronological
    if (afterId === undefined) {
      messages.reverse();
    }

    return messages;
  }

  getMessageCount(threadId: string): number {
    const db = this.getDb();
    const result = db.exec(`SELECT COUNT(*) as count FROM messages WHERE thread_id = ?`, [threadId]);
    return (result[0]?.values[0]?.[0] as number) ?? 0;
  }

  getLastMessage(threadId: string): Message | null {
    const db = this.getDb();
    const stmt = db.prepare(`
      SELECT * FROM messages WHERE thread_id = ? ORDER BY id DESC LIMIT 1
    `);
    stmt.bind([threadId]);
    
    if (stmt.step()) {
      const row = stmt.getAsObject() as unknown as MessageRow;
      stmt.free();
      return this.rowToMessage(row);
    }
    
    stmt.free();
    return null;
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
    const db = this.getDb();
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
    
    db.run(sql, params);
    this.markDirty();

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
    if (this.saveTimer) {
      clearTimeout(this.saveTimer);
      this.saveTimer = null;
    }
    this.save(); // Final save
    if (this.db) {
      this.db.close();
      this.db = null;
    }
  }
}

// Singleton with async initialization
let _store: SqliteThreadStore | null = null;
let _initPromise: Promise<SqliteThreadStore> | null = null;

export async function getThreadStoreAsync(): Promise<SqliteThreadStore> {
  if (_store) return _store;
  
  if (!_initPromise) {
    _initPromise = (async () => {
      const store = new SqliteThreadStore();
      await store.init();
      _store = store;
      return store;
    })();
  }
  
  return _initPromise;
}

// Synchronous getter (throws if not initialized)
export function getThreadStore(): SqliteThreadStore {
  if (!_store) {
    throw new Error('Thread store not initialized. Call getThreadStoreAsync() first.');
  }
  return _store;
}
