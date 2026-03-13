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
  private connectedAgents = new Map<string, ConnectedAgent>();
  private tasks = new Map<string, Task>();
  private port: number;

  constructor(port = 3333) {
    this.port = port;
    this.app = new Hono();
    this.setupRoutes();
  }

  private setupRoutes(): void {
    // Allow UI (Vite dev or Electron) to call API
    this.app.use('*', cors({ origin: '*', allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'], allowHeaders: ['Content-Type', 'Authorization'] }));

    // Health check
    this.app.get('/health', (c) => c.json({ ok: true }));

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

        // Create adapter with autoAccept to avoid hanging on permission prompts
        const config = {
          id: 'claude-code-local',
          kind: 'claude-code' as const,
          name: 'Claude Code (Local)',
          options: {
            autoAccept: true,  // Use --dangerously-skip-permissions to avoid stdin hangs
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

    // Send to adapter
    this.app.post('/adapters/:id/send', async (c) => {
      const id = c.req.param('id');
      const managed = this.adapters.get(id);
      
      if (!managed) {
        return c.json({ ok: false, error: 'Adapter not found' }, 404);
      }

      const options = await c.req.json();
      
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
      
      if (requestedAgent === 'claude-code') {
        // User explicitly requested Claude Code
        useClaudeCode = claudeAdapter?.implementation.getState().status === 'ready';
        if (!useClaudeCode) {
          return c.json({ ok: false, error: 'Claude Code is not available' }, 400);
        }
        agentName = 'claude-code';
      } else if (requestedAgent) {
        // User requested a specific OpenClaw agent
        const found = agents.find(a => a.name === requestedAgent);
        if (!found) {
          return c.json({ ok: false, error: `Agent "${requestedAgent}" is not connected` }, 400);
        }
        agentName = requestedAgent;
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
          const { turnId } = await claudeAdapter!.implementation.send({ message: planPrompt });
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
          const { turnId } = await claudeAdapter.implementation.send({ message: executePrompt });
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
      console.log('UI message:', msg);
      // Handle UI commands if needed
    } catch (error) {
      console.error('Failed to handle UI message:', error);
    }
  }

  async start(): Promise<void> {
    return new Promise((resolve) => {
      // Create HTTP server with Hono handler
      this.httpServer = createServer(async (req, res) => {
        const url = new URL(req.url ?? '/', `http://localhost:${this.port}`);
        
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
      
      this.wss.on('connection', (ws, req) => {
        const url = new URL(req.url ?? '/', `http://localhost:${this.port}`);
        const isChannel = url.pathname === '/channel';
        
        if (isChannel) {
          // Agent channel connection
          this.handleAgentConnection(ws, req);
        } else {
          // UI client connection
          console.log('UI client connected');
          this.clients.add(ws);
          
          ws.on('close', () => {
            console.log('UI client disconnected');
            this.clients.delete(ws);
          });
          
          ws.on('message', (data) => {
            this.handleUIMessage(ws, data.toString());
          });
        }
      });
      
      this.httpServer.listen(this.port, () => {
        console.log(`Command Center server running on http://localhost:${this.port}`);
        resolve();
      });
    });
  }

  async stop(): Promise<void> {
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
