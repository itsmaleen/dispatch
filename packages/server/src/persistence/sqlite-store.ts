/**
 * SQLite-based Thread Store
 * 
 * Persistent storage for threads and messages using Node.js 22+ built-in SQLite.
 * No native modules - works in any Node.js 22+ runtime including Electron.
 */

import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import * as fs from 'fs';
import * as path from 'path';

const SCHEMA_SQL = `
-- Threads table (aggregate root)
-- Note: Columns added via migrations are not in base schema to support upgrades
CREATE TABLE IF NOT EXISTS threads (
  id TEXT PRIMARY KEY,
  name TEXT,
  project_path TEXT NOT NULL,
  worktree_path TEXT,
  worktree_branch TEXT,
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

-- Schema migrations tracking
CREATE TABLE IF NOT EXISTS schema_migrations (
  version INTEGER PRIMARY KEY,
  applied_at TEXT NOT NULL DEFAULT (datetime('now')),
  description TEXT
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_messages_thread_id ON messages(thread_id);
CREATE INDEX IF NOT EXISTS idx_messages_thread_timestamp ON messages(thread_id, timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_threads_last_active ON threads(last_active_at DESC);
`;

// Session status types for resume functionality
export type SessionStatus = 'active' | 'suspended' | 'closed' | 'archived';

