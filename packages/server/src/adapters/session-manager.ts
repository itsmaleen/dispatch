/**
 * Session Manager for Claude Code
 * 
 * Manages persistent sessions per terminal/thread.
 * Uses SQLite for thread/message persistence (inspired by T3 Code).
 */

import { query, listSessions as sdkListSessions, type Query, type SDKMessage, type Options, type SDKSessionInfo } from '@anthropic-ai/claude-agent-sdk';
import { execSync } from 'child_process';
import { EventEmitter } from 'events';
import {
  getThreadStore,
  type Thread,
  type Message,
  type SqliteThreadStore,
  type SessionStatus,
} from '../persistence/sqlite-store';
import { getExtractor, getPromptSummarizer } from '../extractor';
import { getTaskStore, type Task } from '../persistence/task-store';
import { getReactiveTaskStore } from '../persistence/reactive-task-store';
import { getWorktreeManager } from '../services/worktree-manager';
import { getThreadNamer } from '../services/thread-namer';
import { getOverlapDetector, type OverlapWarning } from '../services/overlap-detector';
import { getMergeMessageGenerator } from '../services/merge-message-generator';
import type { WorktreeInfo, WorktreeChanges, MergeResult, ConsoleThread } from '@acc/contracts';

/** Active session bound to a thread */
export interface Session {
  threadId: string;
  query: Query | null;
  cwd: string;
  status: 'idle' | 'running' | 'error';
  currentTurnId?: string;
  outputBuffer: string;
  /** Timestamp of last activity (SDK event received) */
  lastActivityAt?: number;
  /** Timeout handle for activity monitoring */
  activityTimeout?: ReturnType<typeof setTimeout>;
  /** Claude Code SDK session ID for resume (captured from SDK events) */
  sdkSessionId?: string;
  /** Whether this session should resume from a previous SDK session */
  resumeFromSessionId?: string;
  /** Flag to signal the query loop should stop immediately */
  interruptRequested?: boolean;
}

/** Session events */
export interface SessionEvents {
  'message': (threadId: string, message: SDKMessage) => void;
  'turn.started': (threadId: string, turnId: string) => void;
  'turn.completed': (threadId: string, turnId: string, result: string, usage?: { inputTokens: number; outputTokens: number; costUsd?: number }) => void;
  'turn.error': (threadId: string, turnId: string, error: Error) => void;
  'session.created': (threadId: string) => void;
  'session.closed': (threadId: string) => void;
  // Active session tracking (Tier 1)
  'prompt.started': (data: { sessionId: string; agentId: string; agentName: string; summary: string; promptText: string; projectPath?: string }) => void;
  'prompt.completed': (data: { sessionId: string; status: 'completed' | 'failed'; durationMs: number }) => void;
  'prompt.summary_updated': (data: { sessionId: string; summary: string }) => void;
  // Task updates
  'tasks.updated': (tasks: Task[]) => void;
  // Thread overlap warning (Phase 4)
  'thread.overlap_warning': (warning: OverlapWarning) => void;
  // Thread evolution suggestion (Phase 5)
  'thread.evolution_suggested': (data: {
    threadId: string;
    currentName: string;
    suggestedName: string;
    evolutionType: 'evolution' | 'new_topic';
    confidence: number;
  }) => void;
}

/** Options for creating a session */
export interface CreateSessionOptions {
  threadId: string;
  cwd: string;
  name?: string;
  worktreePath?: string;
  /** Whether to resume a previous session */
  resume?: boolean;
  /** Claude Code SDK session ID to resume (used when resume=true) */
  sessionId?: string;
}

/** Options for sending a message */
export interface SendMessageOptions {
  message: string;
  effort?: 'low' | 'medium' | 'high' | 'max';
  thinking?: { type: 'adaptive' } | { type: 'enabled'; budgetTokens?: number } | { type: 'disabled' };
  maxTurns?: number;
  model?: string;
  /** Interaction mode - 'plan' triggers plan mode behavior */
  mode?: 'default' | 'plan';
  /** Adapter-specific task options */
  taskOptions?: Record<string, unknown>;
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

/** Session activity timeout - if no SDK events for this duration, consider session stuck */
const SESSION_ACTIVITY_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes

export class SessionManager extends EventEmitter {
  private store: SqliteThreadStore;
  private sessions = new Map<string, Session>();
  private sdkOptions: Partial<Options>;

  constructor(sdkOptions: Partial<Options> = {}) {
    super();
    this.store = getThreadStore();
    this.sdkOptions = sdkOptions;
  }

  /** Start activity timeout monitoring for a session */
  private startActivityTimeout(session: Session, turnId: string): void {
    this.clearActivityTimeout(session);
    session.lastActivityAt = Date.now();

    session.activityTimeout = setTimeout(() => {
      if (session.status === 'running' && session.currentTurnId === turnId) {
        const inactiveMs = Date.now() - (session.lastActivityAt || 0);
        console.warn(
          `[SessionManager] Session ${session.threadId} appears stuck - no activity for ${Math.round(inactiveMs / 1000)}s`
        );

        // Emit timeout error
        const err = new Error(
          `Session timed out - no activity for ${Math.round(inactiveMs / 60000)} minutes. ` +
          'The Claude Code process may have stopped responding. Try sending a new message.'
        );
        session.status = 'error';
        this.emit('turn.error', session.threadId, turnId, err);

        // Try to abort the query
        if (session.query) {
          session.query.return?.().catch(() => {});
          session.query = null;
        }
      }
    }, SESSION_ACTIVITY_TIMEOUT_MS);
  }

  /** Clear activity timeout for a session */
  private clearActivityTimeout(session: Session): void {
    if (session.activityTimeout) {
      clearTimeout(session.activityTimeout);
      session.activityTimeout = undefined;
    }
  }

  /** Reset activity timeout (call when SDK event received) */
  private resetActivityTimeout(session: Session, turnId: string): void {
    session.lastActivityAt = Date.now();
    // Restart the timeout
    this.startActivityTimeout(session, turnId);
  }

