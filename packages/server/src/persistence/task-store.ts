/**
 * Task Store
 * 
 * SQLite persistence for extracted tasks.
 * Uses Node.js 22+ built-in SQLite (node:sqlite) - no native modules needed.
 */

import { DatabaseSync } from 'node:sqlite';
import * as fs from 'fs';
import * as path from 'path';

// Base schema - does NOT include columns added by migrations (like project_path)
// This ensures CREATE TABLE IF NOT EXISTS works for both new and existing databases
// Columns added later are handled via migrations in runMigrations()
const SCHEMA_SQL = `
-- Tasks extracted from agent outputs
CREATE TABLE IF NOT EXISTS tasks (
  id TEXT PRIMARY KEY,
  text TEXT NOT NULL,
  summary TEXT,
  status TEXT NOT NULL CHECK (status IN ('doing', 'pending', 'completed', 'suggested', 'dismissed')),
  category TEXT NOT NULL CHECK (category IN ('doing', 'planned', 'suggested', 'completed')),
  confidence REAL DEFAULT 0.5,

  -- Source tracking (discriminated union)
  source_type TEXT CHECK (source_type IN ('prompt', 'extraction', 'plan', 'manual')),
  source_data TEXT,

  -- Legacy source tracking (kept for compatibility)
  thread_id TEXT,
  turn_id TEXT,
  agent_id TEXT,
  agent_name TEXT,

  -- Goal association
  goal_id TEXT,

  -- NOTE: project_path is added via migration 4, not in base schema

  -- Timestamps
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  completed_at TEXT,

  -- For deduplication
  text_hash TEXT
);

-- Goals table for organizing tasks
CREATE TABLE IF NOT EXISTS goals (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  description TEXT,
  created_via TEXT NOT NULL CHECK (created_via IN ('plan', 'manual', 'ai-suggestion', 'auto')),
  session_id TEXT,
  status TEXT NOT NULL CHECK (status IN ('active', 'completed', 'archived')) DEFAULT 'active',
  -- NOTE: project_path is added via migration 4, not in base schema
  -- NOTE: thread_id is added via migration 5
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  completed_at TEXT
);

-- Console threads table for tracking conversation context
CREATE TABLE IF NOT EXISTS console_threads (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  console_id TEXT NOT NULL,
  goal_id TEXT,
  project_path TEXT NOT NULL,
  worktree_path TEXT,
  status TEXT NOT NULL CHECK (status IN ('active', 'completed', 'abandoned')) DEFAULT 'active',
  previous_names_json TEXT DEFAULT '[]',
  topic_signature_json TEXT,
  session_count INTEGER DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_console_threads_console ON console_threads(console_id);
CREATE INDEX IF NOT EXISTS idx_console_threads_goal ON console_threads(goal_id);
CREATE INDEX IF NOT EXISTS idx_console_threads_project ON console_threads(project_path);
CREATE INDEX IF NOT EXISTS idx_console_threads_status ON console_threads(status);

-- Active sessions table for tracking running prompts
CREATE TABLE IF NOT EXISTS active_sessions (
  id TEXT PRIMARY KEY,
  agent_id TEXT NOT NULL,
  agent_name TEXT NOT NULL,
  summary TEXT NOT NULL,
  prompt_text TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('running', 'completed', 'failed')) DEFAULT 'running',
  -- NOTE: project_path is added via migration 4, not in base schema
  started_at TEXT NOT NULL DEFAULT (datetime('now')),
  completed_at TEXT,
  duration_ms INTEGER,
  dismissed INTEGER DEFAULT 0
);

-- Base indexes (for columns that exist in base schema)
CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);
CREATE INDEX IF NOT EXISTS idx_tasks_thread ON tasks(thread_id);
CREATE INDEX IF NOT EXISTS idx_tasks_agent ON tasks(agent_id);
CREATE INDEX IF NOT EXISTS idx_tasks_text_hash ON tasks(text_hash);
CREATE INDEX IF NOT EXISTS idx_tasks_created ON tasks(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_tasks_goal ON tasks(goal_id);
CREATE INDEX IF NOT EXISTS idx_tasks_source_type ON tasks(source_type);
-- NOTE: idx_tasks_project_path is created in migration 4

CREATE INDEX IF NOT EXISTS idx_goals_status ON goals(status);
CREATE INDEX IF NOT EXISTS idx_goals_session ON goals(session_id);
-- NOTE: idx_goals_project_path is created in migration 4

CREATE INDEX IF NOT EXISTS idx_active_sessions_status ON active_sessions(status);
-- NOTE: idx_active_sessions_project_path is created in migration 4
`;

