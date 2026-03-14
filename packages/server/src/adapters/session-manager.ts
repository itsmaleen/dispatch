/**
 * Session Manager for Claude Code
 * 
 * Manages persistent sessions per terminal/thread.
 * Uses SQLite for thread/message persistence (inspired by T3 Code).
 */

import { query, type Query, type SDKMessage, type Options } from '@anthropic-ai/claude-agent-sdk';
import { EventEmitter } from 'events';
import { 
  getThreadStore, 
  type Thread, 
  type Message,
  type SqliteThreadStore,
} from '../persistence/sqlite-store';
import { getExtractor } from '../extractor';
import { getTaskStore, type Task } from '../persistence/task-store';

/** Active session bound to a thread */
export interface Session {
  threadId: string;
  query: Query | null;
  cwd: string;
  status: 'idle' | 'running' | 'error';
  currentTurnId?: string;
  outputBuffer: string;
}

/** Session events */
export interface SessionEvents {
  'message': (threadId: string, message: SDKMessage) => void;
  'turn.started': (threadId: string, turnId: string) => void;
  'turn.completed': (threadId: string, turnId: string, result: string, usage?: { inputTokens: number; outputTokens: number; costUsd?: number }) => void;
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
  resume?: boolean;
}

/** Options for sending a message */
export interface SendMessageOptions {
  message: string;
  effort?: 'low' | 'medium' | 'high' | 'max';
  thinking?: { type: 'adaptive' } | { type: 'enabled'; budgetTokens?: number } | { type: 'disabled' };
  maxTurns?: number;
  model?: string;
}

/** Thread summary for listing */
export interface ThreadSummary {
  id: string;
  name?: string;
  projectPath: string;
  worktreePath?: string;
  createdAt: Date;
  lastActiveAt: Date;
  messageCount: number;
  hasSession: boolean;
}

export class SessionManager extends EventEmitter {
  private store: SqliteThreadStore;
  private sessions = new Map<string, Session>();
  private sdkOptions: Partial<Options>;

  constructor(sdkOptions: Partial<Options> = {}) {
    super();
    this.store = getThreadStore();
    this.sdkOptions = sdkOptions;
  }

  /** Initialize - no-op now since SQLite handles persistence */
  async init(): Promise<void> {
    console.log('[SessionManager] Initialized with SQLite store');
  }

  /** List all threads with summaries */
  listThreads(options: { limit?: number; offset?: number } = {}): ThreadSummary[] {
    const threads = this.store.listThreads(options);
    return threads.map(t => ({
      id: t.id,
      name: t.name,
      projectPath: t.projectPath,
      worktreePath: t.worktreePath,
      createdAt: t.createdAt,
      lastActiveAt: t.lastActiveAt,
      messageCount: this.store.getMessageCount(t.id),
      hasSession: this.sessions.has(t.id),
    }));
  }

  /** Get thread by ID */
  getThread(threadId: string): Thread | null {
    return this.store.getThread(threadId);
  }

