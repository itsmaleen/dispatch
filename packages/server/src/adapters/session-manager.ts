/**
 * Session Manager for Claude Code
 * 
 * Manages persistent sessions per terminal/thread.
 * Each session owns a Claude Code query iterator and maintains conversation state.
 */

import { query, type Query, type SDKMessage, type Options } from '@anthropic-ai/claude-agent-sdk';
import { EventEmitter } from 'events';
import * as fs from 'fs/promises';
import * as path from 'path';

/** Message in conversation history */
export interface HistoryMessage {
  role: 'user' | 'assistant';
  content: string;
  timestamp: Date;
  turnId: string;
  usage?: {
    inputTokens: number;
    outputTokens: number;
    costUsd?: number;
  };
}

/** Thread represents a persistent conversation context */
export interface Thread {
  id: string;
  name?: string;
  projectPath: string;       // Workspace root (cwd for session)
  worktreePath?: string;     // Git worktree path (optional)
  createdAt: Date;
  lastActiveAt: Date;
  history: HistoryMessage[];
  sessionId?: string;        // SDK session ID for resume
  metadata?: Record<string, unknown>;
}

/** Active session bound to a thread */
export interface Session {
  threadId: string;
  query: Query | null;       // Active query iterator
  cwd: string;
  status: 'idle' | 'running' | 'error';
  currentTurnId?: string;
  outputBuffer: string;
}

/** Session events */
export interface SessionEvents {
  'message': (threadId: string, message: SDKMessage) => void;
  'turn.started': (threadId: string, turnId: string) => void;
  'turn.completed': (threadId: string, turnId: string, result: string) => void;
  'turn.error': (threadId: string, turnId: string, error: Error) => void;
  'session.created': (threadId: string) => void;
  'session.closed': (threadId: string) => void;
}

/** Options for creating a session */
export interface CreateSessionOptions {
  threadId: string;
  cwd: string;
  name?: string;
  worktreePath?: string;
  resume?: boolean;          // Try to resume from saved sessionId
}

/** Options for sending a message */
export interface SendMessageOptions {
  message: string;
  effort?: 'low' | 'medium' | 'high' | 'max';
  thinking?: { type: 'adaptive' } | { type: 'enabled'; budgetTokens?: number } | { type: 'disabled' };
  maxTurns?: number;
  model?: string;
}

const THREADS_DIR = path.join(process.env.HOME || '~', '.acc', 'threads');

export class SessionManager extends EventEmitter {
  private threads = new Map<string, Thread>();
  private sessions = new Map<string, Session>();
  private sdkOptions: Partial<Options>;

  constructor(sdkOptions: Partial<Options> = {}) {
    super();
    this.sdkOptions = sdkOptions;
  }

  /** Initialize - load saved threads from disk */
  async init(): Promise<void> {
    await fs.mkdir(THREADS_DIR, { recursive: true });
    
    try {
      const files = await fs.readdir(THREADS_DIR);
      for (const file of files) {
        if (file.endsWith('.json')) {
          try {
            const data = await fs.readFile(path.join(THREADS_DIR, file), 'utf-8');
            const thread = JSON.parse(data) as Thread;
            thread.createdAt = new Date(thread.createdAt);
            thread.lastActiveAt = new Date(thread.lastActiveAt);
            thread.history = thread.history.map(m => ({
              ...m,
              timestamp: new Date(m.timestamp),
            }));
            this.threads.set(thread.id, thread);
          } catch (e) {
            console.error(`Failed to load thread ${file}:`, e);
          }
        }
      }
      console.log(`[SessionManager] Loaded ${this.threads.size} threads from disk`);
    } catch (e) {
      console.log('[SessionManager] No existing threads found');
    }
  }

  /** List all threads */
  listThreads(): Thread[] {
    return Array.from(this.threads.values())
      .sort((a, b) => b.lastActiveAt.getTime() - a.lastActiveAt.getTime());
  }

  /** Get thread by ID */
  getThread(threadId: string): Thread | undefined {
    return this.threads.get(threadId);
  }

  /** Get session for thread */
  getSession(threadId: string): Session | undefined {
    return this.sessions.get(threadId);
  }