import type {
  TaskSource,
  Goal,
  GoalStatus,
  GoalCreatedVia,
  ActiveSession,
  ExtractedTaskStatus,
  ExtractedTaskCategory,
  ConsoleThread,
  ThreadStatus,
} from '@acc/contracts';

export interface Task {
  id: string;
  text: string;
  summary?: string;
  status: ExtractedTaskStatus;
  category: ExtractedTaskCategory;
  confidence: number;
  source?: TaskSource;
  goalId?: string;
  consoleId?: string;
  projectPath?: string;
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
  summary: string | null;
  status: string;
  category: string;
  confidence: number;
  source_type: string | null;
  source_data: string | null;
  goal_id: string | null;
  console_id: string | null;
  project_path: string | null;
  thread_id: string | null;
  turn_id: string | null;
  agent_id: string | null;
  agent_name: string | null;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
  text_hash: string | null;
}

interface GoalRow {
  id: string;
  title: string;
  description: string | null;
  created_via: string;
  session_id: string | null;
  thread_id: string | null;
  project_path: string | null;
  status: string;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
}

interface ActiveSessionRow {
  id: string;
  agent_id: string;
  agent_name: string;
  summary: string;
  prompt_text: string;
  status: string;
  project_path: string | null;
  started_at: string;
  completed_at: string | null;
  duration_ms: number | null;
  dismissed: number;
}

interface ConsoleThreadRow {
  id: string;
  name: string;
  console_id: string;
  goal_id: string | null;
  project_path: string;
  worktree_path: string | null;
  status: string;
  previous_names_json: string;
  topic_signature_json: string | null;
  session_count: number;
  created_at: string;
  updated_at: string;
}

export interface CreateTaskInput {
  text: string;
  summary?: string;
  category: ExtractedTaskCategory;
  confidence?: number;
  source?: TaskSource;
  goalId?: string;
  consoleId?: string;
  projectPath?: string;
  threadId?: string;
  turnId?: string;
  agentId?: string;
  agentName?: string;
}

export interface ListTasksOptions {
  status?: ExtractedTaskStatus | ExtractedTaskStatus[];
  sourceType?: TaskSource['type'];
  goalId?: string;
  projectPath?: string;
  agentId?: string;
  threadId?: string;
  limit?: number;
  includeCompleted?: boolean;
}

export interface CreateGoalInput {
  title: string;
  description?: string;
  createdVia: GoalCreatedVia;
  sessionId?: string;
  projectPath?: string;
}

export interface ListGoalsOptions {
  status?: GoalStatus | GoalStatus[];
  sessionId?: string;
  projectPath?: string;
  limit?: number;
}

export interface CreateConsoleThreadInput {
  id?: string;
  name: string;
  consoleId: string;
  projectPath: string;
  worktreePath?: string;
}