  /** Get thread messages with pagination */
  getMessages(threadId: string, options: { limit?: number; beforeId?: number } = {}): Message[] {
    return this.store.getMessages(threadId, options);
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

    // Get or create thread in SQLite
    let thread = this.store.getThread(threadId);
    if (!thread) {
      thread = this.store.createThread({
        id: threadId,
        name: name ?? `Thread ${threadId.slice(0, 8)}`,
        projectPath: cwd,
        worktreePath,
      });
      console.log(`[SessionManager] Created new thread ${threadId}`);
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

    const thread = this.store.getThread(threadId);
    if (!thread) {
      throw new Error(`Thread ${threadId} not found`);
    }

    const turnId = crypto.randomUUID();
    session.currentTurnId = turnId;
    session.status = 'running';
    session.outputBuffer = '';

    // Store user message
    this.store.appendMessage({
      threadId,
      turnId,
      role: 'user',
      content: options.message,
    });

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

    // Process query in background
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
    let capturedSessionId: string | undefined;
    let usage: { inputTokens: number; outputTokens: number; costUsd?: number } | undefined;

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
        const result = this.handleSDKMessage(session, event, turnId);
        if (result.sessionId) capturedSessionId = result.sessionId;
        if (result.usage) usage = result.usage;
      }

      // Store assistant message
      this.store.appendMessage({
        threadId: thread.id,
        turnId,
        role: 'assistant',
        content: session.outputBuffer,
        usage,
      });

      // Update thread with session ID for resume
      if (capturedSessionId && capturedSessionId !== thread.sessionId) {
        this.store.updateThread(thread.id, { sessionId: capturedSessionId });
      }

      session.status = 'idle';
      session.currentTurnId = undefined;
      
      this.emit('turn.completed', thread.id, turnId, session.outputBuffer, usage);

      // Classify and extract tasks (async, don't block)
      this.classifyAndStoreTasks(session.outputBuffer, {
        threadId: thread.id,
        turnId,
        agentId: 'claude-code',  // TODO: get from session
        agentName: 'Claude Code',
      }).catch(err => console.error('[SessionManager] Task classification failed:', err));

    } catch (error) {
      // Handle SDK exit code quirk - if we have output, treat as success
      if (session.outputBuffer.length > 0) {
        this.store.appendMessage({
          threadId: thread.id,
          turnId,
          role: 'assistant',
          content: session.outputBuffer,
          usage,
        });

        if (capturedSessionId && capturedSessionId !== thread.sessionId) {
          this.store.updateThread(thread.id, { sessionId: capturedSessionId });
        }

        session.status = 'idle';
        session.currentTurnId = undefined;
        
        this.emit('turn.completed', thread.id, turnId, session.outputBuffer, usage);

        // Classify and extract tasks (async, don't block)
        this.classifyAndStoreTasks(session.outputBuffer, {
          threadId: thread.id,
          turnId,
          agentId: 'claude-code',
          agentName: 'Claude Code',
        }).catch(err => console.error('[SessionManager] Task classification failed:', err));
      } else {
        session.status = 'error';
        this.emit('turn.error', thread.id, turnId, error instanceof Error ? error : new Error(String(error)));
      }
    } finally {
      session.query = null;
    }
  }

  /** Handle SDK message - returns captured metadata */
  private handleSDKMessage(
    session: Session,
    event: SDKMessage,
    turnId: string
  ): { sessionId?: string; usage?: { inputTokens: number; outputTokens: number; costUsd?: number } } {
    const result: { sessionId?: string; usage?: { inputTokens: number; outputTokens: number; costUsd?: number } } = {};

    // Emit raw message for UI streaming
    this.emit('message', session.threadId, event);

    switch (event.type) {
      case 'system': {
        const sysEvent = event as any;
        if (sysEvent.subtype === 'init' && sysEvent.session_id) {
          result.sessionId = sysEvent.session_id;
          console.log(`[SessionManager] Got session ID: ${result.sessionId}`);
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
        const resultEvent = event as any;
        if (resultEvent.usage) {
          result.usage = {
            inputTokens: resultEvent.usage.input_tokens || 0,
            outputTokens: resultEvent.usage.output_tokens || 0,
            costUsd: resultEvent.total_cost_usd,
          };
        }
        break;
      }
    }

    return result;
  }

  /** Extract tasks from agent output using persistent Claude Code subprocess */
  private async classifyAndStoreTasks(
    output: string,
    source: { threadId: string; turnId: string; agentId: string; agentName: string }
  ): Promise<void> {
    const extractor = getExtractor();
    const taskStore = getTaskStore();

    // First, complete any "doing" tasks from this agent (turn ended)
    const completed = taskStore.completeActiveTasks(source.threadId, source.agentId);
    if (completed > 0) {
      console.log(`[SessionManager] Auto-completed ${completed} active tasks`);
    }

    // Extract tasks using persistent Claude Code subprocess
    const result = await extractor.extract(output);
    
    if (result.tasks.length === 0) {
      console.log('[SessionManager] No tasks extracted from output');
      return;
    }

    // Count by status
    const counts = { doing: 0, planned: 0, suggested: 0, completed: 0 };
    for (const task of result.tasks) {
      counts[task.status]++;
    }

    console.log(`[SessionManager] Extracted ${result.tasks.length} tasks:`, counts);

    // Add or update tasks by status
    for (const task of result.tasks) {
      const base = {
        text: task.text,
        confidence: task.confidence,
        ...source,
      };

      if (task.status === 'completed') {
        const existing = taskStore.findExistingForStatusUpdate(
          source.threadId,
          source.agentId,
          task.text,
          'completed'
        );
        if (existing) {
          taskStore.completeTask(existing.id);
        } else {
          taskStore.createTask({ ...base, category: 'completed' });
        }
      } else if (task.status === 'doing') {
        const existing = taskStore.findExistingForStatusUpdate(
          source.threadId,
          source.agentId,
          task.text,
          'doing'
        );
        if (existing) {
          taskStore.startTask(existing.id);
        } else {
          taskStore.createTask({ ...base, category: 'doing' });
        }
      } else {
        const category = task.status === 'planned' ? 'planned' : 'suggested';
        taskStore.createTask({ ...base, category });
      }
    }

    // Emit event for UI
    this.emit('tasks.updated', taskStore.listTasks({ limit: 20 }));
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
    this.store.deleteThread(threadId);
    console.log(`[SessionManager] Deleted thread ${threadId}`);
  }

  /** Fork a thread */
  async forkThread(
    sourceThreadId: string, 
    options: { name?: string; fromMessageId?: number }
  ): Promise<Thread> {
    const newId = crypto.randomUUID();
    const forked = this.store.forkThread(sourceThreadId, newId, {
      name: options.name,
      upToMessageId: options.fromMessageId,
    });
    console.log(`[SessionManager] Forked thread ${sourceThreadId} → ${newId}`);
    return forked;
  }

  /** Shutdown - close all sessions */
  async shutdown(): Promise<void> {
    for (const threadId of this.sessions.keys()) {
      await this.closeSession(threadId);
    }
    this.store.close();
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

// Re-export types for convenience
export type { Thread, Message } from '../persistence/sqlite-store';
