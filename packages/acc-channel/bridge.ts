#!/usr/bin/env npx tsx
/**
 * ACC Bridge - Connects a local OpenClaw instance to ACC server
 * 
 * Run this alongside OpenClaw to enable ACC orchestration.
 * Usage: npx tsx bridge.ts --acc-url ws://localhost:3333 --agent-name molty
 */

import WebSocket from 'ws';

const ACC_URL = process.env.ACC_URL ?? 'ws://localhost:3333/channel';
const AGENT_NAME = process.env.AGENT_NAME ?? 'molty';
const ACC_TOKEN = process.env.ACC_TOKEN ?? 'dev-token';

// OpenClaw gateway config (for spawning sessions)
const OPENCLAW_URL = process.env.OPENCLAW_URL ?? 'http://localhost:18789';
const OPENCLAW_TOKEN = process.env.OPENCLAW_TOKEN ?? '';

interface TaskMessage {
  type: string;
  taskId: string;
  message?: string;
}

class ACCBridge {
  private ws: WebSocket | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;

  async connect(): Promise<void> {
    console.log(`Connecting to ACC server at ${ACC_URL}...`);

    return new Promise((resolve, reject) => {
      this.ws = new WebSocket(ACC_URL, {
        headers: {
          'Authorization': `Bearer ${ACC_TOKEN}`,
          'X-Agent-Name': AGENT_NAME,
        },
      });

      this.ws.on('open', () => {
        console.log('Connected to ACC server');
        this.register();
        resolve();
      });

      this.ws.on('message', (data) => {
        this.handleMessage(data.toString());
      });

      this.ws.on('close', () => {
        console.log('Disconnected from ACC server');
        this.scheduleReconnect();
      });

      this.ws.on('error', (error) => {
        console.error('WebSocket error:', error.message);
        reject(error);
      });
    });
  }

  private send(msg: Record<string, unknown>): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(msg));
    }
  }

  private register(): void {
    this.send({
      type: 'register',
      metadata: {
        agentName: AGENT_NAME,
        capabilities: ['streaming', 'spawn'],
        version: '0.1.0',
      },
    });
    console.log(`Registered as ${AGENT_NAME}`);
  }

  private async handleMessage(data: string): Promise<void> {
    try {
      const msg = JSON.parse(data) as TaskMessage;

      switch (msg.type) {
        case 'task.send':
          await this.handleTask(msg);
          break;
        case 'ping':
          this.send({ type: 'pong' });
          break;
        default:
          console.log('Unknown message:', msg.type);
      }
    } catch (error) {
      console.error('Failed to handle message:', error);
    }
  }

  private async handleTask(msg: TaskMessage): Promise<void> {
    const { taskId, message } = msg;
    if (!taskId || !message) {
      this.send({ type: 'task.error', taskId, error: 'Missing taskId or message' });
      return;
    }

    console.log(`\n📥 Task ${taskId}: ${message.slice(0, 100)}...`);

    // Send started acknowledgment
    this.send({ type: 'task.started', taskId, metadata: { startedAt: new Date().toISOString() } });

    try {
      // Use OpenClaw's cron API to spawn an isolated session
      const result = await this.spawnTask(taskId, message);
      
      // Send result
      this.send({
        type: 'task.completed',
        taskId,
        content: result,
        status: 'completed',
      });
      
      console.log(`✅ Task ${taskId} completed`);
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : 'Unknown error';
      console.error(`❌ Task ${taskId} failed:`, errorMsg);
      this.send({
        type: 'task.error',
        taskId,
        error: errorMsg,
        status: 'failed',
      });
    }
  }

  private async spawnTask(taskId: string, message: string): Promise<string> {
    // Create a one-shot cron job that runs immediately
    const cronJob = {
      name: `acc-${taskId.slice(0, 8)}`,
      schedule: { kind: 'at', at: new Date().toISOString() },
      sessionTarget: 'isolated',
      payload: {
        kind: 'agentTurn',
        message,
        model: 'groq/llama-3.3-70b-versatile', // Fast model for testing
        thinking: 'low',
        timeoutSeconds: 120,
      },
      delivery: {
        mode: 'none', // We'll poll for result
      },
    };

    // Add the cron job
    const addResponse = await fetch(`${OPENCLAW_URL}/api/cron`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${OPENCLAW_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ action: 'add', job: cronJob }),
    });

    if (!addResponse.ok) {
      throw new Error(`Failed to create cron job: ${await addResponse.text()}`);
    }

    const { jobId } = await addResponse.json() as { jobId: string };
    console.log(`  Created cron job: ${jobId}`);

    // Poll for completion (simplified - in production use webhooks)
    const startTime = Date.now();
    const timeout = 120000; // 2 minutes
    
    while (Date.now() - startTime < timeout) {
      await new Promise(r => setTimeout(r, 2000)); // Poll every 2s
      
      // Check job runs
      const runsResponse = await fetch(`${OPENCLAW_URL}/api/cron?action=runs&jobId=${jobId}`, {
        headers: { 'Authorization': `Bearer ${OPENCLAW_TOKEN}` },
      });
      
      if (runsResponse.ok) {
        const { runs } = await runsResponse.json() as { runs: Array<{ status: string; result?: string }> };
        const lastRun = runs?.[0];
        
        if (lastRun?.status === 'completed') {
          return lastRun.result ?? 'Task completed (no output captured)';
        } else if (lastRun?.status === 'failed') {
          throw new Error(lastRun.result ?? 'Task failed');
        }
      }
    }

    throw new Error('Task timeout');
  }

  private scheduleReconnect(): void {
    console.log('Reconnecting in 5s...');
    this.reconnectTimer = setTimeout(() => {
      this.connect().catch(console.error);
    }, 5000);
  }
}

// Main
const bridge = new ACCBridge();
bridge.connect().catch((error) => {
  console.error('Failed to connect:', error);
  process.exit(1);
});

console.log(`
╔═══════════════════════════════════════════╗
║       ACC Bridge for OpenClaw             ║
╠═══════════════════════════════════════════╣
║  Agent: ${AGENT_NAME.padEnd(33)}║
║  ACC:   ${ACC_URL.slice(0, 33).padEnd(33)}║
╚═══════════════════════════════════════════╝
`);

process.on('SIGINT', () => {
  console.log('\nShutting down...');
  process.exit(0);
});