export interface ListConsoleThreadsOptions {
  consoleId?: string;
  projectPath?: string;
  status?: ThreadStatus | ThreadStatus[];
  limit?: number;
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
    // Create migrations table first to track schema version
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version INTEGER PRIMARY KEY,
        applied_at TEXT NOT NULL DEFAULT (datetime('now')),
        description TEXT
      )
    `);

    // Run base schema (CREATE TABLE IF NOT EXISTS is safe)
    this.db.exec(SCHEMA_SQL);

    // Run versioned migrations
    this.runMigrations();
    console.log('[TaskStore] Initialized');
  }

  /** Get current schema version */
  private getSchemaVersion(): number {
    try {
      const row = this.db.prepare('SELECT MAX(version) as version FROM schema_migrations').get() as { version: number | null } | undefined;
      return row?.version ?? 0;
    } catch {
      return 0;
    }
  }

  /** Record that a migration was applied */
  private recordMigration(version: number, description: string): void {
    this.db.prepare('INSERT INTO schema_migrations (version, description) VALUES (?, ?)').run(version, description);
    console.log(`[TaskStore] Applied migration ${version}: ${description}`);
  }

  /** Check if a table has a specific column */
  private hasColumn(tableName: string, columnName: string): boolean {
    const tableInfo = this.db.prepare(`PRAGMA table_info(${tableName})`).all() as Array<{ name: string }>;
    return tableInfo.some(col => col.name === columnName);
  }

  /** Run schema migrations for existing databases */
  private runMigrations(): void {
    const currentVersion = this.getSchemaVersion();
    console.log(`[TaskStore] Current schema version: ${currentVersion}`);

    // Migration 1: Add goal_id column to tasks
    if (currentVersion < 1) {
      if (!this.hasColumn('tasks', 'goal_id')) {
        this.db.exec('ALTER TABLE tasks ADD COLUMN goal_id TEXT');
        this.db.exec('CREATE INDEX IF NOT EXISTS idx_tasks_goal ON tasks(goal_id)');
      }
      this.recordMigration(1, 'Add goal_id column to tasks');
    }

    // Migration 2: Add summary column to tasks
    if (currentVersion < 2) {
      if (!this.hasColumn('tasks', 'summary')) {
        this.db.exec('ALTER TABLE tasks ADD COLUMN summary TEXT');
      }
      this.recordMigration(2, 'Add summary column to tasks');
    }

    // Migration 3: Add source tracking columns to tasks
    if (currentVersion < 3) {
      if (!this.hasColumn('tasks', 'source_type')) {
        this.db.exec('ALTER TABLE tasks ADD COLUMN source_type TEXT');
        this.db.exec('ALTER TABLE tasks ADD COLUMN source_data TEXT');
        this.db.exec('CREATE INDEX IF NOT EXISTS idx_tasks_source_type ON tasks(source_type)');
      }
      this.recordMigration(3, 'Add source tracking columns to tasks');
    }

    // Migration 4: Add project_path column to all tables for workspace scoping
    if (currentVersion < 4) {
      // Tasks table
      if (!this.hasColumn('tasks', 'project_path')) {
        this.db.exec('ALTER TABLE tasks ADD COLUMN project_path TEXT');
        this.db.exec('CREATE INDEX IF NOT EXISTS idx_tasks_project_path ON tasks(project_path)');
      }

      // Goals table
      if (!this.hasColumn('goals', 'project_path')) {
        this.db.exec('ALTER TABLE goals ADD COLUMN project_path TEXT');
        this.db.exec('CREATE INDEX IF NOT EXISTS idx_goals_project_path ON goals(project_path)');
      }

      // Active sessions table
      if (!this.hasColumn('active_sessions', 'project_path')) {
        this.db.exec('ALTER TABLE active_sessions ADD COLUMN project_path TEXT');
        this.db.exec('CREATE INDEX IF NOT EXISTS idx_active_sessions_project_path ON active_sessions(project_path)');
      }

      this.recordMigration(4, 'Add project_path column to tasks, goals, and active_sessions');
    }

    // Migration 5: Add console_threads table and thread_id to goals
    if (currentVersion < 5) {
      // Create console_threads table if it doesn't exist (may exist from base schema for new DBs)
      this.db.exec(`
        CREATE TABLE IF NOT EXISTS console_threads (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          console_id TEXT NOT NULL,
          goal_id TEXT,
          project_path TEXT NOT NULL,
          worktree_path TEXT,
          status TEXT NOT NULL CHECK (status IN ('active', 'completed', 'abandoned')) DEFAULT 'active',
          previous_names_json TEXT DEFAULT '[]',
          topic_signature_json TEXT,
          session_count INTEGER DEFAULT 0,
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          updated_at TEXT NOT NULL DEFAULT (datetime('now'))
        )
      `);

      // Create indexes
      this.db.exec('CREATE INDEX IF NOT EXISTS idx_console_threads_console ON console_threads(console_id)');
      this.db.exec('CREATE INDEX IF NOT EXISTS idx_console_threads_goal ON console_threads(goal_id)');
      this.db.exec('CREATE INDEX IF NOT EXISTS idx_console_threads_project ON console_threads(project_path)');
      this.db.exec('CREATE INDEX IF NOT EXISTS idx_console_threads_status ON console_threads(status)');

      // Add thread_id column to goals for bidirectional reference
      if (!this.hasColumn('goals', 'thread_id')) {
        this.db.exec('ALTER TABLE goals ADD COLUMN thread_id TEXT');
        this.db.exec('CREATE INDEX IF NOT EXISTS idx_goals_thread ON goals(thread_id)');
      }

      // Add console_id column to tasks for Phase 3
      if (!this.hasColumn('tasks', 'console_id')) {
        this.db.exec('ALTER TABLE tasks ADD COLUMN console_id TEXT');
        this.db.exec('CREATE INDEX IF NOT EXISTS idx_tasks_console ON tasks(console_id)');
      }

      // Update goals created_via constraint to include 'auto'
      // SQLite doesn't support ALTER CONSTRAINT, but the check is in the INSERT
      // So we just need to ensure new inserts can use 'auto'

      this.recordMigration(5, 'Add console_threads table, thread_id to goals, console_id to tasks');
    }

    console.log('[TaskStore] Migrations complete');
  }

  /** Force run a specific migration check (for recovery scenarios) */
  public ensureLatestSchema(): void {
    console.log('[TaskStore] Ensuring latest schema...');

    // Always check project_path exists on all tables
    const tables = ['tasks', 'goals', 'active_sessions'];
    for (const table of tables) {
      if (!this.hasColumn(table, 'project_path')) {
        console.log(`[TaskStore] Adding missing project_path column to ${table}`);
        this.db.exec(`ALTER TABLE ${table} ADD COLUMN project_path TEXT`);
        this.db.exec(`CREATE INDEX IF NOT EXISTS idx_${table}_project_path ON ${table}(project_path)`);
      }
    }
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

    // Serialize source if provided
    const sourceType = input.source?.type ?? null;
    const sourceData = input.source ? JSON.stringify(input.source) : null;

    const stmt = this.db.prepare(`
      INSERT INTO tasks (id, text, summary, status, category, confidence, source_type, source_data, goal_id, console_id, project_path, thread_id, turn_id, agent_id, agent_name, created_at, updated_at, completed_at, text_hash)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      id,
      input.text,
      input.summary ?? null,
      status,
      input.category,
      input.confidence ?? 0.5,
      sourceType,
      sourceData,
      input.goalId ?? null,
      input.consoleId ?? null,
      input.projectPath ?? null,
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
    const { status, agentId, threadId, projectPath, limit = 50, includeCompleted = false } = options;

    let sql = 'SELECT * FROM tasks WHERE 1=1';
    const params: unknown[] = [];

    // Filter by project path (workspace scoping)
    if (projectPath) {
      sql += ' AND project_path = ?';
      params.push(projectPath);
    }

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
  getActiveTasks(projectPath?: string): Task[] {
    return this.listTasks({ status: 'doing', projectPath });
  }

  /** Get pending tasks */
  getPendingTasks(projectPath?: string): Task[] {
    return this.listTasks({ status: 'pending', projectPath });
  }

  /** Get suggested tasks */
  getSuggestedTasks(projectPath?: string): Task[] {
    return this.listTasks({ status: 'suggested', projectPath });
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

  /** Complete all "doing" tasks for a thread/agent when turn ends.
   * Returns the IDs of tasks that were completed. */
  completeActiveTasks(threadId?: string, agentId?: string): string[] {
    // First, find the tasks that will be completed
    let selectSql = 'SELECT id FROM tasks WHERE status = \'doing\'';
    const params: string[] = [];

    if (threadId) {
      selectSql += ' AND thread_id = ?';
      params.push(threadId);
    }
    if (agentId) {
      selectSql += ' AND agent_id = ?';
      params.push(agentId);
    }

    const selectStmt = this.db.prepare(selectSql);
    const rows = selectStmt.all(...params) as Array<{ id: string }>;
    const taskIds = rows.map(r => r.id);

    if (taskIds.length === 0) {
      return [];
    }

    // Now update them
    let updateSql = 'UPDATE tasks SET status = \'completed\', completed_at = datetime(\'now\'), updated_at = datetime(\'now\') WHERE status = \'doing\'';
    if (threadId) {
      updateSql += ' AND thread_id = ?';
    }
    if (agentId) {
      updateSql += ' AND agent_id = ?';
    }

    const updateStmt = this.db.prepare(updateSql);
    updateStmt.run(...params);

    return taskIds;
  }

  /** Get recent completed tasks */
  getRecentlyCompleted(limit = 10, projectPath?: string): Task[] {
    let sql = `
      SELECT * FROM tasks
      WHERE status = 'completed'
    `;
    const params: unknown[] = [];

    if (projectPath) {
      sql += ' AND project_path = ?';
      params.push(projectPath);
    }

    sql += ' ORDER BY completed_at DESC LIMIT ?';
    params.push(limit);

    const stmt = this.db.prepare(sql);
    const rows = stmt.all(...params) as TaskRow[];
    return rows.map(r => this.rowToTask(r));
  }

  /** Get task counts by status */
  getCounts(projectPath?: string): Record<Task['status'], number> {
    let sql = 'SELECT status, COUNT(*) as count FROM tasks';
    const params: unknown[] = [];

    if (projectPath) {
      sql += ' WHERE project_path = ?';
      params.push(projectPath);
    }

    sql += ' GROUP BY status';

    const stmt = this.db.prepare(sql);
    const rows = stmt.all(...params) as Array<{ status: string; count: number }>;

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
    let source: TaskSource | undefined;
    if (row.source_data) {
      try {
        source = JSON.parse(row.source_data) as TaskSource;
      } catch {
        // Ignore parse errors
      }
    }

    return {
      id: row.id,
      text: row.text,
      summary: row.summary ?? undefined,
      status: row.status as Task['status'],
      category: row.category as Task['category'],
      confidence: row.confidence,
      source,
      goalId: row.goal_id ?? undefined,
      consoleId: row.console_id ?? undefined,
      projectPath: row.project_path ?? undefined,
      threadId: row.thread_id ?? undefined,
      turnId: row.turn_id ?? undefined,
      agentId: row.agent_id ?? undefined,
      agentName: row.agent_name ?? undefined,
      createdAt: new Date(row.created_at),
      updatedAt: new Date(row.updated_at),
      completedAt: row.completed_at ? new Date(row.completed_at) : undefined,
    };
  }

  /** Update task's goal association */
  moveTaskToGoal(taskId: string, goalId: string | null): void {
    const stmt = this.db.prepare(`
      UPDATE tasks SET goal_id = ?, updated_at = datetime('now')
      WHERE id = ?
    `);
    stmt.run(goalId, taskId);
  }

  /** Get tasks by goal */
  getTasksByGoal(goalId: string, projectPath?: string): Task[] {
    let sql = `
      SELECT * FROM tasks WHERE goal_id = ?
    `;
    const params: unknown[] = [goalId];

    if (projectPath) {
      sql += ' AND project_path = ?';
      params.push(projectPath);
    }

    sql += ' ORDER BY CASE status WHEN \'doing\' THEN 0 WHEN \'pending\' THEN 1 WHEN \'suggested\' THEN 2 ELSE 3 END, created_at DESC';

    const stmt = this.db.prepare(sql);
    const rows = stmt.all(...params) as TaskRow[];
    return rows.map(r => this.rowToTask(r));
  }

  /** Get tasks without a goal (for Inbox) */
  getUnassignedTasks(projectPath?: string): Task[] {
    let sql = `
      SELECT * FROM tasks WHERE goal_id IS NULL AND status NOT IN ('completed', 'dismissed')
    `;
    const params: unknown[] = [];

    if (projectPath) {
      sql += ' AND project_path = ?';
      params.push(projectPath);
    }

    sql += ' ORDER BY CASE status WHEN \'doing\' THEN 0 WHEN \'pending\' THEN 1 WHEN \'suggested\' THEN 2 ELSE 3 END, created_at DESC';

    const stmt = this.db.prepare(sql);
    const rows = stmt.all(...params) as TaskRow[];
    return rows.map(r => this.rowToTask(r));
  }

  // ============================================================================
  // GOALS
  // ============================================================================

  /** Create a new goal */
  createGoal(input: CreateGoalInput): Goal {
    const id = `goal-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const now = new Date().toISOString();

    const stmt = this.db.prepare(`
      INSERT INTO goals (id, title, description, created_via, session_id, project_path, status, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, 'active', ?, ?)
    `);

    stmt.run(
      id,
      input.title,
      input.description ?? null,
      input.createdVia,
      input.sessionId ?? null,
      input.projectPath ?? null,
      now,
      now
    );

    return this.getGoal(id)!;
  }

  /** Get goal by ID */
  getGoal(id: string): Goal | null {
    const stmt = this.db.prepare('SELECT * FROM goals WHERE id = ?');
    const row = stmt.get(id) as GoalRow | undefined;
    return row ? this.rowToGoal(row) : null;
  }

  /** Get goal by session ID (for auto-grouping) */
  getGoalBySessionId(sessionId: string): Goal | null {
    const stmt = this.db.prepare(`
      SELECT * FROM goals WHERE session_id = ? AND status = 'active'
      ORDER BY created_at DESC LIMIT 1
    `);
    const row = stmt.get(sessionId) as GoalRow | undefined;
    return row ? this.rowToGoal(row) : null;
  }

  /** List goals with filters */
  listGoals(options: ListGoalsOptions = {}): Goal[] {
    const { status, sessionId, projectPath, limit = 50 } = options;

    let sql = 'SELECT * FROM goals WHERE 1=1';
    const params: unknown[] = [];

    if (projectPath) {
      sql += ' AND project_path = ?';
      params.push(projectPath);
    }

    if (status) {
      if (Array.isArray(status)) {
        sql += ` AND status IN (${status.map(() => '?').join(',')})`;
        params.push(...status);
      } else {
        sql += ' AND status = ?';
        params.push(status);
      }
    }

    if (sessionId) {
      sql += ' AND session_id = ?';
      params.push(sessionId);
    }

    sql += ' ORDER BY CASE status WHEN \'active\' THEN 0 WHEN \'completed\' THEN 1 ELSE 2 END, updated_at DESC';
    sql += ' LIMIT ?';
    params.push(limit);

    const stmt = this.db.prepare(sql);
    const rows = stmt.all(...params) as GoalRow[];
    return rows.map(r => this.rowToGoal(r));
  }

  /** Update goal */
  updateGoal(id: string, updates: Partial<Pick<Goal, 'title' | 'description' | 'status'>>): void {
    const now = new Date().toISOString();
    const completedAt = updates.status === 'completed' ? now : null;

    const fields: string[] = ['updated_at = ?'];
    const params: unknown[] = [now];

    if (updates.title !== undefined) {
      fields.push('title = ?');
      params.push(updates.title);
    }
    if (updates.description !== undefined) {
      fields.push('description = ?');
      params.push(updates.description);
    }
    if (updates.status !== undefined) {
      fields.push('status = ?');
      params.push(updates.status);
      if (completedAt) {
        fields.push('completed_at = ?');
        params.push(completedAt);
      }
    }

    params.push(id);

    const stmt = this.db.prepare(`UPDATE goals SET ${fields.join(', ')} WHERE id = ?`);
    stmt.run(...params);
  }

  /** Archive a goal */
  archiveGoal(id: string): void {
    this.updateGoal(id, { status: 'archived' });
  }

  /** Get or create the special "Inbox" goal */
  getOrCreateInbox(): Goal {
    const stmt = this.db.prepare(`
      SELECT * FROM goals WHERE title = 'Inbox' AND created_via = 'manual' AND status = 'active'
      LIMIT 1
    `);
    const row = stmt.get() as GoalRow | undefined;
    if (row) {
      return this.rowToGoal(row);
    }

    return this.createGoal({
      title: 'Inbox',
      description: 'Ungrouped tasks',
      createdVia: 'manual',
    });
  }

  private rowToGoal(row: GoalRow): Goal {
    // Compute task counts
    const countStmt = this.db.prepare(`
      SELECT
        COUNT(*) as total,
        SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) as completed
      FROM tasks WHERE goal_id = ?
    `);
    const counts = countStmt.get(row.id) as { total: number; completed: number };

    return {
      id: row.id,
      title: row.title,
      description: row.description ?? undefined,
      createdVia: row.created_via as GoalCreatedVia,
      sessionId: row.session_id ?? undefined,
      threadId: row.thread_id ?? undefined,
      projectPath: row.project_path ?? undefined,
      taskIds: [], // Populated separately if needed
      completedCount: counts?.completed ?? 0,
      totalCount: counts?.total ?? 0,
      status: row.status as GoalStatus,
      createdAt: new Date(row.created_at),
      updatedAt: new Date(row.updated_at),
      completedAt: row.completed_at ? new Date(row.completed_at) : undefined,
    };
  }

  // ============================================================================
  // ACTIVE SESSIONS (for Tier 1 - running prompts)
  // ============================================================================

  /** Start tracking an active session */
  startSession(input: {
    id: string;
    agentId: string;
    agentName: string;
    summary: string;
    promptText: string;
    projectPath?: string;
  }): ActiveSession {
    const now = new Date().toISOString();

    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO active_sessions (id, agent_id, agent_name, summary, prompt_text, status, project_path, started_at, dismissed)
      VALUES (?, ?, ?, ?, ?, 'running', ?, ?, 0)
    `);

    stmt.run(
      input.id,
      input.agentId,
      input.agentName,
      input.summary,
      input.promptText,
      input.projectPath ?? null,
      now
    );

    return this.getSession(input.id)!;
  }

  /** Complete an active session */
  completeSession(id: string, status: 'completed' | 'failed' = 'completed'): void {
    const now = new Date();
    const nowStr = now.toISOString();

    // Calculate duration
    const session = this.getSession(id);
    const durationMs = session ? now.getTime() - session.startedAt.getTime() : null;

    const stmt = this.db.prepare(`
      UPDATE active_sessions
      SET status = ?, completed_at = ?, duration_ms = ?
      WHERE id = ?
    `);
    stmt.run(status, nowStr, durationMs, id);
  }

  /** Get active session by ID */
  getSession(id: string): ActiveSession | null {
    const stmt = this.db.prepare('SELECT * FROM active_sessions WHERE id = ?');
    const row = stmt.get(id) as ActiveSessionRow | undefined;
    return row ? this.rowToSession(row) : null;
  }

  /** Get all currently running sessions */
  getActiveSessions(projectPath?: string): ActiveSession[] {
    let sql = `
      SELECT * FROM active_sessions WHERE status = 'running'
    `;
    const params: unknown[] = [];

    if (projectPath) {
      sql += ' AND project_path = ?';
      params.push(projectPath);
    }

    sql += ' ORDER BY started_at DESC';

    const stmt = this.db.prepare(sql);
    const rows = stmt.all(...params) as ActiveSessionRow[];
    return rows.map(r => this.rowToSession(r));
  }

  /** Get recently completed sessions (not dismissed) */
  getRecentlyCompletedSessions(limit = 10, projectPath?: string): ActiveSession[] {
    let sql = `
      SELECT * FROM active_sessions
      WHERE status IN ('completed', 'failed') AND dismissed = 0
    `;
    const params: unknown[] = [];

    if (projectPath) {
      sql += ' AND project_path = ?';
      params.push(projectPath);
    }

    sql += ' ORDER BY completed_at DESC LIMIT ?';
    params.push(limit);

    const stmt = this.db.prepare(sql);
    const rows = stmt.all(...params) as ActiveSessionRow[];
    return rows.map(r => this.rowToSession(r));
  }

  /** Update session summary (for AI-generated summaries) */
  updateSessionSummary(id: string, summary: string): void {
    const stmt = this.db.prepare(`
      UPDATE active_sessions SET summary = ? WHERE id = ?
    `);
    stmt.run(summary, id);
  }

  /** Dismiss a completed session from the "Recently Completed" list */
  dismissSession(id: string): void {
    const stmt = this.db.prepare(`
      UPDATE active_sessions SET dismissed = 1 WHERE id = ?
    `);
    stmt.run(id);
  }

  private rowToSession(row: ActiveSessionRow): ActiveSession {
    return {
      id: row.id,
      agentId: row.agent_id,
      agentName: row.agent_name,
      summary: row.summary,
      promptText: row.prompt_text,
      status: row.status as ActiveSession['status'],
      projectPath: row.project_path ?? undefined,
      startedAt: new Date(row.started_at),
      durationMs: row.duration_ms ?? undefined,
    };
  }

  // ============================================================================
  // CONSOLE THREADS (Phase 1 - Thread concept with naming)
  // ============================================================================

  /** Create a new console thread */
  createConsoleThread(input: CreateConsoleThreadInput): ConsoleThread {
    const id = input.id || `thread-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const now = new Date().toISOString();

    const stmt = this.db.prepare(`
      INSERT INTO console_threads (id, name, console_id, project_path, worktree_path, status, session_count, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, 'active', 0, ?, ?)
    `);

    stmt.run(
      id,
      input.name,
      input.consoleId,
      input.projectPath,
      input.worktreePath ?? null,
      now,
      now
    );

    return this.getConsoleThread(id)!;
  }

  /** Get console thread by ID */
  getConsoleThread(id: string): ConsoleThread | null {
    const stmt = this.db.prepare('SELECT * FROM console_threads WHERE id = ?');
    const row = stmt.get(id) as ConsoleThreadRow | undefined;
    return row ? this.rowToConsoleThread(row) : null;
  }

  /** Get active thread for a console */
  getActiveThreadForConsole(consoleId: string, projectPath?: string): ConsoleThread | null {
    let sql = `
      SELECT * FROM console_threads
      WHERE console_id = ? AND status = 'active'
    `;
    const params: unknown[] = [consoleId];

    if (projectPath) {
      sql += ' AND project_path = ?';
      params.push(projectPath);
    }

    sql += ' ORDER BY updated_at DESC LIMIT 1';

    const stmt = this.db.prepare(sql);
    const row = stmt.get(...params) as ConsoleThreadRow | undefined;
    return row ? this.rowToConsoleThread(row) : null;
  }

  /** List console threads with filters */
  listConsoleThreads(options: ListConsoleThreadsOptions = {}): ConsoleThread[] {
    const { consoleId, projectPath, status, limit = 50 } = options;

    let sql = 'SELECT * FROM console_threads WHERE 1=1';
    const params: unknown[] = [];

    if (consoleId) {
      sql += ' AND console_id = ?';
      params.push(consoleId);
    }

    if (projectPath) {
      sql += ' AND project_path = ?';
      params.push(projectPath);
    }

    if (status) {
      if (Array.isArray(status)) {
        sql += ` AND status IN (${status.map(() => '?').join(',')})`;
        params.push(...status);
      } else {
        sql += ' AND status = ?';
        params.push(status);
      }
    }

    sql += ' ORDER BY updated_at DESC LIMIT ?';
    params.push(limit);

    const stmt = this.db.prepare(sql);
    const rows = stmt.all(...params) as ConsoleThreadRow[];
    return rows.map(r => this.rowToConsoleThread(r));
  }

  /** Update console thread name */
  updateThreadName(id: string, newName: string, trackPrevious = true): void {
    const now = new Date().toISOString();

    if (trackPrevious) {
      // Get current name and add to history
      const thread = this.getConsoleThread(id);
      if (thread && thread.name !== newName) {
        const previousNames = thread.previousNames || [];
        previousNames.push(thread.name);

        const stmt = this.db.prepare(`
          UPDATE console_threads
          SET name = ?, previous_names_json = ?, updated_at = ?
          WHERE id = ?
        `);
        stmt.run(newName, JSON.stringify(previousNames), now, id);
        return;
      }
    }

    const stmt = this.db.prepare(`
      UPDATE console_threads SET name = ?, updated_at = ? WHERE id = ?
    `);
    stmt.run(newName, now, id);
  }

  /** Update thread topic signature */
  updateThreadTopicSignature(id: string, signature: { concepts: string[]; domain?: string }): void {
    const now = new Date().toISOString();
    const stmt = this.db.prepare(`
      UPDATE console_threads SET topic_signature_json = ?, updated_at = ? WHERE id = ?
    `);
    stmt.run(JSON.stringify(signature), now, id);
  }

  /** Link thread to a goal */
  linkThreadToGoal(threadId: string, goalId: string): void {
    const now = new Date().toISOString();

    // Update thread with goal reference
    const stmt1 = this.db.prepare(`
      UPDATE console_threads SET goal_id = ?, updated_at = ? WHERE id = ?
    `);
    stmt1.run(goalId, now, threadId);

    // Update goal with thread reference
    const stmt2 = this.db.prepare(`
      UPDATE goals SET thread_id = ?, updated_at = ? WHERE id = ?
    `);
    stmt2.run(threadId, now, goalId);
  }

  /** Increment session count for a thread */
  incrementThreadSessionCount(id: string): void {
    const now = new Date().toISOString();
    const stmt = this.db.prepare(`
      UPDATE console_threads SET session_count = session_count + 1, updated_at = ? WHERE id = ?
    `);
    stmt.run(now, id);
  }

  /** Update thread status */
  updateThreadStatus(id: string, status: ThreadStatus): void {
    const now = new Date().toISOString();
    const stmt = this.db.prepare(`
      UPDATE console_threads SET status = ?, updated_at = ? WHERE id = ?
    `);
    stmt.run(status, now, id);
  }

  /** Create a goal for a thread (Phase 2 helper) */
  createGoalForThread(thread: ConsoleThread): Goal {
    const goal = this.createGoal({
      title: thread.name,
      createdVia: 'auto',
      sessionId: thread.id, // Use thread ID as session reference
      projectPath: thread.projectPath,
    });

    // Link thread to goal
    this.linkThreadToGoal(thread.id, goal.id);

    return goal;
  }

  /** Get thread by goal ID */
  getThreadByGoalId(goalId: string): ConsoleThread | null {
    const stmt = this.db.prepare('SELECT * FROM console_threads WHERE goal_id = ?');
    const row = stmt.get(goalId) as ConsoleThreadRow | undefined;
    return row ? this.rowToConsoleThread(row) : null;
  }

  private rowToConsoleThread(row: ConsoleThreadRow): ConsoleThread {
    let previousNames: string[] = [];
    try {
      previousNames = JSON.parse(row.previous_names_json || '[]');
    } catch {
      previousNames = [];
    }

    let topicSignature: string | undefined;
    if (row.topic_signature_json) {
      topicSignature = row.topic_signature_json;
    }

    return {
      id: row.id,
      name: row.name,
      consoleId: row.console_id,
      goalId: row.goal_id ?? undefined,
      projectPath: row.project_path,
      worktreePath: row.worktree_path ?? undefined,
      status: row.status as ThreadStatus,
      previousNames: previousNames.length > 0 ? previousNames : undefined,
      topicSignature,
      sessionCount: row.session_count,
      createdAt: new Date(row.created_at),
      updatedAt: new Date(row.updated_at),
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
