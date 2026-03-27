/**
 * Claude Code SDK Session File Parser
 *
 * Parses Claude Code's .jsonl session files into console lines for display.
 *
 * Architecture Decision: Approach 2 (Hybrid)
 * - SDK .jsonl files are the source of truth
 * - Database is a cache/index for fast access and search
 * - On session resume, parse .jsonl → sync to database → display
 *
 * See: .plans/console-persistence-architecture.md
 */

import fs from 'fs';
import readline from 'readline';
import path from 'path';
import os from 'os';

/**
 * Claude SDK session event types (from .jsonl files)
 */
interface ClaudeSessionEvent {
  type: 'user' | 'assistant' | 'queue-operation' | string;
  sessionId: string;
  timestamp: string;
  uuid?: string;
  message?: {
    id: string;
    role: 'user' | 'assistant';
    content: Array<{
      type: 'text' | 'thinking' | 'tool_use' | 'tool_result';
      // Text block
      text?: string;
      // Thinking block
      thinking?: string;
      // Tool use block
      id?: string;
      name?: string;
      input?: unknown;
      // Tool result block
      tool_use_id?: string;
      content?: string | unknown;
    }>;
    usage?: {
      input_tokens: number;
      output_tokens: number;
    };
  };
}

/**
 * Parsed console line ready for database storage
 */
export interface ParsedConsoleLine {
  lineId: string;
  blockId: string;
  blockIndex: number;
  type: 'user' | 'output' | 'thinking' | 'tool_call' | 'tool_result';
  content: string;
  timestamp: string;
  isStreaming: boolean;
  toolName?: string;
  itemId?: string;
  toolInput?: unknown;
  toolResult?: unknown;
}

/**
 * Parse statistics for debugging
 */
export interface ParseStats {
  totalEvents: number;
  assistantMessages: number;
  userMessages: number;
  linesExtracted: number;
  errors: number;
  parseTimeMs: number;
}

/**
 * Escape project path to Claude Code's format
 *
 * Examples:
 * - /Users/marlin/project → -Users-marlin-project
 * - /Users/marlin/.acc-worktrees/foo → -Users-marlin--acc-worktrees-foo
 * - /tmp/test → -tmp-test
 *
 * Note: Claude SDK replaces both slashes (/) and dots (.) with dashes (-)
 */
export function escapeProjectPath(projectPath: string): string {
  return projectPath.replace(/[/.]/g, '-');
}

/**
 * Get the SDK session file path for a project and session ID
 *
 * Format: ~/.claude/projects/<escaped-project-path>/<sessionId>.jsonl
 */
export function getSessionFilePath(projectPath: string, sessionId: string): string {
  const homeDir = os.homedir();
  const escapedPath = escapeProjectPath(projectPath);

  return path.join(
    homeDir,
    '.claude',
    'projects',
    escapedPath,
    `${sessionId}.jsonl`
  );
}

/**
 * Parse a Claude Code SDK session file into console lines
 *
 * @param sessionFilePath - Absolute path to .jsonl file
 * @returns Array of parsed console lines
 * @throws Error if file doesn't exist or parsing fails critically
 */
