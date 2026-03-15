/**
 * Task Store
 * 
 * SQLite persistence for extracted tasks.
 * Uses Node.js 22+ built-in SQLite (node:sqlite) - no native modules needed.
 */

import { DatabaseSync } from 'node:sqlite';
import * as fs from 'fs';
import * as path from 'path';

const SCHEMA_SQL = `
-- Tasks extracted from agent outputs
CREATE TABLE IF NOT EXISTS tasks (
  id TEXT PRIMARY KEY,
  text TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('doing', 'pending', 'completed', 'suggested', 'dismissed')),
  category TEXT NOT NULL CHECK (category IN ('doing', 'planned', 'suggested', 'completed')),
  confidence REAL DEFAULT 0.5,
  
  -- Source tracking
  thread_id TEXT,
  turn_id TEXT,
  agent_id TEXT,
  agent_name TEXT,
  
  -- Timestamps
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  completed_at TEXT,
  
  -- For deduplication
  text_hash TEXT
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);
CREATE INDEX IF NOT EXISTS idx_tasks_thread ON tasks(thread_id);
CREATE INDEX IF NOT EXISTS idx_tasks_agent ON tasks(agent_id);
CREATE INDEX IF NOT EXISTS idx_tasks_text_hash ON tasks(text_hash);
CREATE INDEX IF NOT EXISTS idx_tasks_created ON tasks(created_at DESC);
`;

export interface Task {
  id: string;
  text: string;
  status: 'doing' | 'pending' | 'completed' | 'suggested' | 'dismissed';
  category: 'doing' | 'planned' | 'suggested' | 'completed';
  confidence: number;
  threadId?: string;
  turnId?: string;
  agentId?: string;
  agentName?: string;
  createdAt: Date;
  updatedAt: Date;
  completedAt?: Date;
}

interface TaskRow {
  id: string;
  text: string;
  status: string;
  category: string;
  confidence: number;
  thread_id: string | null;
  turn_id: string | null;
  agent_id: string | null;
  agent_name: string | null;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
  text_hash: string | null;
}

export interface CreateTaskInput {
  text: string;
  category: 'doing' | 'planned' | 'suggested' | 'completed';
  confidence?: number;
  threadId?: string;
  turnId?: string;
  agentId?: string;
  agentName?: string;
}

export interface ListTasksOptions {
  status?: Task['status'] | Task['status'][];
  agentId?: string;
  threadId?: string;
  limit?: number;
  includeCompleted?: boolean;
}

const DB_DIR = path.join(process.env.HOME || '~', '.acc');
const DB_PATH = path.join(DB_DIR, 'tasks.db');

export class TaskStore {
  private db: DatabaseSync;

  constructor(dbPath: string = DB_PATH) {
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
    console.log('[TaskStore] Initialized');
  }

  /** Create a simple hash for deduplication */
  private hashText(text: string): string {
    // Simple hash - normalize and hash first 100 chars
    const normalized = text.toLowerCase().replace(/\s+/g, ' ').trim().slice(0, 100);
    let hash = 0;
    for (let i = 0; i < normalized.length; i++) {
      const char = normalized.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash;
    }
    return hash.toString(36);
  }

  /** Check if similar task exists (for dedup) */
  private findSimilar(text: string, agentId?: string): Task | null {
    const hash = this.hashText(text);
    
    // Look for same hash in last 24 hours, same agent, not completed
    const sql = `
      SELECT * FROM tasks 
      WHERE text_hash = ? 
        AND status NOT IN ('completed', 'dismissed')
        AND created_at > datetime('now', '-1 day')
        ${agentId ? 'AND agent_id = ?' : ''}
      LIMIT 1
    `;
    
    const stmt = this.db.prepare(sql);
    const row = agentId 
      ? stmt.get(hash, agentId) as TaskRow | undefined
      : stmt.get(hash) as TaskRow | undefined;
    
    return row ? this.rowToTask(row) : null;
  }

  /**
   * Find an existing task for the same thread/agent and text so we can update its status
   */
  findExistingForStatusUpdate(
    threadId: string,
    agentId: string,
    text: string,
    forStatus: 'doing' | 'completed'
  ): Task | null {
    const hash = this.hashText(text);
    const statusCondition =
      forStatus === 'completed'
        ? "AND status IN ('pending', 'doing')"
        : "AND status = 'pending'";
    const stmt = this.db.prepare(`
      SELECT * FROM tasks
      WHERE text_hash = ?
        AND thread_id = ?
        AND agent_id = ?
        AND created_at > datetime('now', '-1 day')
        ${statusCondition}
      ORDER BY updated_at DESC
      LIMIT 1
    `);
    const row = stmt.get(hash, threadId, agentId) as TaskRow | undefined;
    return row ? this.rowToTask(row) : null;
  }

  /** Create a task (with deduplication) */
  createTask(input: CreateTaskInput): Task | null {
    // Check for duplicate
    const existing = this.findSimilar(input.text, input.agentId);
    if (existing) {
      // Update existing task instead of creating duplicate
      this.touchTask(existing.id);
      return existing;
    }

    const id = `task-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const now = new Date().toISOString();
    
    // Map category to initial status
    const status = input.category === 'completed' ? 'completed'
      : input.category === 'doing' ? 'doing'
      : input.category === 'suggested' ? 'suggested'
      : 'pending';  // 'planned' → 'pending'

    const stmt = this.db.prepare(`
      INSERT INTO tasks (id, text, status, category, confidence, thread_id, turn_id, agent_id, agent_name, created_at, updated_at, completed_at, text_hash)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      id,
      input.text,
      status,
      input.category,
      input.confidence ?? 0.5,
      input.threadId ?? null,
      input.turnId ?? null,
      input.agentId ?? null,
      input.agentName ?? null,
      now,
      now,
      status === 'completed' ? now : null,
      this.hashText(input.text)
    );