export interface ThreadRow {
  id: string;
  name: string | null;
  project_path: string;
  worktree_path: string | null;
  worktree_branch: string | null;  // Migration 6: git branch name for worktree
  created_at: string;
  last_active_at: string;
  session_id: string | null;
  session_cwd: string | null;  // Migration 4: path used when session was created
  metadata_json: string;
  // Session resume fields (Migration 1)
  status: SessionStatus | null;
  last_prompt: string | null;
  message_count: number | null;
  layout_panel_id: string | null;
  closed_at: string | null;
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
  worktreeBranch?: string;  // Git branch name for worktree isolation
  createdAt: Date;
  lastActiveAt: Date;
  sessionId?: string;
  /** The cwd used when the session was created (for correct resume path) */
  sessionCwd?: string;
  metadata?: Record<string, unknown>;
  // Session resume fields (Migration 1) - all optional for backwards compatibility
  status?: SessionStatus;
  lastPrompt?: string;
  messageCount?: number;
  layoutPanelId?: string;
  closedAt?: Date;
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
    this.runMigrations();
    console.log('[SqliteThreadStore] Initialized database');
  }

  // ==================== Migration System ====================

  private getSchemaVersion(): number {
    try {
      const row = this.db.prepare(
        'SELECT MAX(version) as version FROM schema_migrations'
      ).get() as { version: number | null } | undefined;
      return row?.version ?? 0;
    } catch {
      // Table might not exist yet
      return 0;
    }
  }

  private recordMigration(version: number, description: string): void {
    this.db.prepare(
      'INSERT INTO schema_migrations (version, description) VALUES (?, ?)'
    ).run(version, description);
    console.log(`[SqliteThreadStore] Applied migration ${version}: ${description}`);
  }

  private hasColumn(tableName: string, columnName: string): boolean {
    const tableInfo = this.db.prepare(
      `PRAGMA table_info(${tableName})`
    ).all() as Array<{ name: string }>;
    return tableInfo.some(col => col.name === columnName);
  }

  private runMigrations(): void {
    const currentVersion = this.getSchemaVersion();
    console.log(`[SqliteThreadStore] Current schema version: ${currentVersion}`);

    // Migration 1: Add session resume columns to threads table
    if (currentVersion < 1) {
      console.log('[SqliteThreadStore] Running migration 1: Session resume columns');

      if (!this.hasColumn('threads', 'status')) {
        this.db.exec(`ALTER TABLE threads ADD COLUMN status TEXT DEFAULT 'active'`);
      }
      if (!this.hasColumn('threads', 'last_prompt')) {
        this.db.exec(`ALTER TABLE threads ADD COLUMN last_prompt TEXT`);
      }
      if (!this.hasColumn('threads', 'message_count')) {
        this.db.exec(`ALTER TABLE threads ADD COLUMN message_count INTEGER DEFAULT 0`);
      }
      if (!this.hasColumn('threads', 'layout_panel_id')) {
        this.db.exec(`ALTER TABLE threads ADD COLUMN layout_panel_id TEXT`);
      }
      if (!this.hasColumn('threads', 'closed_at')) {
        this.db.exec(`ALTER TABLE threads ADD COLUMN closed_at TEXT`);
      }

      // Add indexes for session queries
      this.db.exec(`CREATE INDEX IF NOT EXISTS idx_threads_status ON threads(status)`);
      this.db.exec(`CREATE INDEX IF NOT EXISTS idx_threads_project_status ON threads(project_path, status)`);

      this.recordMigration(1, 'Add session resume columns (status, last_prompt, message_count, layout_panel_id, closed_at)');
    }

    // Migration 2: Add FTS5 for message search (user prompts only)
    if (currentVersion < 2) {
      console.log('[SqliteThreadStore] Running migration 2: FTS5 message search');

      // Create FTS5 virtual table for searching user messages
      // We use content='' for a "contentless" table that just stores the index
      // This saves space since we already have the content in messages table
      this.db.exec(`
        CREATE VIRTUAL TABLE IF NOT EXISTS messages_fts USING fts5(
          thread_id,
          content,
          content='',
          contentless_delete=1
        );
      `);

      // Note: We'll populate this via triggers and a backfill
      // Triggers for keeping FTS in sync (only index user messages)
      this.db.exec(`
        CREATE TRIGGER IF NOT EXISTS messages_fts_insert AFTER INSERT ON messages
        WHEN new.role = 'user'
        BEGIN
          INSERT INTO messages_fts(rowid, thread_id, content)
          VALUES (new.id, new.thread_id, new.content);
        END;
      `);

      this.db.exec(`
        CREATE TRIGGER IF NOT EXISTS messages_fts_delete AFTER DELETE ON messages
        WHEN old.role = 'user'
        BEGIN
          INSERT INTO messages_fts(messages_fts, rowid, thread_id, content)
          VALUES('delete', old.id, old.thread_id, old.content);
        END;
      `);

      this.recordMigration(2, 'Add FTS5 full-text search for user messages');
    }

    // Migration 3: Backfill existing data
    if (currentVersion < 3) {
      console.log('[SqliteThreadStore] Running migration 3: Backfill existing data');

      // Backfill message_count for existing threads
      this.db.exec(`
        UPDATE threads SET message_count = (
          SELECT COUNT(*) FROM messages WHERE messages.thread_id = threads.id
        )
      `);

      // Backfill last_prompt for existing threads (last user message)
      this.db.exec(`
        UPDATE threads SET last_prompt = (
          SELECT content FROM messages
          WHERE messages.thread_id = threads.id
          AND messages.role = 'user'
          ORDER BY messages.id DESC
          LIMIT 1
        )
      `);

      // Backfill FTS index with existing user messages
      this.db.exec(`
        INSERT INTO messages_fts(rowid, thread_id, content)
        SELECT id, thread_id, content FROM messages WHERE role = 'user'
      `);

      this.recordMigration(3, 'Backfill message_count, last_prompt, and FTS index');
    }

    // Migration 4: Add session_cwd column to track which path was used when session was created
    // This fixes session resume when consoles are reopened from different paths (e.g., worktrees)
    if (currentVersion < 4) {
      console.log('[SqliteThreadStore] Running migration 4: Add session_cwd column');

      if (!this.hasColumn('threads', 'session_cwd')) {
        this.db.exec(`ALTER TABLE threads ADD COLUMN session_cwd TEXT`);
      }

      this.recordMigration(4, 'Add session_cwd column for correct session resume path');
    }

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

    // Migration 6: Add worktree_branch column to store git branch name for worktrees
    if (currentVersion < 6) {
      console.log('[SqliteThreadStore] Running migration 6: Add worktree_branch column');

      if (!this.hasColumn('threads', 'worktree_branch')) {
        this.db.exec(`ALTER TABLE threads ADD COLUMN worktree_branch TEXT`);
      }

      this.recordMigration(6, 'Add worktree_branch column for worktree isolation');
    }
  }

  // ==================== Thread Operations ====================

  createThread(thread: Omit<Thread, 'createdAt' | 'lastActiveAt'>): Thread {
    const now = new Date().toISOString();
    const stmt = this.db.prepare(`
      INSERT INTO threads (id, name, project_path, worktree_path, worktree_branch, created_at, last_active_at, session_id, metadata_json, status, last_prompt, message_count, layout_panel_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      thread.id,
      thread.name ?? null,
      thread.projectPath,
      thread.worktreePath ?? null,
      thread.worktreeBranch ?? null,
      now,
      now,
      thread.sessionId ?? null,
      JSON.stringify(thread.metadata ?? {}),
      thread.status ?? 'active',
      thread.lastPrompt ?? null,
      thread.messageCount ?? 0,
      thread.layoutPanelId ?? null
    );

    return {
      ...thread,
      createdAt: new Date(now),
      lastActiveAt: new Date(now),
      status: thread.status ?? 'active',
      messageCount: thread.messageCount ?? 0,
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

  updateThread(
    threadId: string,
    update: Partial<Pick<Thread, 'name' | 'metadata' | 'worktreePath' | 'worktreeBranch' | 'status' | 'lastPrompt' | 'layoutPanelId'>> & {
      sessionId?: string | null;
      sessionCwd?: string | null;
      closedAt?: Date | null;
      incrementMessageCount?: boolean;
    }
  ): void {
    const sets: string[] = ['last_active_at = datetime(\'now\')'];
    const values: SQLInputValue[] = [];

    if (update.name !== undefined) {
      sets.push('name = ?');
      values.push(update.name);
    }
    if (update.sessionId !== undefined) {
      sets.push('session_id = ?');
      values.push(update.sessionId ?? null);
    }
    if (update.sessionCwd !== undefined) {
      sets.push('session_cwd = ?');
      values.push(update.sessionCwd ?? null);
    }
    if (update.metadata !== undefined) {
      sets.push('metadata_json = ?');
      values.push(JSON.stringify(update.metadata));
    }
    if ('worktreePath' in update) {
      sets.push('worktree_path = ?');
      values.push(update.worktreePath === undefined ? null : update.worktreePath);
    }
    if ('worktreeBranch' in update) {
      sets.push('worktree_branch = ?');
      values.push(update.worktreeBranch === undefined ? null : update.worktreeBranch);
    }
    // Session resume fields
    if (update.status !== undefined) {
      sets.push('status = ?');
      values.push(update.status);
    }
    if (update.lastPrompt !== undefined) {
      sets.push('last_prompt = ?');
      values.push(update.lastPrompt);
    }
    if (update.layoutPanelId !== undefined) {
      sets.push('layout_panel_id = ?');
      values.push(update.layoutPanelId);
    }
    if (update.closedAt !== undefined) {
      sets.push('closed_at = ?');
      values.push(update.closedAt?.toISOString() ?? null);
    }
    if (update.incrementMessageCount) {
      sets.push('message_count = message_count + 1');
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

  // ==================== Session Operations ====================

  /**
   * List sessions (threads) with filtering by project and status
   */
  listSessions(options: {
    projectPath?: string;
    status?: SessionStatus[];
    limit?: number;
    offset?: number;
  } = {}): Thread[] {
    const { projectPath, status, limit = 50, offset = 0 } = options;

    let sql = 'SELECT * FROM threads WHERE 1=1';
    const params: SQLInputValue[] = [];

    if (projectPath) {
      sql += ' AND project_path = ?';
      params.push(projectPath);
    }

    if (status && status.length > 0) {
      sql += ` AND status IN (${status.map(() => '?').join(', ')})`;
      params.push(...status);
    }

    sql += ' ORDER BY last_active_at DESC LIMIT ? OFFSET ?';
    params.push(limit, offset);

    const stmt = this.db.prepare(sql);
    const rows = stmt.all(...params) as ThreadRow[];
    return rows.map(r => this.rowToThread(r));
  }

  /**
   * Get sessions that can be resumed (active or suspended)
   */
  getResumableSessions(projectPath: string): Thread[] {
    return this.listSessions({
      projectPath,
      status: ['active', 'suspended'],
    });
  }

  /**
   * Close a session (mark as closed, set closedAt timestamp)
   */
  closeSession(threadId: string): void {
    this.updateThread(threadId, {
      status: 'closed',
      closedAt: new Date(),
    });
  }

  /**
   * Suspend a session (mark as suspended - used when app closes)
   */
  suspendSession(threadId: string): void {
    this.updateThread(threadId, {
      status: 'suspended',
    });
  }

  /**
   * Reactivate a session (mark as active - used when resuming)
   */
  activateSession(threadId: string): void {
    this.updateThread(threadId, {
      status: 'active',
      closedAt: null,
    });
  }

  /**
   * Archive a session (hide from normal view but keep data)
   */
  archiveSession(threadId: string): void {
    this.updateThread(threadId, {
      status: 'archived',
    });
  }

  /**
   * Search sessions by message content using FTS5
   * Returns threads that have matching user messages
   */
  searchSessions(query: string, options: {
    projectPath?: string;
    limit?: number;
  } = {}): Array<Thread & { matchSnippet?: string }> {
    const { projectPath, limit = 20 } = options;

    // FTS5 search with snippet extraction
    // We join back to threads to get full thread data and filter by project
    let sql = `
      SELECT DISTINCT
        t.*,
        snippet(messages_fts, 1, '<mark>', '</mark>', '...', 32) as match_snippet
      FROM messages_fts
      JOIN threads t ON messages_fts.thread_id = t.id
      WHERE messages_fts MATCH ?
    `;
    const params: SQLInputValue[] = [query];

    if (projectPath) {
      sql += ' AND t.project_path = ?';
      params.push(projectPath);
    }

    sql += ' ORDER BY rank LIMIT ?';
    params.push(limit);

    const stmt = this.db.prepare(sql);
    const rows = stmt.all(...params) as Array<ThreadRow & { match_snippet: string | null }>;

    return rows.map(row => ({
      ...this.rowToThread(row),
      matchSnippet: row.match_snippet ?? undefined,
    }));
  }

  /**
   * Quick search by thread name or last prompt (no FTS, uses LIKE)
   */
  quickSearchSessions(query: string, options: {
    projectPath?: string;
    limit?: number;
  } = {}): Thread[] {
    const { projectPath, limit = 20 } = options;
    const likeQuery = `%${query}%`;

    let sql = `
      SELECT * FROM threads
      WHERE (name LIKE ? OR last_prompt LIKE ?)
    `;
    const params: SQLInputValue[] = [likeQuery, likeQuery];

    if (projectPath) {
      sql += ' AND project_path = ?';
      params.push(projectPath);
    }

    sql += ' ORDER BY last_active_at DESC LIMIT ?';
    params.push(limit);

    const stmt = this.db.prepare(sql);
    const rows = stmt.all(...params) as ThreadRow[];
    return rows.map(r => this.rowToThread(r));
  }

  /**
   * Suspend all active sessions for a project (used when switching workspaces)
   */
  suspendAllSessions(projectPath: string): number {
    const stmt = this.db.prepare(`
      UPDATE threads
      SET status = 'suspended', last_active_at = datetime('now')
      WHERE project_path = ? AND status = 'active'
    `);
    const result = stmt.run(projectPath);
    return Number(result.changes);
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

    // Update thread: touch last_active_at, increment message_count, update last_prompt if user message
    if (message.role === 'user') {
      this.updateThread(message.threadId, {
        lastPrompt: message.content,
        incrementMessageCount: true,
      });
    } else {
      this.updateThread(message.threadId, {
        incrementMessageCount: true,
      });
    }

    return {
      ...message,
      id: Number(result.lastInsertRowid),
      timestamp: new Date(now),
    };
  }

  getMessages(threadId: string, options: ListMessagesOptions = {}): Message[] {
    const { limit = 100, beforeId, afterId } = options;

    let sql = `SELECT * FROM messages WHERE thread_id = ?`;
    const params: SQLInputValue[] = [threadId];

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
    const params: SQLInputValue[] = [newThreadId, sourceThreadId];

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
      worktreeBranch: row.worktree_branch ?? undefined,
      createdAt: new Date(row.created_at),
      lastActiveAt: new Date(row.last_active_at),
      sessionId: row.session_id ?? undefined,
      sessionCwd: row.session_cwd ?? undefined,
      metadata: JSON.parse(row.metadata_json || '{}'),
      // Session resume fields
      status: row.status ?? 'active',
      lastPrompt: row.last_prompt ?? undefined,
      messageCount: row.message_count ?? 0,
      layoutPanelId: row.layout_panel_id ?? undefined,
      closedAt: row.closed_at ? new Date(row.closed_at) : undefined,
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

  /** Get the underlying database instance for shared access */
  getDatabase(): DatabaseSync {
    return this.db;
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

// ============================================================================
// CONSOLE LINE STORE
// ============================================================================

import { ConsoleLineStore } from '../services/console-line-store';

let _consoleLineStore: ConsoleLineStore | null = null;

export function getConsoleLineStore(): ConsoleLineStore {
  if (!_consoleLineStore) {
    const threadStore = getThreadStore();
    _consoleLineStore = new ConsoleLineStore(threadStore['db']); // Access private db field
  }
  return _consoleLineStore;
}

export async function getConsoleLineStoreAsync(): Promise<ConsoleLineStore> {
  return getConsoleLineStore();
}