  /** Create or resume a session for a thread */
  async createSession(options: CreateSessionOptions): Promise<Session> {
    const { threadId, cwd, name, worktreePath, resume } = options;

    // Check if session already exists
    const existing = this.sessions.get(threadId);
    if (existing) {
      console.log(`[SessionManager] Session ${threadId} already exists`);
      return existing;
    }

    // Get or create thread
    let thread = this.threads.get(threadId);
    if (!thread) {
      thread = {
        id: threadId,
        name: name || `Thread ${threadId.slice(0, 8)}`,
        projectPath: cwd,
        worktreePath,
        createdAt: new Date(),
        lastActiveAt: new Date(),
        history: [],
      };
      this.threads.set(threadId, thread);
      await this.saveThread(thread);
    }

    // Create session (query created lazily on first message)
    const session: Session = {
      threadId,
      query: null,
      cwd,
      status: 'idle',
      outputBuffer: '',
    };

    this.sessions.set(threadId, session);
    this.emit('session.created', threadId);
    console.log(`[SessionManager] Created session for thread ${threadId} (cwd: ${cwd})`);

    return session;
  }

  /** Send message to a session */
  async send(
    threadId: string, 
    options: SendMessageOptions
  ): Promise<{ turnId: string }> {
    const session = this.sessions.get(threadId);
    if (!session) {
      throw new Error(`No session for thread ${threadId}`);
    }

    const thread = this.threads.get(threadId);
    if (!thread) {
      throw new Error(`Thread ${threadId} not found`);
    }

    const turnId = crypto.randomUUID();
    session.currentTurnId = turnId;
    session.status = 'running';
    session.outputBuffer = '';

    // Add user message to history
    thread.history.push({
      role: 'user',
      content: options.message,
      timestamp: new Date(),
      turnId,
    });
    thread.lastActiveAt = new Date();

    this.emit('turn.started', threadId, turnId);

    // Build SDK options
    const sdkOpts: Options = {
      ...this.sdkOptions,
      cwd: session.cwd,
      permissionMode: 'bypassPermissions',
    };

    if (options.effort) sdkOpts.effort = options.effort;
    if (options.thinking) sdkOpts.thinking = options.thinking;
    if (options.maxTurns) sdkOpts.maxTurns = options.maxTurns;
    if (options.model) sdkOpts.model = options.model;

    // Resume from previous session if available
    if (thread.sessionId) {
      sdkOpts.resume = thread.sessionId;
      console.log(`[SessionManager] Resuming session ${thread.sessionId}`);
    }

    // Create query and process
    this.processQuery(session, thread, options.message, sdkOpts, turnId);

    return { turnId };
  }

  /** Process query in background */
  private async processQuery(
    session: Session,
    thread: Thread,
    message: string,
    sdkOpts: Options,
    turnId: string
  ): Promise<void> {
    try {
      const queryIter = query({
        prompt: message,
        options: {
          ...sdkOpts,
          includePartialMessages: true,
        },
      });

      session.query = queryIter;

      for await (const event of queryIter) {
        this.handleSDKMessage(session, thread, event, turnId);
      }

      // Query completed successfully
      const result = session.outputBuffer;
      
      // Add assistant message to history
      thread.history.push({
        role: 'assistant',
        content: result,
        timestamp: new Date(),
        turnId,
      });

      session.status = 'idle';
      session.currentTurnId = undefined;
      
      await this.saveThread(thread);
      this.emit('turn.completed', threadId, turnId, result);

    } catch (error) {
      // Handle SDK exit code quirk - if we have output, treat as success
      if (session.outputBuffer.length > 0) {
        const result = session.outputBuffer;
        
        thread.history.push({
          role: 'assistant',
          content: result,
          timestamp: new Date(),
          turnId,
        });

        session.status = 'idle';
        session.currentTurnId = undefined;
        
        await this.saveThread(thread);
        this.emit('turn.completed', thread.id, turnId, result);
      } else {
        session.status = 'error';
        this.emit('turn.error', thread.id, turnId, error instanceof Error ? error : new Error(String(error)));
      }
    } finally {
      session.query = null;
    }
  }

