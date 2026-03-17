/**
 * Command Center Server
 * 
 * HTTP + WebSocket server for the Electron app.
 * Manages adapters, streams events, handles integrations.
 */

import { createServer, type Server } from 'http';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { serve } from '@hono/node-server';
import { WebSocketServer, WebSocket } from 'ws';
import type { AdapterConfig, AdapterEvent } from '@acc/contracts';
import type { AdapterImplementation, AdapterContext } from './adapters/types';
import { AdapterEventEmitter } from './adapters/types';
import { createClaudeCodeAdapter } from './adapters/claude-code';
import { createOpenClawAdapter } from './adapters/openclaw';
import { getSessionManager, type Thread, type Session } from './adapters/session-manager';
import { getTaskStore, type Task as ExtractedTask } from './persistence/task-store';
import { getReactiveTaskStore } from './persistence/reactive-task-store';
import { getExtractor, type ExtractionResult } from './extractor';
import { initSyncEventEmitter, getSyncEventEmitter, type SyncEvent } from './events/sync-events';
import { initQueryManager, getQueryManager } from './subscriptions/query-manager';

interface ManagedAdapter {
  implementation: AdapterImplementation;
  config: AdapterConfig;
  eventEmitter: AdapterEventEmitter;
}

interface ConnectedAgent {
  ws: WebSocket;
  name: string;
  capabilities: string[];
  connectedAt: Date;
  pendingTasks: Map<string, { resolve: (result: string) => void; reject: (error: Error) => void }>;
}

interface Task {
  id: string;
  message: string;
  agent: string | null;
  status: 'created' | 'planning' | 'planned' | 'executing' | 'completed' | 'failed';
  createdAt: Date;
  completedAt?: Date;
  plan: string | null;
  result: string | null;
}

export class CommandCenterServer {
  private app: Hono;
  private httpServer: Server | null = null;
  private wss: WebSocketServer | null = null;
  private adapters = new Map<string, ManagedAdapter>();
  private clients = new Set<WebSocket>();
  private clientIds = new Map<WebSocket, string>(); // WebSocket -> clientId for query subscriptions
  private connectedAgents = new Map<string, ConnectedAgent>();
  private tasks = new Map<string, Task>();
  private _port: number;
  
  /** Actual port the server is listening on (may differ from requested if port was in use) */
  get port(): number { return this._port; }

  constructor(port = 3333) {
    this._port = port;
    this.app = new Hono();
    this.setupRoutes();
  }