  /** Initialize the session manager */
  async init(): Promise<void> {
    console.log('[SessionManager] Initialized with SQLite store');
  }

  private getStore(): SqliteThreadStore {
    return this.store;
  }

  /** Resolve path to Claude Code executable so the SDK uses the user's Claude auth (claude auth login). */
  private resolveClaudeExecutablePath(): string | undefined {
    if (this.sdkOptions.pathToClaudeCodeExecutable) {
      return this.sdkOptions.pathToClaudeCodeExecutable;
    }
    const envPath = process.env.ACC_CLAUDE_CODE_PATH;
    if (envPath && envPath.trim()) {
      return envPath.trim();
    }
    try {
      const path = execSync('which claude', { encoding: 'utf-8' }).trim();
      return path || undefined;
    } catch {
      return undefined;
    }
  }

  /** List all threads with summaries */
  listThreads(options: { limit?: number; offset?: number } = {}): ThreadSummary[] {
    const threads = this.getStore().listThreads(options);
    return threads.map(t => ({
      id: t.id,
      name: t.name,
      projectPath: t.projectPath,
      worktreePath: t.worktreePath,
      createdAt: t.createdAt,
      lastActiveAt: t.lastActiveAt,
      messageCount: this.getStore().getMessageCount(t.id),
      hasSession: this.sessions.has(t.id),
    }));
  }

  /**
   * Get valid SDK sessions for a project directory.
   * These are the actual session files that exist in ~/.claude/projects/
   */
  async getValidSdkSessions(projectPath: string): Promise<SDKSessionInfo[]> {
    try {
      const sessions = await sdkListSessions({ dir: projectPath });
      return sessions;
    } catch (err) {
      console.error('[SessionManager] Failed to list SDK sessions:', err);
      return [];
    }
  }

  /**
   * Check if a session ID is valid (exists in SDK storage)
   */
  async isSessionIdValid(sessionId: string, projectPath: string): Promise<boolean> {
    const sessions = await this.getValidSdkSessions(projectPath);
    return sessions.some(s => s.sessionId === sessionId);
  }

  /** Get thread by ID */
  getThread(threadId: string): Thread | null {
    return this.getStore().getThread(threadId);
  }

  /** Get thread messages with pagination */
  getMessages(threadId: string, options: { limit?: number; beforeId?: number } = {}): Message[] {
    return this.getStore().getMessages(threadId, options);
  }

  /** Get session for thread */
  getSession(threadId: string): Session | undefined {
    return this.sessions.get(threadId);
  }

  /** Create or resume a session for a thread */
  async createSession(options: CreateSessionOptions): Promise<Session> {
    const { threadId, cwd, name, worktreePath, resume, sessionId } = options;

    // Check if session already exists
    const existing = this.sessions.get(threadId);
    if (existing) {
      console.log(`[SessionManager] Session ${threadId} already exists`);
      return existing;
    }

    // Get or create thread in SQLite
    let thread = this.getStore().getThread(threadId);
    if (!thread) {
      thread = this.getStore().createThread({
        id: threadId,
        name: name ?? `Thread ${threadId.slice(0, 8)}`,
        projectPath: cwd,
        worktreePath,
      });
      console.log(`[SessionManager] Created new thread ${threadId}`);
    } else if (resume) {
      // Mark the thread as active when resuming
      this.getStore().activateSession(threadId);
      console.log(`[SessionManager] Reactivated thread ${threadId} for resume`);
    }

    // Create session (query created lazily on first message)
    const session: Session = {
      threadId,
      query: null,
      cwd,
      status: 'idle',
      outputBuffer: '',
      // Store the SDK session ID if resuming
      resumeFromSessionId: resume && sessionId ? sessionId : undefined,
    };

    this.sessions.set(threadId, session);
    this.emit('session.created', threadId);
    console.log(`[SessionManager] Created session for thread ${threadId} (cwd: ${cwd}, resume: ${resume}, sessionId: ${sessionId || 'new'})`);

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

    const thread = this.getStore().getThread(threadId);
    if (!thread) {
      throw new Error(`Thread ${threadId} not found`);
    }

    const turnId = crypto.randomUUID();
    session.currentTurnId = turnId;
    session.status = 'running';
    session.outputBuffer = '';

    // Store user message
    this.getStore().appendMessage({
      threadId,
      turnId,
      role: 'user',
      content: options.message,
    });

    this.emit('turn.started', threadId, turnId);

    // Track active session (Tier 1)
    // Use quick heuristic summary first for immediate UI feedback
    const taskStore = getTaskStore();
    const reactiveStore = getReactiveTaskStore();
    const quickSummary = this.generateQuickSummary(options.message);
    taskStore.startSession({
      id: threadId,
      agentId: 'claude-code',
      agentName: 'Claude Code',
      summary: quickSummary,
      promptText: options.message,
      projectPath: session.cwd,
    });

    // Emit prompt.started event for UI with quick summary
    this.emit('prompt.started', {
      sessionId: threadId,
      agentId: 'claude-code',
      agentName: 'Claude Code',
      summary: quickSummary,
      promptText: options.message,
      projectPath: session.cwd,
    });

    // Phase 1 & 2: Get or create ConsoleThread with AI-generated name, auto-create Goal
    // Phase 5: Also check for thread evolution
    this.ensureConsoleThreadAndGoal(threadId, options.message, session.cwd)
      .then(consoleThread => {
        // Check for evolution every 3 prompts (not on first prompt)
        if (consoleThread.sessionCount >= 3 && consoleThread.sessionCount % 3 === 0) {
          this.checkThreadEvolution(consoleThread, options.message).catch(err => {
            console.error('[SessionManager] Thread evolution check failed:', err);
          });
        }
      })
      .catch(err => {
        console.error('[SessionManager] ConsoleThread/Goal creation failed:', err);
      });

    // Generate better AI summary asynchronously (don't block)
    this.generateAISummary(threadId, options.message).catch(err => {
      console.error('[SessionManager] AI summary generation failed:', err);
    });

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

    // Handle plan mode - use system prompt suffix to guide planning behavior
    if (options.mode === 'plan') {
      const planModePrompt = `\n\n[MODE: PLAN]
You are in PLAN MODE. Before implementing anything:
1. Analyze the task and identify all components that need to be created or modified
2. Create a clear, step-by-step plan
3. List the files that will need to be created or modified
4. Identify potential challenges or edge cases
5. Ask clarifying questions if anything is unclear
6. Present your plan to the user and wait for approval before proceeding

Do NOT write any code or make any changes until your plan is approved by the user.`;
      (sdkOpts as any).systemPromptSuffix = planModePrompt;
    }

    // Pass through additional task options
    if (options.taskOptions) {
      Object.assign(sdkOpts, options.taskOptions);
    }

    // Resume from previous session if available
    if (thread.sessionId) {
      sdkOpts.resume = thread.sessionId;
      // Use the original session's cwd for resume (session files are stored per-project-path)
      if (thread.sessionCwd && thread.sessionCwd !== session.cwd) {
        console.log(`[SessionManager] Using stored sessionCwd for resume: ${thread.sessionCwd} (current: ${session.cwd})`);
        sdkOpts.cwd = thread.sessionCwd;
      }
      console.log(`[SessionManager] Resuming session ${thread.sessionId} (cwd: ${sdkOpts.cwd})`);
    }

    // Process query in background
    this.processQuery(session, thread, options.message, sdkOpts, turnId);

    return { turnId };
  }