    return this.getTask(id);
  }

  /** Get task by ID */
  getTask(id: string): Task | null {
    const stmt = this.db.prepare('SELECT * FROM tasks WHERE id = ?');
    const row = stmt.get(id) as TaskRow | undefined;
    return row ? this.rowToTask(row) : null;
  }

  /** List tasks with filters */
  listTasks(options: ListTasksOptions = {}): Task[] {
    const { status, agentId, threadId, limit = 50, includeCompleted = false } = options;

    let sql = 'SELECT * FROM tasks WHERE 1=1';
    const params: unknown[] = [];

    if (status) {
      if (Array.isArray(status)) {
        sql += ` AND status IN (${status.map(() => '?').join(',')})`;
        params.push(...status);
      } else {
        sql += ' AND status = ?';
        params.push(status);
      }
    } else if (!includeCompleted) {
      sql += ' AND status NOT IN (\'completed\', \'dismissed\')';
    }

    if (agentId) {
      sql += ' AND agent_id = ?';
      params.push(agentId);
    }

    if (threadId) {
      sql += ' AND thread_id = ?';
      params.push(threadId);
    }

    sql += ' ORDER BY CASE status WHEN \'doing\' THEN 0 WHEN \'pending\' THEN 1 WHEN \'suggested\' THEN 2 ELSE 3 END, created_at DESC';
    sql += ' LIMIT ?';
    params.push(limit);

    const stmt = this.db.prepare(sql);
    const rows = stmt.all(...params) as TaskRow[];
    return rows.map(r => this.rowToTask(r));
  }

  /** Get active tasks (doing) */
  getActiveTasks(): Task[] {
    return this.listTasks({ status: 'doing' });
  }

  /** Get pending tasks */
  getPendingTasks(): Task[] {
    return this.listTasks({ status: 'pending' });
  }

  /** Get suggested tasks */
  getSuggestedTasks(): Task[] {
    return this.listTasks({ status: 'suggested' });
  }

  /** Update task status */
  updateStatus(id: string, status: Task['status']): void {
    const now = new Date().toISOString();
    const completedAt = status === 'completed' ? now : null;
    
    const stmt = this.db.prepare(`
      UPDATE tasks SET status = ?, updated_at = ?, completed_at = COALESCE(?, completed_at)
      WHERE id = ?
    `);
    stmt.run(status, now, completedAt, id);
  }

  /** Mark task as doing */
  startTask(id: string): void {
    this.updateStatus(id, 'doing');
  }

  /** Mark task as completed */
  completeTask(id: string): void {
    this.updateStatus(id, 'completed');
  }

  /** Dismiss a suggested task */
  dismissTask(id: string): void {
    this.updateStatus(id, 'dismissed');
  }

  /** Touch task (update timestamp without changing status) */
  touchTask(id: string): void {
    const stmt = this.db.prepare('UPDATE tasks SET updated_at = datetime(\'now\') WHERE id = ?');
    stmt.run(id);
  }

  /** Complete all "doing" tasks for a thread/agent when turn ends */
  completeActiveTasks(threadId?: string, agentId?: string): number {
    let sql = 'UPDATE tasks SET status = \'completed\', completed_at = datetime(\'now\'), updated_at = datetime(\'now\') WHERE status = \'doing\'';
    const params: string[] = [];
    
    if (threadId) {
      sql += ' AND thread_id = ?';
      params.push(threadId);
    }
    if (agentId) {
      sql += ' AND agent_id = ?';
      params.push(agentId);
    }

    const stmt = this.db.prepare(sql);
    const result = stmt.run(...params);
    return result.changes as number;
  }

  /** Get recent completed tasks */
  getRecentlyCompleted(limit = 10): Task[] {
    const stmt = this.db.prepare(`
      SELECT * FROM tasks 
      WHERE status = 'completed' 
      ORDER BY completed_at DESC 
      LIMIT ?
    `);
    const rows = stmt.all(limit) as TaskRow[];
    return rows.map(r => this.rowToTask(r));
  }

  /** Get task counts by status */
  getCounts(): Record<Task['status'], number> {
    const stmt = this.db.prepare(`
      SELECT status, COUNT(*) as count FROM tasks GROUP BY status
    `);
    const rows = stmt.all() as Array<{ status: string; count: number }>;
    
    const counts: Record<string, number> = {
      doing: 0,
      pending: 0,
      completed: 0,
      suggested: 0,
      dismissed: 0,
    };
    
    for (const row of rows) {
      counts[row.status] = row.count;
    }
    
    return counts as Record<Task['status'], number>;
  }

  private rowToTask(row: TaskRow): Task {
    return {
      id: row.id,
      text: row.text,
      status: row.status as Task['status'],
      category: row.category as Task['category'],
      confidence: row.confidence,
      threadId: row.thread_id ?? undefined,
      turnId: row.turn_id ?? undefined,
      agentId: row.agent_id ?? undefined,
      agentName: row.agent_name ?? undefined,
      createdAt: new Date(row.created_at),
      updatedAt: new Date(row.updated_at),
      completedAt: row.completed_at ? new Date(row.completed_at) : undefined,
    };
  }

  close(): void {
    this.db.close();
  }
}

// Singleton
let _store: TaskStore | null = null;

export function getTaskStore(): TaskStore {
  if (!_store) {
    _store = new TaskStore();
  }
  return _store;
}