  private setupRoutes(): void {
    // Allow UI (Vite dev or Electron) to call API
    this.app.use('*', cors({ origin: '*', allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'], allowHeaders: ['Content-Type', 'Authorization'] }));

    // Health check
    this.app.get('/health', (c) => c.json({ ok: true, port: this._port }));

    // Check Claude Code CLI availability
    this.app.get('/check/claude-code', async (c) => {
      try {
        const { execSync } = await import('child_process');
        const version = execSync('claude --version 2>/dev/null', { encoding: 'utf-8' }).trim();
        
        // Also check if adapter is registered
        const hasAdapter = Array.from(this.adapters.values()).some(a => a.config.kind === 'claude-code');
        
        return c.json({ available: true, version, adapterRegistered: hasAdapter });
      } catch {
        return c.json({ available: false, adapterRegistered: false });
      }
    });

    // Initialize Claude Code adapter
    this.app.post('/adapters/claude-code/init', async (c) => {
      try {
        // Check if already registered
        const existing = Array.from(this.adapters.values()).find(a => a.config.kind === 'claude-code');
        if (existing) {
          return c.json({ ok: true, status: 'already_registered', id: existing.config.id });
        }

        // Check if CLI is available
        const { execSync } = await import('child_process');
        try {
          execSync('claude --version', { encoding: 'utf-8' });
        } catch {
          return c.json({ ok: false, error: 'Claude Code CLI not installed' }, 400);
        }

        // Create adapter with bypassPermissions to avoid hanging on prompts
        const config = {
          id: 'claude-code-local',
          kind: 'claude-code' as const,
          name: 'Claude Code (Local)',
          options: {
            permissionMode: 'bypassPermissions' as const,
            turnTimeoutMs: 300000,  // 5 min timeout
          },
        };
        
        const adapter = await this.createAdapter(config);
        await adapter.connect();
        
        return c.json({ ok: true, status: 'initialized', id: config.id });
      } catch (error) {
        return c.json({ 
          ok: false, 
          error: error instanceof Error ? error.message : 'Failed to initialize' 
        }, 500);
      }
    });

    // List adapters
    this.app.get('/adapters', (c) => {
      const adapters = Array.from(this.adapters.entries()).map(([id, { config, implementation }]) => ({
        id,
        kind: config.kind,
        name: config.name,
        state: implementation.getState(),
        capabilities: implementation.getCapabilities(),
      }));
      return c.json({ adapters });
    });

    // Create adapter
    this.app.post('/adapters', async (c) => {
      const config = await c.req.json<AdapterConfig>();
      
      try {
        const adapter = await this.createAdapter(config);
        return c.json({ 
          ok: true, 
          id: config.id,
          state: adapter.getState(),
        });
      } catch (error) {
        return c.json({ 
          ok: false, 
          error: error instanceof Error ? error.message : 'Unknown error' 
        }, 500);
      }
    });

    // Connect adapter
    this.app.post('/adapters/:id/connect', async (c) => {
      const id = c.req.param('id');
      const managed = this.adapters.get(id);
      
      if (!managed) {
        return c.json({ ok: false, error: 'Adapter not found' }, 404);
      }

      try {
        await managed.implementation.connect();
        return c.json({ ok: true, state: managed.implementation.getState() });
      } catch (error) {
        return c.json({ 
          ok: false, 
          error: error instanceof Error ? error.message : 'Connection failed' 
        }, 500);
      }
    });

    // Disconnect adapter
    this.app.post('/adapters/:id/disconnect', async (c) => {
      const id = c.req.param('id');
      const managed = this.adapters.get(id);
      
      if (!managed) {
        return c.json({ ok: false, error: 'Adapter not found' }, 404);
      }

      await managed.implementation.disconnect();
      return c.json({ ok: true });
    });

    // Test CWD handling - sends a simple pwd check to verify cwd is working
    this.app.post('/adapters/:id/test-cwd', async (c) => {
      const id = c.req.param('id');
      const managed = this.adapters.get(id);
      
      if (!managed) {
        return c.json({ ok: false, error: 'Adapter not found' }, 404);
      }

      const { cwd } = await c.req.json<{ cwd?: string }>();
      console.log(`[${id}] CWD test request with cwd: ${cwd ?? '(not set)'}`);
      
      try {
        const result = await managed.implementation.send({
          message: 'Run `pwd` and report the current working directory. Just show the path, nothing else.',
          cwd,
          taskOptions: { effort: 'low', maxTurns: 1 },
        });
        return c.json({ ok: true, ...result, requestedCwd: cwd });
      } catch (error) {
        return c.json({ 
          ok: false, 
          error: error instanceof Error ? error.message : 'Test failed',
          requestedCwd: cwd,
        }, 500);
      }
    });

    // Send to adapter
    this.app.post('/adapters/:id/send', async (c) => {
      const id = c.req.param('id');
      const managed = this.adapters.get(id);
      
      if (!managed) {
        return c.json({ ok: false, error: 'Adapter not found' }, 404);
      }

      const options = await c.req.json();
      console.log(`[${id}] Send request:`, { message: options.message?.slice(0, 50), cwd: options.cwd });
      
      try {
        const result = await managed.implementation.send(options);
        return c.json({ ok: true, ...result });
      } catch (error) {
        return c.json({ 
          ok: false, 
          error: error instanceof Error ? error.message : 'Send failed' 
        }, 500);
      }
    });

    // Interrupt adapter
    this.app.post('/adapters/:id/interrupt', async (c) => {
      const id = c.req.param('id');
      const managed = this.adapters.get(id);
      
      if (!managed) {
        return c.json({ ok: false, error: 'Adapter not found' }, 404);
      }

      await managed.implementation.interrupt();
      return c.json({ ok: true });
    });

    // Delete adapter
    this.app.delete('/adapters/:id', async (c) => {
      const id = c.req.param('id');
      const managed = this.adapters.get(id);
      
      if (!managed) {
        return c.json({ ok: false, error: 'Adapter not found' }, 404);
      }

      await managed.implementation.destroy();
      this.adapters.delete(id);
      return c.json({ ok: true });
    });

    // ============ Task Extraction ============
    // Uses @anthropic-ai/claude-agent-sdk for task extraction from terminal output

    // Extract tasks from terminal output
    this.app.post('/extract', async (c) => {
      const { output } = await c.req.json<{ output: string }>();
      
      if (!output) {
        return c.json({ ok: false, error: 'output is required' }, 400);
      }

      try {
        const extractor = getExtractor();
        const result = await extractor.extract(output);
        return c.json({ ok: true, ...result });
      } catch (error) {
        return c.json({ 
          ok: false, 
          error: error instanceof Error ? error.message : 'Extraction failed' 
        }, 500);
      }
    });

    // Get extractor status
    this.app.get('/extract/status', (c) => {
      const extractor = getExtractor();
      return c.json({ 
        ok: true, 
        ready: extractor.ready,
        busy: extractor.busy,
      });
    });

    // ============ Agent Channel Routes ============

    // List connected agents
    this.app.get('/agents', (c) => {
      const agents = this.getConnectedAgents();
      return c.json({ agents });
    });

    // Send task to agent (low-level)
    this.app.post('/agents/:name/task', async (c) => {
      const name = c.req.param('name');
      const { message } = await c.req.json<{ message: string }>();
      const taskId = crypto.randomUUID();
      
      try {
        const result = await this.sendTaskToAgent(name, taskId, message);
        return c.json({ ok: true, taskId, result });
      } catch (error) {
        return c.json({ 
          ok: false, 
          error: error instanceof Error ? error.message : 'Task failed' 
        }, 500);
      }
    });

    // ============ Thread & Session Routes (Phase 2/3) ============

    // List all threads
    this.app.get('/threads', async (c) => {
      const limit = parseInt(c.req.query('limit') ?? '50');
      const offset = parseInt(c.req.query('offset') ?? '0');
      
      const manager = getSessionManager();
      const threads = manager.listThreads({ limit, offset });
      return c.json({ ok: true, threads });
    });

    // Get thread details
    this.app.get('/threads/:id', async (c) => {
      const id = c.req.param('id');
      const manager = getSessionManager();
      const thread = manager.getThread(id);
      
      if (!thread) {
        return c.json({ ok: false, error: 'Thread not found' }, 404);
      }

      const session = manager.getSession(id);
      return c.json({ 
        ok: true, 
        thread,
        session: session ? {
          status: session.status,
          currentTurnId: session.currentTurnId,
        } : null,
      });
    });

    // Get thread messages (paginated)
    this.app.get('/threads/:id/messages', async (c) => {
      const id = c.req.param('id');
      const limit = parseInt(c.req.query('limit') ?? '100');
      const beforeId = c.req.query('before') ? parseInt(c.req.query('before')!) : undefined;
      
      const manager = getSessionManager();
      const thread = manager.getThread(id);
      
      if (!thread) {
        return c.json({ ok: false, error: 'Thread not found' }, 404);
      }

      const messages = manager.getMessages(id, { limit, beforeId });
      return c.json({ ok: true, messages });
    });

    // Create session for thread (or resume existing)
    this.app.post('/threads/:id/session', async (c) => {
      const id = c.req.param('id');
      console.log(`[threads/${id}] Session create request`);
      const { cwd, name, worktreePath, resume } = await c.req.json<{
        cwd: string;
        name?: string;
        worktreePath?: string;
        resume?: boolean;
      }>();

      const manager = getSessionManager();
      
      try {
        const session = await manager.createSession({
          threadId: id,
          cwd,
          name,
          worktreePath,
          resume,
        });

        return c.json({ 
          ok: true, 
          threadId: id,
          session: {
            status: session.status,
            cwd: session.cwd,
          },
        });
      } catch (error) {
        return c.json({ 
          ok: false, 
          error: error instanceof Error ? error.message : 'Failed to create session',
        }, 500);
      }
    });

    // Send message to thread session
    this.app.post('/threads/:id/send', async (c) => {
      const id = c.req.param('id');
      const manager = getSessionManager();
      const session = manager.getSession(id);
      if (!session) {
        console.log(`[threads/${id}] Send rejected: no active session`);
        return c.json({ ok: false, error: 'No active session for thread' }, 400);
      }
      const options = await c.req.json<{
        message: string;
        effort?: 'low' | 'medium' | 'high' | 'max';
        thinking?: { type: 'adaptive' } | { type: 'enabled'; budgetTokens?: number } | { type: 'disabled' };
        maxTurns?: number;
        model?: string;
      }>();
      console.log(`[threads/${id}] Send:`, { message: options?.message?.slice(0, 50) ?? '(no message)' });

      try {
        const result = await manager.send(id, options);
        return c.json({ ok: true, ...result });
      } catch (error) {
        return c.json({ 
          ok: false, 
          error: error instanceof Error ? error.message : 'Send failed',
        }, 500);
      }
    });

    // Close thread session
    this.app.post('/threads/:id/close', async (c) => {
      const id = c.req.param('id');
      const manager = getSessionManager();
      
      await manager.closeSession(id);
      return c.json({ ok: true });
    });

    // Delete thread entirely
    this.app.delete('/threads/:id', async (c) => {
      const id = c.req.param('id');
      const manager = getSessionManager();
      
      await manager.deleteThread(id);
      return c.json({ ok: true });
    });

    // Fork a thread
    this.app.post('/threads/:id/fork', async (c) => {
      const id = c.req.param('id');
      const { name, fromMessageId } = await c.req.json<{
        name?: string;
        fromMessageId?: number;
      }>();

      const manager = getSessionManager();
      
      try {
        const forked = await manager.forkThread(id, { name, fromMessageId });
        return c.json({ ok: true, thread: forked });
      } catch (error) {
        return c.json({ 
          ok: false, 
          error: error instanceof Error ? error.message : 'Fork failed',
        }, 500);
      }
    });

    // ============ Extracted Tasks API ============

    // List extracted tasks
    this.app.get('/extracted-tasks', (c) => {
      const status = c.req.query('status');
      const agentId = c.req.query('agent');
      const threadId = c.req.query('thread');
      const includeCompleted = c.req.query('includeCompleted') === 'true';
      const limit = parseInt(c.req.query('limit') ?? '50');

      const store = getTaskStore();
      const tasks = store.listTasks({
        status: status as ExtractedTask['status'] | undefined,
        agentId,
        threadId,
        limit,
        includeCompleted,
      });

      return c.json({ ok: true, tasks });
    });

    // Get task counts
    this.app.get('/extracted-tasks/counts', (c) => {
      const store = getTaskStore();
      const counts = store.getCounts();
      return c.json({ ok: true, counts });
    });

    // Get active tasks (what agents are doing now)
    this.app.get('/extracted-tasks/active', (c) => {
      const store = getTaskStore();
      const tasks = store.getActiveTasks();
      return c.json({ ok: true, tasks });
    });

    // Get pending tasks (planned but not started)
    this.app.get('/extracted-tasks/pending', (c) => {
      const store = getTaskStore();
      const tasks = store.getPendingTasks();
      return c.json({ ok: true, tasks });
    });

    // Get suggested tasks
    this.app.get('/extracted-tasks/suggested', (c) => {
      const store = getTaskStore();
      const tasks = store.getSuggestedTasks();
      return c.json({ ok: true, tasks });
    });

    // Get recently completed
    this.app.get('/extracted-tasks/completed', (c) => {
      const limit = parseInt(c.req.query('limit') ?? '10');
      const store = getTaskStore();
      const tasks = store.getRecentlyCompleted(limit);
      return c.json({ ok: true, tasks });
    });

    // Update task status
    this.app.patch('/extracted-tasks/:id', async (c) => {
      const id = c.req.param('id');
      const { status } = await c.req.json<{ status: ExtractedTask['status'] }>();

      const store = getReactiveTaskStore();
      store.updateStatus(id, status);
      // Events auto-emitted by ReactiveTaskStore

      const task = store.getTask(id);
      return c.json({ ok: true, task });
    });

    // Dismiss a suggested task
    this.app.post('/extracted-tasks/:id/dismiss', (c) => {
      const id = c.req.param('id');
      const store = getReactiveTaskStore();
      store.dismissTask(id);
      // Events auto-emitted by ReactiveTaskStore

      return c.json({ ok: true });
    });

    // Complete a task
    this.app.post('/extracted-tasks/:id/complete', (c) => {
      const id = c.req.param('id');
      const store = getReactiveTaskStore();
      store.completeTask(id);
      // Events auto-emitted by ReactiveTaskStore

      return c.json({ ok: true });
    });

    // Start a task (mark as doing)
    this.app.post('/extracted-tasks/:id/start', (c) => {
      const id = c.req.param('id');
      const store = getReactiveTaskStore();
      store.startTask(id);
      // Events auto-emitted by ReactiveTaskStore

      return c.json({ ok: true });
    });

    // Move task to goal
    this.app.post('/extracted-tasks/:id/move-to-goal', async (c) => {
      const id = c.req.param('id');
      const { goalId } = await c.req.json<{ goalId: string | null }>();
      const store = getReactiveTaskStore();
      store.moveTaskToGoal(id, goalId);
      // Events auto-emitted by ReactiveTaskStore (both tasks and goals)

      return c.json({ ok: true });
    });

    // ============ Goals Routes ============

    // List all goals
    this.app.get('/goals', (c) => {
      const status = c.req.query('status');
      const store = getTaskStore();
      const goals = store.listGoals({
        status: status as 'active' | 'completed' | 'archived' | undefined,
      });
      return c.json(goals);
    });

    // Create a new goal
    this.app.post('/goals', async (c) => {
      const { title, description, createdVia, projectPath } = await c.req.json<{
        title: string;
        description?: string;
        createdVia: 'plan' | 'manual' | 'ai-suggestion';
        projectPath?: string;
      }>();
      const store = getReactiveTaskStore();
      const goal = store.createGoal({ title, description, createdVia, projectPath });
      // Events auto-emitted by ReactiveTaskStore

      return c.json(goal);
    });

    // Get a specific goal
    this.app.get('/goals/:id', (c) => {
      const id = c.req.param('id');
      const store = getTaskStore();
      const goal = store.getGoal(id);
      if (!goal) {
        return c.json({ ok: false, error: 'Goal not found' }, 404);
      }
      // Include tasks for this goal
      const tasks = store.getTasksByGoal(id);
      return c.json({ ...goal, tasks });
    });

    // Update a goal
    this.app.patch('/goals/:id', async (c) => {
      const id = c.req.param('id');
      const updates = await c.req.json<{
        title?: string;
        description?: string;
        status?: 'active' | 'completed' | 'archived';
      }>();
      const store = getReactiveTaskStore();
      store.updateGoal(id, updates);
      // Events auto-emitted by ReactiveTaskStore

      return c.json({ ok: true });
    });

    // Archive a goal
    this.app.delete('/goals/:id', (c) => {
      const id = c.req.param('id');
      const store = getReactiveTaskStore();
      store.archiveGoal(id);
      // Events auto-emitted by ReactiveTaskStore

      return c.json({ ok: true });
    });

    // Get inbox goal (creates if doesn't exist)
    this.app.get('/goals/inbox', (c) => {
      const store = getTaskStore();
      const inbox = store.getOrCreateInbox();
      const tasks = store.getUnassignedTasks();
      return c.json({ ...inbox, tasks });
    });

    // ============ Active Sessions Routes (Tier 1) ============

    // Get currently running sessions
    this.app.get('/sessions/active', (c) => {
      const store = getTaskStore();
      const sessions = store.getActiveSessions();
      return c.json(sessions);
    });

    // Get recently completed sessions (not dismissed)
    this.app.get('/sessions/recent', (c) => {
      const limit = parseInt(c.req.query('limit') || '10');
      const store = getTaskStore();
      const sessions = store.getRecentlyCompletedSessions(limit);
      return c.json(sessions);
    });

    // Dismiss a completed session from recent list
    this.app.post('/sessions/:id/dismiss', (c) => {
      const id = c.req.param('id');
      const store = getReactiveTaskStore();
      store.dismissSession(id);
      // Events auto-emitted by ReactiveTaskStore

      return c.json({ ok: true });
    });

    // Delete/stop an active session
    this.app.delete('/sessions/:id', async (c) => {
      const id = c.req.param('id');
      const store = getReactiveTaskStore();
      const sessionManager = getSessionManager();

      try {
        // Close the session (stops the running query)
        await sessionManager.closeSession(id);
        // Mark as failed in the store
        store.completeSession(id, 'failed');
        // Also dismiss any active tasks associated with this session/thread
        const activeTasks = store.listTasks({ threadId: id, status: 'doing' });
        for (const task of activeTasks) {
          store.dismissTask(task.id);
        }
        // Delete the session record
        store.deleteSession(id);
        // Events auto-emitted by ReactiveTaskStore

        return c.json({ ok: true });
      } catch (err) {
        return c.json({ ok: false, error: err instanceof Error ? err.message : 'Failed to delete session' }, 500);
      }
    });

    // ============ AI Goal Suggestions ============

    // Suggest goal groupings for ungrouped tasks
    this.app.post('/goals/suggest', async (c) => {
      const store = getTaskStore();
      const ungroupedTasks = store.getUnassignedTasks();

      if (ungroupedTasks.length < 2) {
        return c.json({
          suggestions: [],
          message: 'Not enough ungrouped tasks to suggest groupings',
        });
      }

      try {
        // Use the extractor's SDK to get AI suggestions
        const { query } = await import('@anthropic-ai/claude-agent-sdk');

        const taskList = ungroupedTasks
          .map((t, i) => `${i + 1}. [${t.id}] ${t.summary || t.text?.slice(0, 60)}`)
          .join('\n');

        const suggestionQuery = query({
          prompt: `Analyze these tasks and suggest logical groupings into goals. Each goal should represent a coherent project, feature, or theme.

Tasks to group:
${taskList}

Respond with JSON: {
  "suggestions": [
    {
      "goalTitle": "Short descriptive title for the goal",
      "description": "Brief description of what this goal encompasses",
      "taskIds": ["task-id-1", "task-id-2"]
    }
  ]
}

Guidelines:
- Group tasks that are related by feature, component, or theme
- Goal titles should be 3-6 words, imperative voice (e.g., "Implement User Authentication")
- A task can only appear in one goal
- Don't create a goal with only 1 task unless it's clearly standalone
- If tasks don't fit well together, leave them ungrouped (don't include in any suggestion)`,
          options: {
            model: 'haiku',
            permissionMode: 'bypassPermissions',
            maxTurns: 1,
            effort: 'low',
            outputFormat: {
              type: 'json_schema',
              schema: {
                type: 'object' as const,
                properties: {
                  suggestions: {
                    type: 'array' as const,
                    items: {
                      type: 'object' as const,
                      properties: {
                        goalTitle: { type: 'string' as const },
                        description: { type: 'string' as const },
                        taskIds: {
                          type: 'array' as const,
                          items: { type: 'string' as const },
                        },
                      },
                      required: ['goalTitle', 'taskIds'] as const,
                    },
                  },
                },
                required: ['suggestions'] as const,
              },
            },
          },
        });

        let result: { suggestions: Array<{ goalTitle: string; description?: string; taskIds: string[] }> } = { suggestions: [] };

        for await (const event of suggestionQuery) {
          if (event.type === 'result') {
            const resultEvent = event as { structured_output?: unknown };
            if (resultEvent.structured_output) {
              result = resultEvent.structured_output as typeof result;
            }
          }
        }

        // Validate task IDs exist
        const validTaskIds = new Set(ungroupedTasks.map(t => t.id));
        const validatedSuggestions = result.suggestions
          .map(s => ({
            ...s,
            taskIds: s.taskIds.filter(id => validTaskIds.has(id)),
          }))
          .filter(s => s.taskIds.length >= 2);

        return c.json({
          suggestions: validatedSuggestions,
          totalUngrouped: ungroupedTasks.length,
        });
      } catch (error) {
        console.error('[Server] Goal suggestion failed:', error);
        return c.json({
          suggestions: [],
          error: 'Failed to generate suggestions',
        }, 500);
      }
    });

    // Apply a goal suggestion (create goal and move tasks)
    this.app.post('/goals/apply-suggestion', async (c) => {
      const { goalTitle, description, taskIds } = await c.req.json<{
        goalTitle: string;
        description?: string;
        taskIds: string[];
      }>();

      const store = getReactiveTaskStore();

      // Create the goal
      const goal = store.createGoal({
        title: goalTitle,
        description,
        createdVia: 'ai-suggestion',
      });

      // Move tasks to the goal
      for (const taskId of taskIds) {
        store.moveTaskToGoal(taskId, goal.id);
      }
      // Events auto-emitted by ReactiveTaskStore

      return c.json({
        ok: true,
        goal,
        movedCount: taskIds.length,
      });
    });

    // ============ Task Flow Routes ============

    // Create a new task
    this.app.post('/tasks', async (c) => {
      const { message, agent } = await c.req.json<{ message: string; agent?: string }>();
      const taskId = crypto.randomUUID();
      
      // Store task
      this.tasks.set(taskId, {
        id: taskId,
        message,
        agent: agent || null,
        status: 'created',
        createdAt: new Date(),
        plan: null,
        result: null,
      });

      return c.json({ ok: true, taskId });
    });

    // Get task status
    this.app.get('/tasks/:id', (c) => {
      const id = c.req.param('id');
      const task = this.tasks.get(id);
      if (!task) {
        return c.json({ ok: false, error: 'Task not found' }, 404);
      }
      return c.json({ ok: true, task });
    });

    // Plan a task (ask agent to create a plan)
    this.app.post('/tasks/:id/plan', async (c) => {
      const id = c.req.param('id');
      const task = this.tasks.get(id);
      
      if (!task) {
        return c.json({ ok: false, error: 'Task not found' }, 404);
      }

      // Get requested agent from body (if any)
      let requestedAgent: string | undefined;
      try {
        const body = await c.req.json<{ agent?: string }>();
        requestedAgent = body.agent;
      } catch {
        // No body or invalid JSON, use defaults
      }

      // Determine which agent to use
      const claudeAdapter = Array.from(this.adapters.values()).find(a => a.config.kind === 'claude-code');
      const agents = this.getConnectedAgents();
      
      let useClaudeCode = false;
      let agentName: string | undefined;
      
      if (requestedAgent === 'claude-code' || requestedAgent === 'claude-code-local') {
        // User explicitly requested Claude Code (either ID)
        useClaudeCode = claudeAdapter?.implementation.getState().status === 'ready';
        if (!useClaudeCode) {
          return c.json({ ok: false, error: 'Claude Code is not available' }, 400);
        }
        agentName = 'claude-code-local';
      } else if (requestedAgent) {
        // User requested a specific agent - check adapters first, then OpenClaw agents
        const adapter = Array.from(this.adapters.values()).find(a => a.config.id === requestedAgent);
        if (adapter) {
          useClaudeCode = adapter.config.kind === 'claude-code';
          agentName = requestedAgent;
        } else {
          const found = agents.find(a => a.name === requestedAgent);
          if (!found) {
            return c.json({ ok: false, error: `Agent "${requestedAgent}" is not connected` }, 400);
          }
          agentName = requestedAgent;
        }
      } else {
        // No preference - use Claude Code if available, otherwise first OpenClaw agent
        useClaudeCode = claudeAdapter?.implementation.getState().status === 'ready';
        agentName = useClaudeCode ? 'claude-code' : (task.agent || agents[0]?.name);
      }
      
      if (!useClaudeCode && !agentName) {
        return c.json({ ok: false, error: 'No agents available. Connect Claude Code or an OpenClaw instance.' }, 400);
      }

      if (useClaudeCode && claudeAdapter) {
        await this.ensureClaudeAdapterConnected(claudeAdapter);
      }

      task.status = 'planning';
      task.agent = agentName;

      // Ask agent to create a plan (plain text only so the UI can display it cleanly)
      const planPrompt = `Create a step-by-step plan for this task. Be concise.

Task: ${task.message}

Format your response as plain text only:
- One numbered step per line (e.g. "1. First step" then newline "2. Second step").
- Use real line breaks between steps. Do not output JSON, code blocks, or markdown.
- Output only the numbered list, nothing else.`;

      try {
        let result: string;
        
        if (useClaudeCode) {
          // Use Claude Code adapter
          const { turnId } = await claudeAdapter!.implementation.send({ 
            message: planPrompt,
            taskOptions: {
              effort: 'low',
              thinking: { type: 'disabled' },
              maxTurns: 1,
            },
          });
          result = await this.waitForAdapterResult(claudeAdapter!.config.id, turnId);
        } else {
          // Use OpenClaw agent
          result = await this.sendTaskToAgent(agentName!, `plan-${id}`, planPrompt);
        }
        
        const planText = this.normalizePlanText(result);
        task.plan = planText;
        task.status = 'planned';
        return c.json({ ok: true, plan: planText, agent: agentName, source: useClaudeCode ? 'adapter' : 'agent' });
      } catch (error) {
        task.status = 'failed';
        return c.json({ 
          ok: false, 
          error: error instanceof Error ? error.message : 'Planning failed' 
        }, 500);
      }
    });

    // Execute a task
    this.app.post('/tasks/:id/execute', async (c) => {
      const id = c.req.param('id');
      const task = this.tasks.get(id);
      
      if (!task) {
        return c.json({ ok: false, error: 'Task not found' }, 404);
      }

      // Get requested agent from body (if any)
      let requestedAgent: string | undefined;
      try {
        const body = await c.req.json<{ agent?: string }>();
        requestedAgent = body.agent;
      } catch {
        // No body or invalid JSON, use task's assigned agent
      }

      task.status = 'executing';

      // Send the actual task to execute
      const executePrompt = task.plan 
        ? `Execute this task according to the plan:\n\nTask: ${task.message}\n\nPlan:\n${task.plan}`
        : task.message;

      // Determine which agent to use
      const claudeAdapter = Array.from(this.adapters.values()).find(a => a.config.kind === 'claude-code');
      const agents = this.getConnectedAgents();
      
      // Use: 1) requested agent, 2) task's assigned agent, 3) Claude Code if available
      const agentToUse = requestedAgent || task.agent;
      const useClaudeCode = agentToUse === 'claude-code' ||
        (!agentToUse && claudeAdapter?.implementation.getState().status === 'ready');

      if (useClaudeCode && claudeAdapter) {
        await this.ensureClaudeAdapterConnected(claudeAdapter);
      }

      try {
        let result: string;

        if (useClaudeCode && claudeAdapter) {
          // Use Claude Code adapter
          task.agent = 'claude-code';
          const { turnId } = await claudeAdapter.implementation.send({ 
            message: executePrompt,
            taskOptions: {
              effort: 'high',
              thinking: { type: 'adaptive' },
              // No maxTurns limit for execution - let it work through the task
            },
          });
          result = await this.waitForAdapterResult(claudeAdapter.config.id, turnId);
        } else if (agentToUse && agentToUse !== 'claude-code') {
          // Use specified OpenClaw agent
          task.agent = agentToUse;
          result = await this.sendTaskToAgent(agentToUse, `exec-${id}`, executePrompt);
        } else {
          // Fallback to first available OpenClaw agent
          if (agents.length === 0) {
            throw new Error('No agents available');
          }
          task.agent = agents[0].name;
          result = await this.sendTaskToAgent(agents[0].name, `exec-${id}`, executePrompt);
        }
        
        task.result = result;
        task.status = 'completed';
        task.completedAt = new Date();
        return c.json({ ok: true, result });
      } catch (error) {
        task.status = 'failed';
        return c.json({ 
          ok: false, 
          error: error instanceof Error ? error.message : 'Execution failed' 
        }, 500);
      }
    });

    // List recent tasks
    this.app.get('/tasks', (c) => {
      const tasks = Array.from(this.tasks.values())
        .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
        .slice(0, 20);
      return c.json({ tasks });
    });

    // ============ Integration Routes ============

    // CodeRabbit review
    this.app.post('/coderabbit/review', async (c) => {
      const { cwd } = await c.req.json<{ cwd: string }>();
      
      try {
        const { exec } = await import('child_process');
        const { promisify } = await import('util');
        const execAsync = promisify(exec);
        
        const { stdout, stderr } = await execAsync('cr --prompt-only', { cwd });
        return c.json({ ok: true, output: stdout, stderr });
      } catch (error) {
        return c.json({ 
          ok: false, 
          error: error instanceof Error ? error.message : 'Review failed' 
        }, 500);
      }
    });

    // GitHub PR
    this.app.post('/github/pr', async (c) => {
      const { title, body, cwd } = await c.req.json<{ title: string; body: string; cwd: string }>();
      
      try {
        const { exec } = await import('child_process');
        const { promisify } = await import('util');
        const execAsync = promisify(exec);
        
        const { stdout } = await execAsync(
          `gh pr create --title "${title}" --body "${body}"`,
          { cwd }
        );
        return c.json({ ok: true, output: stdout });
      } catch (error) {
        return c.json({ 
          ok: false, 
          error: error instanceof Error ? error.message : 'PR creation failed' 
        }, 500);
      }
    });
  }

  private async createAdapter(config: AdapterConfig): Promise<AdapterImplementation> {
    let implementation: AdapterImplementation;

    switch (config.kind) {
      case 'claude-code':
        implementation = createClaudeCodeAdapter(config);
        break;
      case 'openclaw':
        implementation = createOpenClawAdapter(config);
        break;
      default:
        throw new Error(`Unknown adapter kind: ${config.kind}`);
    }

    const eventEmitter = new AdapterEventEmitter();
    const ctx: AdapterContext = {
      config,
      emitEvent: (event) => {
        const fullEvent: AdapterEvent = {
          ...event,
          adapterId: config.id,
          timestamp: new Date(),
        } as AdapterEvent;
        this.broadcastEvent(fullEvent);
        eventEmitter.emit(fullEvent);
      },
      log: {
        info: (msg, ...args) => {
          const ts = new Date().toISOString();
          console.log(`[${ts}] [${config.id}] ${msg}`, ...args);
        },
        warn: (msg, ...args) => {
          const ts = new Date().toISOString();
          console.warn(`[${ts}] [${config.id}] ${msg}`, ...args);
        },
        error: (msg, ...args) => {
          const ts = new Date().toISOString();
          console.error(`[${ts}] [${config.id}] ${msg}`, ...args);
        },
      },
    };

    await implementation.init(ctx);
    this.adapters.set(config.id, { implementation, config, eventEmitter });

    return implementation;
  }

  private broadcastEvent(event: AdapterEvent): void {
    const message = JSON.stringify({ type: 'event', event });
    for (const client of this.clients) {
      if (client.readyState === WebSocket.OPEN) {
        client.send(message);
      }
    }
  }

  /** Broadcast raw JSON (for thread events that don't match AdapterEvent) */
  private broadcastRaw(data: unknown): void {
    const message = JSON.stringify(data);
    for (const client of this.clients) {
      if (client.readyState === WebSocket.OPEN) {
        client.send(message);
      }
    }
  }

  // ============ Sync Event Helpers ============
  // Delegate to centralized SyncEventEmitter for consistency
  // Also notify QueryManager for reactive query updates

  /** Broadcast tasks.updated event to all clients */
  private broadcastTasksUpdated(): void {
    getSyncEventEmitter().emitTasksUpdated();
    getQueryManager().notifyDataChanged('tasks');
  }

  /** Broadcast goal.created event */
  private broadcastGoalCreated(goal: ReturnType<typeof getTaskStore>['listGoals'] extends () => (infer T)[] ? T : never): void {
    getSyncEventEmitter().emitGoalCreated(goal);
    getQueryManager().notifyDataChanged('goals');
  }

  /** Broadcast goal.updated event */
  private broadcastGoalUpdated(goal: ReturnType<typeof getTaskStore>['listGoals'] extends () => (infer T)[] ? T : never): void {
    getSyncEventEmitter().emitGoalUpdated(goal);
    getQueryManager().notifyDataChanged('goals');
  }

  /** Broadcast goal.archived event */
  private broadcastGoalArchived(goalId: string): void {
    getSyncEventEmitter().emitGoalArchived(goalId);
    getQueryManager().notifyDataChanged('goals');
  }

  /** Broadcast session.dismissed event */
  private broadcastSessionDismissed(sessionId: string): void {
    getSyncEventEmitter().emitSessionDismissed(sessionId);
    getQueryManager().notifyDataChanged('active_sessions');
  }

  /** Broadcast session.deleted event */
  private broadcastSessionDeleted(sessionId: string): void {
    getSyncEventEmitter().emitSessionDeleted(sessionId);
    getQueryManager().notifyDataChanged('active_sessions');
  }

  // ============ Agent Channel Methods ============

  private handleAgentConnection(ws: WebSocket, req: import('http').IncomingMessage): void {
    const agentName = req.headers['x-agent-name'] as string ?? `agent-${Date.now()}`;
    const token = req.headers['authorization']?.replace('Bearer ', '');
    
    console.log(`Agent connecting: ${agentName}`);
    
    // TODO: Validate token
    
    const agent: ConnectedAgent = {
      ws,
      name: agentName,
      capabilities: [],
      connectedAt: new Date(),
      pendingTasks: new Map(),
    };
    
    ws.on('message', (data) => {
      this.handleAgentMessage(agentName, data.toString());
    });
    
    ws.on('close', () => {
      console.log(`Agent disconnected: ${agentName}`);
      this.connectedAgents.delete(agentName);
      this.broadcastEvent({
        type: 'agent.disconnected',
        adapterId: agentName,
        timestamp: new Date(),
        payload: { agentName },
      });
    });
    
    // Don't add to connectedAgents until registered
    // Store temporarily for registration
    (ws as any)._pendingAgent = agent;
  }

  private handleAgentMessage(agentName: string, data: string): void {
    try {
      const msg = JSON.parse(data);
      
      switch (msg.type) {
        case 'register': {
          const ws = this.connectedAgents.get(agentName)?.ws ?? 
            Array.from(this.wss?.clients ?? []).find((c: any) => c._pendingAgent?.name === agentName);
          if (ws) {
            const agent = (ws as any)._pendingAgent as ConnectedAgent;
            agent.capabilities = msg.metadata?.capabilities ?? [];
            this.connectedAgents.set(agentName, agent);
            delete (ws as any)._pendingAgent;
            
            console.log(`Agent registered: ${agentName} with capabilities:`, agent.capabilities);
            
            this.broadcastEvent({
              type: 'agent.connected',
              adapterId: agentName,
              timestamp: new Date(),
              payload: { agentName, capabilities: agent.capabilities },
            });
          }
          break;
        }
        
        case 'task.started': {
          console.log(`Task started on ${agentName}: ${msg.taskId}`);
          this.broadcastEvent({
            type: 'turn.started',
            adapterId: agentName,
            timestamp: new Date(),
            threadId: agentName,
            turnId: msg.taskId,
          });
          break;
        }
        
        case 'content.delta': {
          this.broadcastEvent({
            type: 'content.delta',
            adapterId: agentName,
            timestamp: new Date(),
            threadId: agentName,
            turnId: msg.taskId,
            payload: {
              streamKind: 'assistant_text',
              delta: msg.content,
            },
          });
          break;
        }
        
        case 'task.completed': {
          console.log(`Task completed on ${agentName}: ${msg.taskId}`);
          
          const agent = this.connectedAgents.get(agentName);
          const pending = agent?.pendingTasks.get(msg.taskId);
          if (pending) {
            pending.resolve(msg.content ?? '');
            agent?.pendingTasks.delete(msg.taskId);
          }
          
          this.broadcastEvent({
            type: 'turn.completed',
            adapterId: agentName,
            timestamp: new Date(),
            threadId: agentName,
            turnId: msg.taskId,
            status: msg.status ?? 'completed',
            payload: { result: msg.content },
          });
          break;
        }
        
        case 'task.error': {
          console.error(`Task error on ${agentName}: ${msg.taskId} - ${msg.error}`);
          
          const agent = this.connectedAgents.get(agentName);
          const pending = agent?.pendingTasks.get(msg.taskId);
          if (pending) {
            pending.reject(new Error(msg.error));
            agent?.pendingTasks.delete(msg.taskId);
          }
          
          this.broadcastEvent({
            type: 'turn.completed',
            adapterId: agentName,
            timestamp: new Date(),
            threadId: agentName,
            turnId: msg.taskId,
            status: 'failed',
            reason: msg.error,
          });
          break;
        }
        
        case 'pong':
          // Heartbeat response, ignore
          break;
        
        default:
          console.warn(`Unknown agent message type: ${msg.type}`);
      }
    } catch (error) {
      console.error('Failed to handle agent message:', error);
    }
  }

  /** Send a task to a connected agent */
  async sendTaskToAgent(agentName: string, taskId: string, message: string): Promise<string> {
    const agent = this.connectedAgents.get(agentName);
    if (!agent) {
      throw new Error(`Agent not connected: ${agentName}`);
    }
    
    return new Promise((resolve, reject) => {
      agent.pendingTasks.set(taskId, { resolve, reject });
      
      agent.ws.send(JSON.stringify({
        type: 'task.send',
        taskId,
        message,
      }));
      
      // Timeout after 5 minutes
      setTimeout(() => {
        if (agent.pendingTasks.has(taskId)) {
          agent.pendingTasks.delete(taskId);
          reject(new Error('Task timeout'));
        }
      }, 300000);
    });
  }

  /** If the Claude adapter exists but is disconnected, connect it so plan/execute can use it. */
  private async ensureClaudeAdapterConnected(managed: ManagedAdapter | undefined): Promise<void> {
    if (!managed || managed.config.kind !== 'claude-code') return;
    const state = managed.implementation.getState();
    if (state.status === 'disconnected') {
      await managed.implementation.connect();
    }
  }

  /** Wait for adapter to complete a turn */
  async waitForAdapterResult(adapterId: string, turnId: string): Promise<string> {
    const managed = this.adapters.get(adapterId);
    if (!managed) {
      throw new Error(`Adapter not found: ${adapterId}`);
    }
    
    // For now, poll the adapter state or wait for event
    // TODO: Use proper event subscription
    return new Promise((resolve, reject) => {
      let output = '';
      let completed = false;
      
      const checkCompletion = () => {
        const state = managed.implementation.getState();
        if (state.status === 'ready' && state.activeThreadId !== turnId) {
          // Turn completed
          completed = true;
          resolve(output || 'Task completed');
        }
      };
      
      // Subscribe to events (adapter emits via ctx.emitEvent -> eventEmitter)
      const unsubscribe = managed.eventEmitter.on('*', (event: any) => {
        if (event.type === 'content.delta' && event.turnId === turnId) {
          output += event.payload?.delta ?? event.payload?.content ?? '';
        }
        if (event.type === 'turn.completed' && event.turnId === turnId) {
          completed = true;
          unsubscribe();
          resolve(output || event.payload?.content || event.payload?.delta || 'Task completed');
        }
        if (event.type === 'turn.error' && event.turnId === turnId) {
          completed = true;
          unsubscribe();
          reject(new Error(event.payload?.error || 'Task failed'));
        }
      });
      
      // Timeout after 5 minutes
      setTimeout(() => {
        if (!completed) {
          unsubscribe();
          reject(new Error('Adapter timeout'));
        }
      }, 300000);
    });
  }

  /**
   * Normalize plan text for UI: extract from JSON (e.g. payloads[0].text) if needed,
   * so the client always receives plain text with real newlines.
   */
  private normalizePlanText(raw: string): string {
    const trimmed = raw?.trim();
    if (!trimmed) return trimmed || '';
    try {
      const parsed = JSON.parse(trimmed) as unknown;
      if (parsed && typeof parsed === 'object' && 'payloads' in parsed) {
        const payloads = (parsed as { payloads?: Array<{ text?: string }> }).payloads;
        if (Array.isArray(payloads) && payloads.length > 0 && typeof payloads[0]?.text === 'string') {
          return payloads[0].text.replace(/\\n/g, '\n').trim();
        }
      }
      if (parsed && typeof parsed === 'object' && 'text' in parsed && typeof (parsed as { text: string }).text === 'string') {
        return (parsed as { text: string }).text.replace(/\\n/g, '\n').trim();
      }
    } catch {
      // Not JSON, use as-is but normalize escaped newlines
    }
    return trimmed.replace(/\\n/g, '\n');
  }

  /** List connected agents */
  getConnectedAgents(): Array<{ name: string; capabilities: string[]; connectedAt: Date }> {
    return Array.from(this.connectedAgents.values()).map(a => ({
      name: a.name,
      capabilities: a.capabilities,
      connectedAt: a.connectedAt,
    }));
  }

  private handleUIMessage(ws: WebSocket, data: string): void {
    try {
      const msg = JSON.parse(data);

      // Get or create client ID for this WebSocket
      let clientId = this.clientIds.get(ws);
      if (!clientId) {
        clientId = `client-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        this.clientIds.set(ws, clientId);
      }

      switch (msg.type) {
        case 'subscribe': {
          // Subscribe to a query
          const { queryName, params } = msg;
          if (!queryName) {
            console.warn('[Server] Subscribe request missing queryName');
            return;
          }
          const subscriptionId = getQueryManager().subscribe(clientId, queryName, params || {});
          // Send back the subscription ID so client can track it
          if (subscriptionId && ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({
              type: 'subscribed',
              queryName,
              subscriptionId,
            }));
          }
          break;
        }

        case 'unsubscribe': {
          // Unsubscribe from a specific subscription
          const { subscriptionId } = msg;
          if (subscriptionId) {
            getQueryManager().unsubscribe(clientId, subscriptionId);
          }
          break;
        }

        case 'ping': {
          // Heartbeat response
          if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: 'pong' }));
          }
          break;
        }

        default:
          // Unknown message type - log for debugging
          console.log('[Server] UI message:', msg);
      }
    } catch (error) {
      console.error('Failed to handle UI message:', error);
    }
  }

  async start(): Promise<void> {
    // Ensure database schema is up to date before anything else
    // This runs migrations and verifies all columns exist
    const taskStore = getTaskStore();
    taskStore.ensureLatestSchema();

    // Initialize the centralized sync event emitter
    // This wraps broadcastRaw to provide typed event emission
    initSyncEventEmitter((event) => {
      this.broadcastRaw({
        type: 'event',
        event,
      });
    }, { taskLimit: 100 });

    // Initialize query subscription manager
    // This enables Convex-style reactive queries
    initQueryManager((clientId, data) => {
      // Find the WebSocket for this client and send the data
      for (const [ws, id] of this.clientIds) {
        if (id === clientId && ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify(data));
          break;
        }
      }
    });

    // Initialize session manager
    const sessionManager = getSessionManager();
    await sessionManager.init();

    // Forward session manager events to WebSocket clients
    sessionManager.on('message', (threadId, message) => {
      this.broadcastRaw({
        type: 'event',
        event: {
          type: 'session.message',
          threadId,
          payload: message,
          timestamp: new Date().toISOString(),
        },
      });
    });

    sessionManager.on('turn.started', (threadId, turnId) => {
      this.broadcastRaw({
        type: 'event',
        event: {
          type: 'turn.started',
          threadId,
          turnId,
          timestamp: new Date().toISOString(),
        },
      });
    });

    sessionManager.on('turn.completed', (threadId, turnId, result, usage) => {
      this.broadcastRaw({
        type: 'event',
        event: {
          type: 'turn.completed',
          threadId,
          turnId,
          status: 'completed',
          payload: { result, usage },
          timestamp: new Date().toISOString(),
        },
      });
    });

    sessionManager.on('turn.error', (threadId, turnId, error) => {
      this.broadcastRaw({
        type: 'event',
        event: {
          type: 'turn.completed',
          threadId,
          turnId,
          status: 'failed',
          reason: error.message,
          timestamp: new Date().toISOString(),
        },
      });
    });

    sessionManager.on('tasks.updated', (tasks: ExtractedTask[]) => {
      this.broadcastRaw({
        type: 'event',
        event: {
          type: 'tasks.updated',
          payload: tasks,
          timestamp: new Date().toISOString(),
        },
      });
      // Notify query subscribers about task changes
      getQueryManager().notifyDataChanged('tasks');
    });

    // Forward prompt lifecycle events for Active Sessions tab (Tier 1)
    sessionManager.on('prompt.started', (data) => {
      this.broadcastRaw({
        type: 'event',
        event: {
          type: 'prompt.started',
          payload: data,
          timestamp: new Date().toISOString(),
        },
      });
      // Notify query subscribers about session changes
      getQueryManager().notifyDataChanged('active_sessions');
    });

    sessionManager.on('prompt.completed', (data) => {
      this.broadcastRaw({
        type: 'event',
        event: {
          type: 'prompt.completed',
          payload: data,
          timestamp: new Date().toISOString(),
        },
      });
      // Notify query subscribers about session changes
      getQueryManager().notifyDataChanged('active_sessions');
    });

    sessionManager.on('prompt.summary_updated', (data) => {
      this.broadcastRaw({
        type: 'event',
        event: {
          type: 'prompt.summary_updated',
          payload: data,
          timestamp: new Date().toISOString(),
        },
      });
      // Notify query subscribers about session changes
      getQueryManager().notifyDataChanged('active_sessions');
    });

    return new Promise<void>((resolve, reject) => {
      // Create HTTP server with Hono handler
      this.httpServer = createServer(async (req, res) => {
        const url = new URL(req.url ?? '/', `http://localhost:${this._port}`);
        
        // Read body for POST requests
        let body: string | undefined;
        if (req.method === 'POST' || req.method === 'PUT' || req.method === 'PATCH') {
          body = await new Promise<string>((resolve) => {
            let data = '';
            req.on('data', chunk => data += chunk);
            req.on('end', () => resolve(data));
          });
        }
        
        const request = new Request(url.toString(), {
          method: req.method,
          headers: req.headers as HeadersInit,
          body: body,
        });
        
        try {
          const response = await this.app.fetch(request);
          res.statusCode = response.status;
          response.headers.forEach((value: string, key: string) => {
            res.setHeader(key, value);
          });
          const responseBody = await response.text();
          res.end(responseBody);
        } catch (err: unknown) {
          res.statusCode = 500;
          res.end(err instanceof Error ? err.message : 'Internal error');
        }
      });
      
      // Setup WebSocket server on same http server
      this.wss = new WebSocketServer({ server: this.httpServer });
      
      // Handle WSS errors (prevents crash on EADDRINUSE during port retry)
      this.wss.on('error', (err: NodeJS.ErrnoException) => {
        // EADDRINUSE is handled by the port retry loop - ignore here
        if (err.code !== 'EADDRINUSE') {
          console.error('[WSS] Error:', err.message);
        }
      });
      
      this.wss.on('connection', (ws, req) => {
        const url = new URL(req.url ?? '/', `http://localhost:${this._port}`);
        const isChannel = url.pathname === '/channel';
        
        if (isChannel) {
          // Agent channel connection
          this.handleAgentConnection(ws, req);
        } else {
          // UI client connection
          const clientId = `client-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
          this.clientIds.set(ws, clientId);
          console.log(`UI client connected: ${clientId}`);
          this.clients.add(ws);

          ws.on('close', () => {
            console.log(`UI client disconnected: ${clientId}`);
            this.clients.delete(ws);
            // Clean up all query subscriptions for this client
            const storedClientId = this.clientIds.get(ws);
            if (storedClientId) {
              getQueryManager().unsubscribeAll(storedClientId);
              this.clientIds.delete(ws);
            }
          });
          
          ws.on('message', (data) => {
            this.handleUIMessage(ws, data.toString());
          });
        }
      });
      
      // Try to bind to requested port; on EADDRINUSE try next port (dynamic port)
      const startPort = this._port;
      const maxAttempts = 100;
      const tryListen = (port: number): Promise<void> =>
        new Promise((resolve, reject) => {
          const onError = (err: NodeJS.ErrnoException) => {
            this.httpServer!.removeListener('listening', onListen);
            reject(err);
          };
          const onListen = () => {
            this.httpServer!.removeListener('error', onError);
            const addr = this.httpServer!.address();
            this._port = typeof addr === 'object' && addr !== null && 'port' in addr ? addr.port : port;
            resolve();
          };
          this.httpServer!.once('error', onError);
          this.httpServer!.once('listening', onListen);
          this.httpServer!.listen(port);
        });

      (async () => {
        let lastErr: NodeJS.ErrnoException | undefined;
        for (let p = startPort; p < startPort + maxAttempts; p++) {
          try {
            await tryListen(p);
            console.log(`Command Center server running on http://localhost:${this._port}`);
            // Optionally write port to file for dev tooling (e.g. ACC_PORT_FILE)
            const portFile = process.env.ACC_PORT_FILE;
            if (portFile) {
              try {
                const fs = await import('fs');
                const path = await import('path');
                const dir = path.dirname(portFile);
                if (dir !== '.') fs.mkdirSync(dir, { recursive: true });
                fs.writeFileSync(portFile, String(this._port), 'utf8');
              } catch {
                // Ignore port file write errors
              }
            }
            resolve();
            return;
          } catch (err) {
            lastErr = err as NodeJS.ErrnoException;
            if (lastErr?.code !== 'EADDRINUSE') {
              reject(lastErr);
              return;
            }
            console.warn(`Port ${p} in use, trying ${p + 1}...`);
          }
        }
        reject(lastErr ?? new Error('No available port'));
      })();
    });
  }

  async stop(): Promise<void> {
    // Shutdown session manager
    const sessionManager = getSessionManager();
    await sessionManager.shutdown();

    // Cleanup adapters
    for (const [, managed] of this.adapters) {
      await managed.implementation.destroy();
    }
    this.adapters.clear();

    // Close WebSocket connections
    for (const client of this.clients) {
      client.close();
    }
    this.clients.clear();

    // Close servers
    this.wss?.close();
    this.httpServer?.close();
  }
}

// CLI entry point
if (import.meta.url === `file://${process.argv[1]}`) {
  const server = new CommandCenterServer();
  server.start().catch(console.error);
  
  process.on('SIGINT', async () => {
    await server.stop();
    process.exit(0);
  });
}