export async function parseSessionFile(
  sessionFilePath: string
): Promise<{ lines: ParsedConsoleLine[]; stats: ParseStats }> {
  const startTime = Date.now();
  const lines: ParsedConsoleLine[] = [];
  const stats: ParseStats = {
    totalEvents: 0,
    assistantMessages: 0,
    userMessages: 0,
    linesExtracted: 0,
    errors: 0,
    parseTimeMs: 0,
  };

  // Check file exists
  if (!fs.existsSync(sessionFilePath)) {
    throw new Error(`Session file not found: ${sessionFilePath}`);
  }

  // Read file line by line (streaming for large files)
  const fileStream = fs.createReadStream(sessionFilePath);
  const rl = readline.createInterface({
    input: fileStream,
    crlfDelay: Infinity, // Treat \r\n as single line break
  });

  for await (const line of rl) {
    if (!line.trim()) continue;

    stats.totalEvents++;

    try {
      const event: ClaudeSessionEvent = JSON.parse(line);

      // Only process assistant messages (these contain the output we want to show)
      if (event.type === 'assistant' && event.message) {
        stats.assistantMessages++;
        const { message } = event;

        // Each message can have multiple content blocks
        // Ensure content is an array before iterating
        if (Array.isArray(message.content)) {
          message.content.forEach((block, blockIndex) => {
          // Text block → output line
          if (block.type === 'text' && block.text) {
            lines.push({
              lineId: `text-${message.id}`,
              blockId: message.id,
              blockIndex,
              type: 'output',
              content: block.text,
              timestamp: event.timestamp,
              isStreaming: false, // Historical content is never streaming
            });
            stats.linesExtracted++;
          }
          // Thinking block → thinking line
          else if (block.type === 'thinking' && block.thinking) {
            lines.push({
              lineId: `thinking-${block.id || message.id}`,
              blockId: block.id || message.id,
              blockIndex,
              type: 'thinking',
              content: block.thinking,
              timestamp: event.timestamp,
              isStreaming: false,
            });
            stats.linesExtracted++;
          }
          // Tool use block → tool_call line
          else if (block.type === 'tool_use' && block.name) {
            lines.push({
              lineId: `tool-${block.id || message.id}`,
              blockId: block.id || message.id,
              blockIndex,
              type: 'tool_call',
              content: block.name,
              timestamp: event.timestamp,
              isStreaming: false,
              toolName: block.name,
              itemId: block.id,
              toolInput: block.input,
            });
            stats.linesExtracted++;
          }
          // Tool result block → tool_result line
          else if (block.type === 'tool_result') {
            const resultContent = typeof block.content === 'string'
              ? block.content
              : JSON.stringify(block.content);

            lines.push({
              lineId: `tool-result-${block.tool_use_id || message.id}`,
              blockId: block.tool_use_id || message.id,
              blockIndex,
              type: 'tool_result',
              content: resultContent,
              timestamp: event.timestamp,
              isStreaming: false,
              itemId: block.tool_use_id,
              toolResult: block.content,
            });
            stats.linesExtracted++;
          }
          });
        }
      }
      // User messages → prompt lines
      else if (event.type === 'user' && event.message) {
        stats.userMessages++;
        const { message } = event;

        // Generate unique ID (fallback to uuid or timestamp if message.id is missing)
        const uniqueId = message.id || event.uuid || event.timestamp;

        // Extract text content from user message
        // Content can be a string OR an array
        if (typeof message.content === 'string') {
          // Simple string content
          lines.push({
            lineId: `user-${uniqueId}-0`,
            blockId: uniqueId,
            blockIndex: 0,
            type: 'user', // Match .jsonl event type
            content: message.content,
            timestamp: event.timestamp,
            isStreaming: false,
          });
          stats.linesExtracted++;
        } else if (Array.isArray(message.content)) {
          // Array of content blocks
          message.content.forEach((block, blockIndex) => {
            if (block.type === 'text' && block.text) {
              lines.push({
                lineId: `user-${uniqueId}-${blockIndex}`,
                blockId: uniqueId,
                blockIndex,
                type: 'user', // Match .jsonl event type
                content: block.text,
                timestamp: event.timestamp,
                isStreaming: false,
              });
              stats.linesExtracted++;
            }
          });
        }
      }
    } catch (err) {
      stats.errors++;
      console.warn('[ClaudeSessionParser] Failed to parse line:', {
        error: err instanceof Error ? err.message : String(err),
        line: line.substring(0, 100), // Log first 100 chars for debugging
      });
      // Continue parsing remaining lines (graceful degradation)
    }
  }

  stats.parseTimeMs = Date.now() - startTime;

  console.log('[ClaudeSessionParser] Parse complete:', {
    file: path.basename(sessionFilePath),
    ...stats,
  });

  return { lines, stats };
}

/**
 * Parse a session file into a formatted history string (T3 Code approach)
 *
 * This is the simple approach: parse .jsonl once, return complete formatted output.
 * No database, no pagination, just a single string buffer.
 *
 * @param sessionFilePath - Absolute path to .jsonl file
 * @returns Formatted history string ready to display in terminal
 */