  /** Handle SDK message */
  private handleSDKMessage(
    session: Session,
    thread: Thread,
    event: SDKMessage,
    turnId: string
  ): void {
    // Emit raw message for UI streaming
    this.emit('message', thread.id, event);

    switch (event.type) {
      case 'system': {
        const sysEvent = event as any;
        if (sysEvent.subtype === 'init' && sysEvent.session_id) {
          // Capture session ID for resume
          thread.sessionId = sysEvent.session_id;
          console.log(`[SessionManager] Got session ID: ${thread.sessionId}`);
        }
        break;
      }

      case 'assistant': {
        const content = (event.message as any)?.content;
        if (Array.isArray(content)) {
          for (const block of content) {
            if (block?.type === 'text' && typeof block.text === 'string') {
              if (!session.outputBuffer.includes(block.text)) {
                session.outputBuffer += block.text;
              }
            }
          }
        }
        break;
      }

      case 'stream_event': {
        const streamEvent = (event as any).event;
        if (streamEvent?.type === 'content_block_delta') {
          const delta = streamEvent.delta;
          if (delta?.type === 'text_delta' && delta.text) {
            session.outputBuffer += delta.text;
          }
        }
        break;
      }

      case 'result': {
        const result = event as any;
        // Update last history message with usage
        const lastMsg = thread.history[thread.history.length - 1];
        if (lastMsg && result.usage) {
          lastMsg.usage = {
            inputTokens: result.usage.input_tokens || 0,
            outputTokens: result.usage.output_tokens || 0,
            costUsd: result.total_cost_usd,
          };
        }
        break;
      }
    }
  }

  /** Close a session */
  async closeSession(threadId: string): Promise<void> {
    const session = this.sessions.get(threadId);
    if (!session) return;

    if (session.query) {
      try {
        await session.query.return(undefined);
      } catch {
        // Ignore
      }
    }

    this.sessions.delete(threadId);
    this.emit('session.closed', threadId);
    console.log(`[SessionManager] Closed session ${threadId}`);
  }

  /** Delete a thread and its session */
  async deleteThread(threadId: string): Promise<void> {
    await this.closeSession(threadId);
    this.threads.delete(threadId);
    
    try {
      await fs.unlink(path.join(THREADS_DIR, `${threadId}.json`));
    } catch {
      // File may not exist
    }
    
    console.log(`[SessionManager] Deleted thread ${threadId}`);
  }

  /** Save thread to disk */
  private async saveThread(thread: Thread): Promise<void> {
    const filepath = path.join(THREADS_DIR, `${thread.id}.json`);
    await fs.writeFile(filepath, JSON.stringify(thread, null, 2));
  }

  /** Fork a thread (create new thread from existing history) */
  async forkThread(
    sourceThreadId: string, 
    options: { name?: string; fromTurnId?: string }
  ): Promise<Thread> {
    const source = this.threads.get(sourceThreadId);
    if (!source) {
      throw new Error(`Thread ${sourceThreadId} not found`);
    }

    const newId = crypto.randomUUID();
    let history = [...source.history];
    
    // Optionally truncate history at a specific turn
    if (options.fromTurnId) {
      const idx = history.findIndex(m => m.turnId === options.fromTurnId);
      if (idx >= 0) {
        history = history.slice(0, idx + 1);
      }
    }

    const forked: Thread = {
      id: newId,
      name: options.name || `Fork of ${source.name}`,
      projectPath: source.projectPath,
      worktreePath: source.worktreePath,
      createdAt: new Date(),
      lastActiveAt: new Date(),
      history: history.map(m => ({ ...m })),
      // Don't copy sessionId - new session will be created
    };

    this.threads.set(newId, forked);
    await this.saveThread(forked);

    console.log(`[SessionManager] Forked thread ${sourceThreadId} → ${newId}`);
    return forked;
  }

  /** Shutdown - close all sessions */
  async shutdown(): Promise<void> {
    for (const threadId of this.sessions.keys()) {
      await this.closeSession(threadId);
    }
    console.log('[SessionManager] Shutdown complete');
  }
}

// Singleton instance
let _instance: SessionManager | null = null;

export function getSessionManager(): SessionManager {
  if (!_instance) {
    _instance = new SessionManager({
      permissionMode: 'bypassPermissions',
    });
  }
  return _instance;
}