  /** Generate a quick heuristic summary for immediate UI feedback */
  private generateQuickSummary(prompt: string): string {
    const trimmed = prompt.trim();

    // If short enough, clean it up and use as-is
    if (trimmed.length <= 50) {
      return this.cleanupPrompt(trimmed);
    }

    // Try to extract first sentence
    const firstSentence = trimmed.split(/[.!?\n]/)[0]?.trim();
    if (firstSentence && firstSentence.length <= 60) {
      return this.cleanupPrompt(firstSentence);
    }

    // Look for command patterns
    const commandMatch = trimmed.match(/^(run|execute|help me|please|can you|i need to|let's|let me|add|fix|update|create|implement|debug)\s+(.{10,45})/i);
    if (commandMatch) {
      return this.cleanupPrompt(commandMatch[0].slice(0, 50));
    }

    // Truncate at word boundary
    const truncated = trimmed.slice(0, 47);
    const lastSpace = truncated.lastIndexOf(' ');
    return (lastSpace > 20 ? truncated.slice(0, lastSpace) : truncated) + '...';
  }

  /** Clean up common prompt prefixes */
  private cleanupPrompt(prompt: string): string {
    let cleaned = prompt
      .replace(/^(please|can you|could you|help me|i need to|i want to)\s+/i, '')
      .trim();

    // Capitalize first letter
    if (cleaned.length > 0) {
      cleaned = cleaned[0].toUpperCase() + cleaned.slice(1);
    }

    return cleaned || prompt;
  }

  /** Generate AI-powered summary and emit update event */
  private async generateAISummary(sessionId: string, prompt: string): Promise<void> {
    // Only use AI for longer prompts
    if (prompt.trim().length <= 50) {
      return; // Quick summary is good enough for short prompts
    }

    try {
      const summarizer = getPromptSummarizer();
      const aiSummary = await summarizer.summarize(prompt);

      // Update the session in the store
      const taskStore = getTaskStore();
      const session = taskStore.getSession(sessionId);
      if (session && session.status === 'running') {
        // Update the session summary in the database
        // Note: We'll need to add an updateSessionSummary method
        this.updateSessionSummary(sessionId, aiSummary);

        // Emit event so UI can update
        this.emit('prompt.summary_updated', {
          sessionId,
          summary: aiSummary,
        });

        console.log(`[SessionManager] AI summary generated for ${sessionId}: "${aiSummary}"`);
      }
    } catch (error) {
      console.error('[SessionManager] AI summary generation failed:', error);
      // Don't throw - we already have a quick summary as fallback
    }
  }

  /** Update session summary in the task store */
  private updateSessionSummary(sessionId: string, summary: string): void {
    const taskStore = getTaskStore();
    taskStore.updateSessionSummary(sessionId, summary);
  }

  /**
   * Phase 5: Check if thread topic has evolved
   *
   * Uses AI to detect if the new prompt represents a topic change.
   * Emits 'thread.evolution_suggested' event if evolution detected.
   */
  private async checkThreadEvolution(
    consoleThread: ConsoleThread,
    newPrompt: string
  ): Promise<void> {
    const threadNamer = getThreadNamer();

    // Get recent context (summaries of recent prompts in this thread)
    // Use recently completed sessions for context
    const taskStore = getTaskStore();
    const recentSessions = taskStore.getRecentlyCompletedSessions(5, consoleThread.projectPath);

    // Build context from recent sessions' summaries (excluding current)
    const recentContext = recentSessions
      .filter((s: { id: string }) => s.id !== consoleThread.id)
      .map((s: { summary?: string }) => s.summary || '')
      .filter(Boolean)
      .join('. ');

    const evolution = await threadNamer.shouldEvolve(
      consoleThread.name,
      recentContext,
      newPrompt
    );

    console.log(`[SessionManager] Evolution check for "${consoleThread.name}":`, evolution);

    // Only emit for significant changes
    if (evolution.shouldEvolve && evolution.evolutionType !== 'continuation') {
      // For 'evolution' type, auto-update the name and store previous
      if (evolution.evolutionType === 'evolution' && evolution.suggestedName) {
        const reactiveStore = getReactiveTaskStore();
        reactiveStore.updateThreadName(
          consoleThread.id,
          evolution.suggestedName,
          true // Track previous name
        );

        console.log(`[SessionManager] Thread evolved: "${consoleThread.name}" → "${evolution.suggestedName}"`);
      }

      // For 'new_topic', emit event for user decision
      if (evolution.evolutionType === 'new_topic' && evolution.suggestedName) {
        this.emit('thread.evolution_suggested', {
          threadId: consoleThread.id,
          currentName: consoleThread.name,
          suggestedName: evolution.suggestedName,
          evolutionType: evolution.evolutionType,
          confidence: evolution.confidence,
        });
      }
    }
  }

  /**
   * Phase 1 & 2: Ensure ConsoleThread exists and auto-create Goal
   *
   * - Gets or creates a ConsoleThread for this console/thread
   * - Generates an AI thread name from the first prompt
   * - Auto-creates a Goal linked to the thread
   */
  private async ensureConsoleThreadAndGoal(
    threadId: string,
    prompt: string,
    projectPath: string
  ): Promise<ConsoleThread> {
    const reactiveStore = getReactiveTaskStore();

    // Check if we already have a console thread for this thread ID
    // (threadId is used as both the message thread ID and console ID in current design)
    let consoleThread = reactiveStore.getActiveThreadForConsole(threadId, projectPath);

    if (consoleThread) {
      // Thread exists and is active - increment session count
      reactiveStore.incrementThreadSessionCount(consoleThread.id);
      console.log(`[SessionManager] Using existing active thread "${consoleThread.name}" (sessions: ${consoleThread.sessionCount + 1})`);
      return consoleThread;
    }

    // Check if thread exists but is not active (e.g., closed session being resumed)
    const existingThread = reactiveStore.getConsoleThread(threadId);
    if (existingThread) {
      // Reactivate the existing thread
      reactiveStore.updateThreadStatus(threadId, 'active');
      reactiveStore.incrementThreadSessionCount(threadId);
      console.log(`[SessionManager] Reactivated existing thread "${existingThread.name}" for resume (sessions: ${existingThread.sessionCount + 1})`);
      return { ...existingThread, status: 'active', sessionCount: existingThread.sessionCount + 1 };
    }

    // New thread - generate AI name
    const threadNamer = getThreadNamer();
    let threadName: string;

    try {
      threadName = await threadNamer.generateName(prompt);
      console.log(`[SessionManager] Generated thread name: "${threadName}"`);
    } catch (err) {
      console.error('[SessionManager] Thread name generation failed, using fallback:', err);
      threadName = this.generateQuickSummary(prompt);
    }

    // Create the console thread
    consoleThread = reactiveStore.createConsoleThread({
      id: threadId, // Use threadId as the ConsoleThread ID for simplicity
      name: threadName,
      consoleId: threadId, // In current design, threadId = consoleId
      projectPath,
    });

    console.log(`[SessionManager] Created ConsoleThread "${threadName}" (id: ${consoleThread.id})`);

    // Phase 4: Check for overlap with other active threads
    try {
      const overlapDetector = getOverlapDetector();
      const warning = await overlapDetector.checkOverlap(
        threadName,
        threadId,
        consoleThread.id,
        projectPath
      );

      if (warning) {
        console.log(`[SessionManager] Thread overlap detected: "${threadName}" overlaps with "${warning.existingThreadName}"`);
        this.emit('thread.overlap_warning', warning);
      }
    } catch (err) {
      console.error('[SessionManager] Overlap check failed:', err);
    }

    // Phase 2: Auto-create a Goal for this thread
    const goal = reactiveStore.createGoalForThread(consoleThread);
    console.log(`[SessionManager] Auto-created Goal "${goal.title}" (id: ${goal.id}) for thread "${consoleThread.name}"`);

    return consoleThread;
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

    console.log(`[SessionManager] processQuery starting - cwd: ${sdkOpts.cwd}, message: "${message.slice(0, 50)}..."`);

    // Use the system Claude Code executable so the SDK uses the user's Claude auth
    // (claude auth login), not API key. Without this, the SDK uses a bundled CLI that may exit with code 1.
    const claudePath = this.resolveClaudeExecutablePath();
    if (!claudePath) {
      const err = new Error(
        'Claude Code CLI not found. Install it and log in with your Claude account: run "claude auth login" in a terminal. ' +
        'Ensure the "claude" binary is on your PATH (e.g. in ~/.local/bin or via the official installer).'
      );
      console.error('[SessionManager]', err.message);
      session.status = 'error';
      this.emit('turn.error', thread.id, turnId, err);
      return;
    }

    // Track resume attempt for error handling - check both session-level and SDK opts
    const resumeFromSessionId = session.resumeFromSessionId || sdkOpts.resume;

    try {
      const isResuming = !!resumeFromSessionId;
      console.log(`[SessionManager] Creating SDK query... (using Claude Code at ${claudePath})`);
      console.log(`[SessionManager] Resume state: session.resumeFromSessionId=${session.resumeFromSessionId}, sdkOpts.resume=${sdkOpts.resume}, combined=${resumeFromSessionId}`);
      if (isResuming) {
        console.log(`[SessionManager] Attempting to resume session: ${resumeFromSessionId} (cwd: ${sdkOpts.cwd})`);
      }

      // Build query options - ensure resume is properly passed through
      const queryOpts: Options = {
        ...sdkOpts,
        includePartialMessages: true,
        pathToClaudeCodeExecutable: claudePath,
        // Explicitly set resume from the combined source
        ...(resumeFromSessionId ? { resume: resumeFromSessionId } : {}),
      };
      console.log(`[SessionManager] queryOpts.resume after build: ${queryOpts.resume}`);
      const queryIter = query({
        prompt: message,
        options: queryOpts,
      });

      // Clear the resume flag after first use (subsequent messages in this session don't need it)
      session.resumeFromSessionId = undefined;

      session.query = queryIter;
      session.interruptRequested = false; // Reset interrupt flag for new query
      console.log(`[SessionManager] SDK query created, starting iteration... (resume: ${resumeFromSessionId || 'none'})`);

      // Start activity timeout monitoring
      this.startActivityTimeout(session, turnId);

      for await (const event of queryIter) {
        // Check for interrupt FIRST - before processing any event
        if (session.interruptRequested) {
          console.log(`[SessionManager] Interrupt detected in query loop for ${session.threadId}`);
          break; // Exit the loop immediately
        }

        // Reset timeout on each event (session is still active)
        this.resetActivityTimeout(session, turnId);

        console.log(`[SessionManager] SDK event: ${event.type}`);
        const result = this.handleSDKMessage(session, event, turnId);
        if (result.sessionId) {
          capturedSessionId = result.sessionId;
          // Also store in session object for future use
          session.sdkSessionId = result.sessionId;
        }
        if (result.usage) usage = result.usage;

        // Check for interrupt again after processing (for long-running tool calls)
        if (session.interruptRequested) {
          console.log(`[SessionManager] Interrupt detected after event processing for ${session.threadId}`);
          break;
        }
      }

      // Check if we exited due to interrupt
      const wasInterrupted = session.interruptRequested;
      if (wasInterrupted) {
        console.log(`[SessionManager] Query loop exited due to interrupt for ${session.threadId}`);
        session.interruptRequested = false; // Reset for next query
        this.clearActivityTimeout(session);

        // IMPORTANT: Still save the session ID so conversation can be resumed!
        // Without this, the next message would start a fresh conversation
        try {
          const sdkSessions = await sdkListSessions({ dir: session.cwd });
          if (sdkSessions.length > 0) {
            const sortedSessions = [...sdkSessions].sort((a, b) => {
              const aTime = a.modified ? new Date(a.modified).getTime() : 0;
              const bTime = b.modified ? new Date(b.modified).getTime() : 0;
              return bTime - aTime;
            });
            const actualSessionId = sortedSessions[0].sessionId;
            if (actualSessionId !== thread.sessionId) {
              console.log(`[SessionManager] Saving session ID on interrupt for resume: ${actualSessionId} (cwd: ${session.cwd})`);
              this.getStore().updateThread(thread.id, { sessionId: actualSessionId, sessionCwd: session.cwd });
              session.sdkSessionId = actualSessionId;
            }
          }
        } catch (err) {
          console.error('[SessionManager] Failed to save session ID on interrupt:', err);
          // Fall back to captured ID
          if (capturedSessionId && capturedSessionId !== thread.sessionId) {
            this.getStore().updateThread(thread.id, { sessionId: capturedSessionId, sessionCwd: session.cwd });
          }
        }

        // Store partial assistant output if any
        if (session.outputBuffer.trim()) {
          this.getStore().appendMessage({
            threadId: thread.id,
            turnId,
            role: 'assistant',
            content: session.outputBuffer + '\n\n[Interrupted by user]',
          });
        }

        // Don't proceed with normal completion - the interruptSession method handles status
        return;
      }

      // Clear timeout since query completed successfully
      this.clearActivityTimeout(session);

      // Store assistant message
      this.getStore().appendMessage({
        threadId: thread.id,
        turnId,
        role: 'assistant',
        content: session.outputBuffer,
        usage,
      });

      // Update thread with CORRECT session ID for resume
      // NOTE: The session_id from SDK events is NOT the resumable session ID!
      // We must use listSessions() to get the actual session ID (filename-based)
      try {
        const sdkSessions = await sdkListSessions({ dir: session.cwd });
        // Find the most recent session (should be the one we just created/used)
        if (sdkSessions.length > 0) {
          // Sort by modified date descending to get most recent
          const sortedSessions = [...sdkSessions].sort((a, b) => {
            const aTime = a.modified ? new Date(a.modified).getTime() : 0;
            const bTime = b.modified ? new Date(b.modified).getTime() : 0;
            return bTime - aTime;
          });
          const actualSessionId = sortedSessions[0].sessionId;
          if (actualSessionId !== thread.sessionId) {
            console.log(`[SessionManager] Updating thread with actual SDK session ID: ${actualSessionId} (cwd: ${session.cwd})`);
            this.getStore().updateThread(thread.id, { sessionId: actualSessionId, sessionCwd: session.cwd });
            session.sdkSessionId = actualSessionId;
          }
        }
      } catch (err) {
        console.error('[SessionManager] Failed to get actual session ID from SDK:', err);
        // Fall back to captured ID (though it may not work for resume)
        if (capturedSessionId && capturedSessionId !== thread.sessionId) {
          this.getStore().updateThread(thread.id, { sessionId: capturedSessionId, sessionCwd: session.cwd });
        }
      }

      session.status = 'idle';
      session.currentTurnId = undefined;

      this.emit('turn.completed', thread.id, turnId, session.outputBuffer, usage);

      // Complete active session tracking
      const taskStore = getTaskStore();
      taskStore.completeSession(thread.id, 'completed');
      const completedSession = taskStore.getSession(thread.id);

      // Complete any "doing" tasks for this thread immediately (before prompt.completed)
      // This ensures UI sees updated task statuses alongside session completion
      const completedTaskIds = taskStore.completeActiveTasks(thread.id, 'claude-code');
      if (completedTaskIds.length > 0) {
        console.log(`[SessionManager] Auto-completed ${completedTaskIds.length} active tasks on prompt completion`);
        this.emit('tasks.updated', taskStore.listTasks({ limit: 100, includeCompleted: true }));
      }

      if (completedSession) {
        this.emit('prompt.completed', {
          sessionId: thread.id,
          status: 'completed',
          durationMs: completedSession.durationMs ?? 0,
        });
      }

      // Classify and extract tasks (async, don't block)
      this.classifyAndStoreTasks(session.outputBuffer, {
        threadId: thread.id,
        turnId,
        agentId: 'claude-code',
        agentName: 'Claude Code',
        projectPath: session.cwd,
      }).catch(err => console.error('[SessionManager] Task classification failed:', err));

    } catch (error) {
      const errMsg = error instanceof Error ? error.message : String(error);
      console.error(`[SessionManager] processQuery error:`, error);
      const exitCode1 = /exited with code 1/i.test(errMsg);

      // Check if this was a resume attempt that failed - retry without resume
      if (resumeFromSessionId && exitCode1) {
        console.warn(
          `[SessionManager] Resume attempt failed for session ${resumeFromSessionId}. ` +
          'The session file may no longer exist or the CWD may have changed. ' +
          'Retrying with a fresh session...'
        );

        // Clear the stale session ID and cwd from the thread
        this.getStore().updateThread(thread.id, { sessionId: null, sessionCwd: null });

        // Retry without the resume flag
        const retryOpts: Options = {
          ...sdkOpts,
          // Don't include resume in retry
        };
        delete (retryOpts as any).resume;

        // Reset session state for retry
        session.outputBuffer = '';
        session.status = 'running';

        // Recursive call without resume - this will create a fresh session
        return this.processQuery(session, thread, message, retryOpts, turnId);
      }

      if (exitCode1) {
        console.error(
          '[SessionManager] Hint: Claude Code subprocess exited with code 1. ' +
          'Ensure you are logged in with your Claude account: run "claude auth status" to check, or "claude auth login" to sign in.'
        );
      }
      // Handle SDK exit code quirk - if we have output, treat as success
      if (session.outputBuffer.length > 0) {
        this.getStore().appendMessage({
          threadId: thread.id,
          turnId,
          role: 'assistant',
          content: session.outputBuffer,
          usage,
        });

        if (capturedSessionId && capturedSessionId !== thread.sessionId) {
          this.getStore().updateThread(thread.id, { sessionId: capturedSessionId, sessionCwd: session.cwd });
        }

        session.status = 'idle';
        session.currentTurnId = undefined;

        this.emit('turn.completed', thread.id, turnId, session.outputBuffer, usage);

        // Complete active session tracking
        const taskStore = getTaskStore();
        taskStore.completeSession(thread.id, 'completed');
        const completedSession = taskStore.getSession(thread.id);

        // Complete any "doing" tasks for this thread immediately (before prompt.completed)
        const completedTaskIds = taskStore.completeActiveTasks(thread.id, 'claude-code');
        if (completedTaskIds.length > 0) {
          console.log(`[SessionManager] Auto-completed ${completedTaskIds.length} active tasks on prompt completion (error path)`);
          this.emit('tasks.updated', taskStore.listTasks({ limit: 100, includeCompleted: true }));
        }

        if (completedSession) {
          this.emit('prompt.completed', {
            sessionId: thread.id,
            status: 'completed',
            durationMs: completedSession.durationMs ?? 0,
          });
        }

        // Classify and extract tasks (async, don't block)
        this.classifyAndStoreTasks(session.outputBuffer, {
          threadId: thread.id,
          turnId,
          agentId: 'claude-code',
          agentName: 'Claude Code',
          projectPath: session.cwd,
        }).catch(err => console.error('[SessionManager] Task classification failed:', err));
      } else {
        session.status = 'error';

        // Complete active session tracking with failure
        const taskStore = getTaskStore();
        taskStore.completeSession(thread.id, 'failed');
        const failedSession = taskStore.getSession(thread.id);

        // Also complete any "doing" tasks on failure (mark them as completed since the prompt is done)
        const completedTaskIds = taskStore.completeActiveTasks(thread.id, 'claude-code');
        if (completedTaskIds.length > 0) {
          console.log(`[SessionManager] Auto-completed ${completedTaskIds.length} active tasks on prompt failure`);
          this.emit('tasks.updated', taskStore.listTasks({ limit: 100, includeCompleted: true }));
        }

        if (failedSession) {
          this.emit('prompt.completed', {
            sessionId: thread.id,
            status: 'failed',
            durationMs: failedSession.durationMs ?? 0,
          });
        }

        let emitError: Error = error instanceof Error ? error : new Error(String(error));
        if (exitCode1) {
          emitError = new Error(
            `${emitError.message} — Log in with your Claude account: run "claude auth login" in a terminal, then try again.`
          );
        }
        this.emit('turn.error', thread.id, turnId, emitError);
      }
    } finally {
      // Always clear timeout and query reference
      this.clearActivityTimeout(session);
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
    source: { threadId: string; turnId: string; agentId: string; agentName: string; projectPath?: string }
  ): Promise<void> {
    const extractor = getExtractor();
    const taskStore = getTaskStore();

    // Note: completeActiveTasks is now called BEFORE prompt.completed in processQuery
    // This ensures task statuses are updated before the UI receives the session completion event

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

    // Phase 2: Get the goal ID from the thread's ConsoleThread
    let goalId: string | undefined;
    const consoleThread = taskStore.getConsoleThread(source.threadId);
    if (consoleThread?.goalId) {
      goalId = consoleThread.goalId;
      console.log(`[SessionManager] Associating tasks with goal ${goalId}`);
    }

    // Add or update tasks by status
    for (const task of result.tasks) {
      const base = {
        text: task.text,
        summary: task.summary,  // Include summary from extraction
        confidence: task.confidence,
        source: {
          type: 'extraction' as const,
          turnId: source.turnId,
          agentId: source.agentId,
          agentName: source.agentName,
        },
        threadId: source.threadId,
        turnId: source.turnId,
        agentId: source.agentId,
        agentName: source.agentName,
        projectPath: source.projectPath,
        goalId, // Phase 2: Auto-associate with thread's goal
        consoleId: source.threadId, // Phase 3: Associate with console for Next Actions
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

    // Emit event for UI (include completed tasks so UI can update status transitions)
    this.emit('tasks.updated', taskStore.listTasks({ limit: 100, includeCompleted: true }));
  }

  // ==================== Worktree Operations ====================

  /**
   * Enable worktree isolation for a thread.
   * Creates a new branch and worktree, updates the session to use it.
   */
  async enableWorktree(
    threadId: string,
    options: { branch?: string; baseBranch?: string; cwd?: string; name?: string } = {}
  ): Promise<{ worktreePath: string; branch: string; baseBranch: string }> {
    let thread = this.getStore().getThread(threadId);

    // If thread doesn't exist, create it (for enabling worktree before first message)
    if (!thread) {
      if (!options.cwd) {
        throw new Error(`Thread ${threadId} not found and no cwd provided to create it`);
      }
      this.getStore().createThread({
        id: threadId,
        projectPath: options.cwd,
        name: options.name,
      });
      thread = this.getStore().getThread(threadId)!;
    }

    if (thread.worktreePath) {
      throw new Error(`Thread ${threadId} already has a worktree at ${thread.worktreePath}`);
    }

    const session = this.sessions.get(threadId);
    const repoPath = options.cwd ?? session?.cwd ?? thread.projectPath;

    // Generate branch name from thread name or ID
    // Sanitize branch names - remove any leading '+ ' prefix that might have been
    // accidentally included from UI display formatting
    const baseBranch = (options.baseBranch ?? 'main').replace(/^\+\s*/, '').trim();
    const rawBranch = options.branch ?? this.generateBranchName(thread.name ?? threadId);
    const branch = rawBranch.replace(/^\+\s*/, '').trim();

    const worktreeManager = getWorktreeManager(repoPath);

    // Check if a worktree already exists for this branch
    const existingWorktree = await worktreeManager.get(branch);
    let worktreePath: string;

    if (existingWorktree) {
      // Use the existing worktree
      console.log(`[SessionManager] Using existing worktree for branch ${branch}: ${existingWorktree.path}`);
      worktreePath = existingWorktree.path;
    } else {
      // Create a new worktree
      const result = await worktreeManager.create({
        branch,
        baseBranch,
      });

      if (!result.success || !result.worktree) {
        throw new Error(result.error ?? 'Failed to create worktree');
      }

      worktreePath = result.worktree.path;
    }

    // Update thread with worktree path and clear sessionId
    // We clear sessionId because Claude Code sessions are tied to a specific cwd,
    // so we need a fresh session in the new worktree directory
    this.getStore().updateThread(threadId, {
      worktreePath,
      sessionId: null, // Clear so next message starts fresh session in worktree
      metadata: {
        ...thread.metadata,
        worktreeBranch: branch,
        worktreeBaseBranch: baseBranch,
      },
    });

    // Update session cwd if session exists
    if (session) {
      session.cwd = worktreePath;
    }

    console.log(`[SessionManager] Enabled worktree for thread ${threadId}: ${worktreePath} (branch: ${branch})`);

    return {
      worktreePath,
      branch,
      baseBranch,
    };
  }

  /** Generate a branch name from a thread name */
  private generateBranchName(name: string): string {
    const sanitized = name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 40);
    const suffix = Date.now().toString(36).slice(-4);
    return `agent/${sanitized}-${suffix}`;
  }

  /** Get worktree info for a thread */
  async getWorktreeInfo(threadId: string): Promise<WorktreeInfo | null> {
    const thread = this.getStore().getThread(threadId);
    if (!thread?.worktreePath) {
      return null;
    }

    const session = this.sessions.get(threadId);
    const repoPath = session?.cwd ?? thread.projectPath;

    // If session cwd is already the worktree, use project path as repo
    const actualRepoPath = repoPath === thread.worktreePath ? thread.projectPath : repoPath;

    const worktreeManager = getWorktreeManager(actualRepoPath);
    const branch = (thread.metadata as any)?.worktreeBranch;

    if (!branch) {
      return null;
    }

    return worktreeManager.get(branch);
  }

  /** Get changes made in the thread's worktree */
  async getWorktreeChanges(threadId: string): Promise<WorktreeChanges | null> {
    const thread = this.getStore().getThread(threadId);
    if (!thread?.worktreePath) {
      return null;
    }

    const metadata = thread.metadata as any;
    const branch = metadata?.worktreeBranch;

    if (!branch) {
      return null;
    }

    const worktreeManager = getWorktreeManager(thread.projectPath);
    return worktreeManager.getChanges(branch);
  }

  /** Merge the thread's worktree branch into target branch */
  async mergeWorktree(
    threadId: string,
    options: { targetBranch?: string; message?: string; removeAfterMerge?: boolean } = {}
  ): Promise<MergeResult> {
    const thread = this.getStore().getThread(threadId);
    if (!thread?.worktreePath) {
      throw new Error(`Thread ${threadId} does not have a worktree`);
    }

    const metadata = thread.metadata as any;
    const branch = metadata?.worktreeBranch;
    const baseBranch = metadata?.worktreeBaseBranch;

    if (!branch) {
      throw new Error(`Thread ${threadId} worktree has no branch info`);
    }

    // Generate merge message from conversation context if not provided
    let mergeMessage = options.message;
    if (!mergeMessage) {
      console.log(`[SessionManager] Generating merge message from conversation context...`);
      try {
        // Get conversation history for this thread
        const messages = this.getMessages(threadId);
        const conversationMessages = messages.map(m => ({
          role: m.role as 'user' | 'assistant',
          content: m.content,
        }));

        const generator = getMergeMessageGenerator();
        const result = await generator.generate({
          branch,
          targetBranch: options.targetBranch || baseBranch || 'main',
          messages: conversationMessages,
          threadName: thread.name,
        });

        mergeMessage = result.fullMessage;
        console.log(`[SessionManager] Generated merge message: ${result.title}`);
      } catch (genError) {
        console.error(`[SessionManager] Failed to generate merge message:`, genError);
        // Fall back to thread name or branch name
        mergeMessage = thread.name
          ? `Merge: ${thread.name}`
          : `Merge branch '${branch}'`;
      }
    }

    const worktreeManager = getWorktreeManager(thread.projectPath);
    const result = await worktreeManager.merge(branch, {
      targetBranch: options.targetBranch,
      message: mergeMessage,
    });

    // If merge succeeded and removeAfterMerge, clean up
    if (result.success && options.removeAfterMerge) {
      await worktreeManager.remove(branch, true);

      // Close the existing session since its cwd no longer exists
      // This will force a new session to be created with the correct cwd
      await this.closeSession(threadId);

      // Update thread: clear worktree info and sessionId so next message creates fresh session
      this.getStore().updateThread(threadId, {
        worktreePath: undefined,
        sessionId: null, // Clear so next message starts fresh session in project path
        metadata: {
          ...metadata,
          worktreeBranch: undefined,
          worktreeBaseBranch: undefined,
          worktreeMergedAt: new Date().toISOString(),
        },
      });

      console.log(`[SessionManager] Merged and cleaned up worktree for thread ${threadId}`);
    }

    return result;
  }

  /** Remove worktree for a thread without merging */
  async removeWorktree(threadId: string, force = false): Promise<void> {
    const thread = this.getStore().getThread(threadId);
    if (!thread?.worktreePath) {
      return; // Nothing to remove
    }

    const metadata = thread.metadata as any;
    const branch = metadata?.worktreeBranch;

    if (branch) {
      const worktreeManager = getWorktreeManager(thread.projectPath);
      await worktreeManager.remove(branch, force);
    }

    // Close the existing session since its cwd no longer exists
    await this.closeSession(threadId);

    // Update thread: clear worktree info and sessionId so next message creates fresh session
    this.getStore().updateThread(threadId, {
      worktreePath: undefined,
      sessionId: null, // Clear so next message starts fresh session in project path
      metadata: {
        ...metadata,
        worktreeBranch: undefined,
        worktreeBaseBranch: undefined,
      },
    });

    console.log(`[SessionManager] Removed worktree for thread ${threadId}`);
  }

  /** Interrupt a running session (graceful stop - keeps session alive for continued chat) */
  async interruptSession(threadId: string): Promise<{ interrupted: boolean; wasRunning: boolean }> {
    const session = this.sessions.get(threadId);
    if (!session) {
      return { interrupted: false, wasRunning: false };
    }

    const wasRunning = session.status === 'running';

    if (wasRunning) {
      console.log(`[SessionManager] Interrupting session ${threadId}...`);

      // Set interrupt flag FIRST - this will be checked in the query loop
      session.interruptRequested = true;

      // Clear the activity timeout
      this.clearActivityTimeout(session);

      // Try to interrupt the SDK query immediately
      if (session.query) {
        try {
          // Use the SDK's interrupt() method if available (more immediate than return())
          if ('interrupt' in session.query && typeof (session.query as any).interrupt === 'function') {
            await (session.query as any).interrupt();
            console.log(`[SessionManager] SDK interrupt() called for ${threadId}`);
          } else {
            // Fallback to return() - this signals the async iterator to stop
            await session.query.return(undefined);
            console.log(`[SessionManager] Query return() called for ${threadId}`);
          }
        } catch (err) {
          // Interrupt errors are expected, just log them
          console.log(`[SessionManager] Interrupt signal sent (error expected): ${err}`);
        }
      }

      // Update session status back to idle (NOT completed - user can continue chatting)
      session.status = 'idle';
      session.currentTurnId = undefined;
      session.query = null; // Clear the query so a new one can be created

      // Emit turn.interrupted event so UI knows the turn was stopped
      // but DON'T complete the session - it stays active for continued chat
      this.emit('turn.interrupted', {
        sessionId: threadId,
        message: 'Turn interrupted by user',
      });

      console.log(`[SessionManager] Interrupted turn in session ${threadId} (session still active)`);
      return { interrupted: true, wasRunning: true };
    }

    return { interrupted: false, wasRunning };
  }

  /** Close a session */
  async closeSession(threadId: string): Promise<void> {
    const session = this.sessions.get(threadId);
    if (!session) return;

    // Clear any activity timeout
    this.clearActivityTimeout(session);

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
    this.getStore().deleteThread(threadId);
    console.log(`[SessionManager] Deleted thread ${threadId}`);
  }

  /** Fork a thread */
  async forkThread(
    sourceThreadId: string, 
    options: { name?: string; fromMessageId?: number }
  ): Promise<Thread> {
    const newId = crypto.randomUUID();
    const forked = this.getStore().forkThread(sourceThreadId, newId, {
      name: options.name,
      upToMessageId: options.fromMessageId,
    });
    console.log(`[SessionManager] Forked thread ${sourceThreadId} → ${newId}`);
    return forked;
  }

  // ==================== Session Resume Operations ====================

  /** List sessions with filtering (for session resume feature) */
  listSessions(options: {
    projectPath?: string;
    status?: SessionStatus[];
    limit?: number;
    offset?: number;
  } = {}): Thread[] {
    return this.getStore().listSessions(options);
  }

  /** Get sessions that can be resumed (active or suspended) */
  getResumableSessions(projectPath: string): Thread[] {
    return this.getStore().getResumableSessions(projectPath);
  }

  /** Mark session as closed (preserves data for future resume) */
  markSessionClosed(threadId: string): void {
    this.getStore().closeSession(threadId);
    console.log(`[SessionManager] Marked session ${threadId} as closed`);
  }

  /** Mark session as suspended (for app shutdown) */
  markSessionSuspended(threadId: string): void {
    this.getStore().suspendSession(threadId);
    console.log(`[SessionManager] Marked session ${threadId} as suspended`);
  }

  /** Reactivate a session */
  markSessionActive(threadId: string): void {
    this.getStore().activateSession(threadId);
    console.log(`[SessionManager] Marked session ${threadId} as active`);
  }

  /** Archive a session */
  archiveSession(threadId: string): void {
    this.getStore().archiveSession(threadId);
    console.log(`[SessionManager] Archived session ${threadId}`);
  }

  /** Suspend all active sessions for a project */
  suspendAllSessions(projectPath: string): number {
    const count = this.getStore().suspendAllSessions(projectPath);
    console.log(`[SessionManager] Suspended ${count} sessions for ${projectPath}`);
    return count;
  }

  /** Search sessions by message content (FTS) */
  searchSessions(query: string, options: {
    projectPath?: string;
    limit?: number;
  } = {}): Array<Thread & { matchSnippet?: string }> {
    return this.getStore().searchSessions(query, options);
  }

  /** Quick search by thread name or last prompt */
  quickSearchSessions(query: string, options: {
    projectPath?: string;
    limit?: number;
  } = {}): Thread[] {
    return this.getStore().quickSearchSessions(query, options);
  }

  /** Shutdown - close all sessions */
  async shutdown(): Promise<void> {
    for (const threadId of this.sessions.keys()) {
      await this.closeSession(threadId);
    }
    this.getStore().close();
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
export type { Thread, Message, SessionStatus } from '../persistence/sqlite-store';