export async function parseSessionToHistoryString(
  sessionFilePath: string
): Promise<string> {
  const startTime = Date.now();
  const lines: string[] = [];

  // Check file exists
  if (!fs.existsSync(sessionFilePath)) {
    console.warn('[ClaudeSessionParser] Session file not found:', sessionFilePath);
    return '';
  }

  // Read file line by line
  const fileStream = fs.createReadStream(sessionFilePath);
  const rl = readline.createInterface({
    input: fileStream,
    crlfDelay: Infinity,
  });

  for await (const line of rl) {
    if (!line.trim()) continue;

    try {
      const event: ClaudeSessionEvent = JSON.parse(line);
      const timestamp = new Date(event.timestamp).toLocaleTimeString();

      // User messages → show as prompts with > prefix
      if (event.type === 'user' && event.message) {
        const { message } = event;

        // Content can be a string OR an array
        if (typeof message.content === 'string') {
          // Simple string content
          lines.push(`\x1b[90m[${timestamp}]\x1b[0m \x1b[36m>\x1b[0m ${message.content}`);
        } else if (Array.isArray(message.content)) {
          // Array of content blocks
          message.content.forEach((block) => {
            if (block.type === 'text' && block.text) {
              // Format: [HH:MM:SS] > User prompt text
              lines.push(`\x1b[90m[${timestamp}]\x1b[0m \x1b[36m>\x1b[0m ${block.text}`);
            }
          });
        }
      }
      // Assistant messages → show output, thinking, tool calls
      else if (event.type === 'assistant' && event.message) {
        const { message } = event;

        // Ensure content is an array before iterating
        if (Array.isArray(message.content)) {
          message.content.forEach((block) => {
            // Text output
            if (block.type === 'text' && block.text) {
              lines.push(block.text);
            }
            // Thinking blocks
            else if (block.type === 'thinking' && block.thinking) {
              lines.push(`\x1b[90m[Thinking...]\x1b[0m`);
              // Don't show full thinking content to keep history concise
            }
            // Tool use
            else if (block.type === 'tool_use' && block.name) {
              lines.push(`\x1b[90m[Using tool: ${block.name}]\x1b[0m`);
            }
            // Tool results are usually too verbose, skip them
          });
        }
      }
    } catch (err) {
      console.warn('[ClaudeSessionParser] Failed to parse line:', {
        error: err instanceof Error ? err.message : String(err),
        line: line.substring(0, 100),
      });
      // Continue parsing remaining lines
    }
  }

  const parseTimeMs = Date.now() - startTime;
  console.log('[ClaudeSessionParser] Parsed to history string:', {
    file: path.basename(sessionFilePath),
    lineCount: lines.length,
    parseTimeMs,
  });

  // Join with newlines and return
  return lines.join('\r\n');
}

/**
 * Check if a session file exists for a given project and session ID
 */
export function sessionFileExists(projectPath: string, sessionId: string): boolean {
  const sessionFilePath = getSessionFilePath(projectPath, sessionId);
  return fs.existsSync(sessionFilePath);
}

/**
 * Get session file metadata (size, modified time, etc.)
 */
export interface SessionFileMetadata {
  exists: boolean;
  path: string;
  size?: number;
  modifiedAt?: Date;
  lineCount?: number;
}

export async function getSessionFileMetadata(
  projectPath: string,
  sessionId: string
): Promise<SessionFileMetadata> {
  const sessionFilePath = getSessionFilePath(projectPath, sessionId);

  if (!fs.existsSync(sessionFilePath)) {
    return {
      exists: false,
      path: sessionFilePath,
    };
  }

  const stats = fs.statSync(sessionFilePath);

  // Count lines for debugging
  let lineCount = 0;
  try {
    const fileStream = fs.createReadStream(sessionFilePath);
    const rl = readline.createInterface({
      input: fileStream,
      crlfDelay: Infinity,
    });

    for await (const line of rl) {
      if (line.trim()) lineCount++;
    }
  } catch (err) {
    console.warn('[ClaudeSessionParser] Failed to count lines:', err);
  }

  return {
    exists: true,
    path: sessionFilePath,
    size: stats.size,
    modifiedAt: stats.mtime,
    lineCount,
  };
}
