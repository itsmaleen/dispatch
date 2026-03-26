/**
 * Console Line Store
 *
 * Persistent storage for agent console output lines.
 * Supports unlimited output with cursor-based pagination, FTS5 search, and compression.
 */

import { DatabaseSync } from 'node:sqlite';
import { gzipSync, gunzipSync } from 'node:zlib';
import type {
  PersistedConsoleLine,
  ConsoleLinesResult,
  ConsoleLineSearchResult,
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
   * Update an existing line's content
   * Used for text/thinking deltas during streaming
   */
  updateLineContent(
    lineId: string,
    content: string,
    isStreaming: boolean = false
  ): boolean {
    const result = this.db.prepare(`
      UPDATE console_lines
      SET content = ?, is_streaming = ?
      WHERE line_id = ?
    `).run(content, isStreaming ? 1 : 0, lineId);

    return (result.changes ?? 0) > 0;
  }

  /**
   * Append text to an existing line (for deltas)
   */
  appendToLine(lineId: string, text: string): boolean {
    // Get current content (decompressed if needed)
    const row = this.db.prepare(`
      SELECT content, is_compressed FROM console_lines WHERE line_id = ?
    `).get(lineId) as { content: string; is_compressed: number } | undefined;

    if (!row) return false;

    let currentContent = row.content;
    if (row.is_compressed) {
      currentContent = gunzipSync(Buffer.from(currentContent, 'base64')).toString('utf-8');
    }

    const newContent = currentContent + text;

    // Update with uncompressed content (streaming lines are never compressed)
    const result = this.db.prepare(`
      UPDATE console_lines
      SET content = ?, is_compressed = 0
      WHERE line_id = ?
    `).run(newContent, lineId);

    return (result.changes ?? 0) > 0;
  }

  /**
   * Mark a line as no longer streaming
   */
  markLineComplete(lineId: string): boolean {
    const result = this.db.prepare(`
      UPDATE console_lines
      SET is_streaming = 0
      WHERE line_id = ?
    `).run(lineId);

    return (result.changes ?? 0) > 0;
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
   * Get all unique console IDs that have lines
   */
  getAllConsoleIds(): string[] {
    const rows = this.db.prepare(`
      SELECT DISTINCT console_id FROM console_lines
      ORDER BY console_id
    `).all() as Array<{ console_id: string }>;

    return rows.map(row => row.console_id);
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
        const compressedContent = gzipSync(Buffer.from(row.content)).toString('base64');
        stmt.run(compressedContent, row.id);
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
        content = gunzipSync(Buffer.from(content, 'base64')).toString('utf-8');
      }

      return `[${time}] [${row.type}] ${content}`;
    }).join('\n');
  }

  // ==================== Private Helpers ====================

  private rowsToResult(rows: ConsoleLineRow[]): ConsoleLinesResult {
    const lines = rows.map(row => this.rowToLine(row));

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

/**
 * Singleton instance
 * Shares the same database connection as thread store
 */
let _consoleLineStoreInstance: ConsoleLineStore | null = null;

export function getConsoleLineStore(): ConsoleLineStore {
  if (!_consoleLineStoreInstance) {
    const { getThreadStore } = require('../persistence/sqlite-store');
    const db = getThreadStore().getDatabase();
    _consoleLineStoreInstance = new ConsoleLineStore(db);
  }
  return _consoleLineStoreInstance;
}
