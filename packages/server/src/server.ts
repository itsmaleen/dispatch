/**
 * Command Center Server
 * 
 * HTTP + WebSocket server for the Electron app.
 * Manages adapters, streams events, handles integrations.
 */

import { createServer, type Server } from 'http';
import { Hono } from 'hono';
import { serve } from '@hono/node-server';
import { WebSocketServer, WebSocket } from 'ws';
import type { AdapterConfig, AdapterEvent } from '@acc/contracts';
import type { AdapterImplementation, AdapterContext } from './adapters/types';
import { createClaudeCodeAdapter } from './adapters/claude-code';
import { createOpenClawAdapter } from './adapters/openclaw';

interface ManagedAdapter {
  implementation: AdapterImplementation;
  config: AdapterConfig;
}

export class CommandCenterServer {
  private app: Hono;
  private httpServer: Server | null = null;
  private wss: WebSocketServer | null = null;
  private adapters = new Map<string, ManagedAdapter>();
  private clients = new Set<WebSocket>();
  private port: number;

  constructor(port = 3333) {
    this.port = port;
    this.app = new Hono();
    this.setupRoutes();
  }

  private setupRoutes(): void {
    // Health check
    this.app.get('/health', (c) => c.json({ ok: true }));

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

    const ctx: AdapterContext = {
      config,
      emitEvent: (event) => {
        const fullEvent: AdapterEvent = {
          ...event,
          adapterId: config.id,
          timestamp: new Date(),
        } as AdapterEvent;
        this.broadcastEvent(fullEvent);
      },
      log: {
        info: (msg, ...args) => console.log(`[${config.id}] ${msg}`, ...args),
        warn: (msg, ...args) => console.warn(`[${config.id}] ${msg}`, ...args),
        error: (msg, ...args) => console.error(`[${config.id}] ${msg}`, ...args),
      },
    };

    await implementation.init(ctx);
    this.adapters.set(config.id, { implementation, config });

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
      
      this.wss.on('connection', (ws) => {
        console.log('Client connected');
        this.clients.add(ws);
        
        ws.on('close', () => {
          console.log('Client disconnected');
          this.clients.delete(ws);
        });
        
        ws.on('message', (data) => {
          console.log('Received:', data.toString());
        });
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
