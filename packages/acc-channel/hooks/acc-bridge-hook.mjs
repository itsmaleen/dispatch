#!/usr/bin/env node
/**
 * ACC Bridge Hook for OpenClaw
 * 
 * Place in ~/.openclaw/hooks/acc-bridge.mjs
 * Configure in openclaw.json under hooks.scripts
 * 
 * This hook maintains a persistent WebSocket connection to the ACC server
 * and executes tasks using OpenClaw's internal session spawning.
 */

import WebSocket from 'ws';
import { spawn } from 'child_process';
import { writeFileSync, readFileSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';

// Configuration - set via environment or config file
const CONFIG = {
  accUrl: process.env.ACC_URL || process.env.ACC_SERVER_URL || 'ws://localhost:3333/channel',
  agentName: process.env.ACC_AGENT_NAME || process.env.AGENT_NAME || 'openclaw-agent',
  token: process.env.ACC_TOKEN || 'dev-token',
  model: process.env.ACC_MODEL || 'anthropic/claude-sonnet-4-20250514',
  reconnectInterval: 5000,
  taskTimeout: 300000, // 5 minutes
};

// State
let ws = null;
let reconnectTimer = null;
const activeTasks = new Map();

// Logging
const log = {
  info: (...args) => console.log(`[acc-bridge]`, ...args),
  error: (...args) => console.error(`[acc-bridge]`, ...args),
  debug: (...args) => process.env.DEBUG && console.log(`[acc-bridge:debug]`, ...args),
};

/**
 * Connect to ACC server
 */
function connect() {
  log.info(`Connecting to ACC server: ${CONFIG.accUrl}`);
  
  ws = new WebSocket(CONFIG.accUrl, {
    headers: {
      'Authorization': `Bearer ${CONFIG.token}`,
      'X-Agent-Name': CONFIG.agentName,
    },
  });

  ws.on('open', () => {
    log.info('Connected to ACC server');
    register();
  });

  ws.on('message', (data) => {
    handleMessage(data.toString());
  });

  ws.on('close', (code, reason) => {
    log.info(`Disconnected from ACC (code: ${code})`);
    scheduleReconnect();
  });

  ws.on('error', (error) => {
    log.error('WebSocket error:', error.message);
  });
}

/**
 * Send message to ACC
 */
function send(msg) {
  if (ws?.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(msg));
  }
}

/**
 * Register with ACC server
 */
function register() {
  send({
    type: 'register',
    metadata: {
      agentName: CONFIG.agentName,
      capabilities: ['streaming', 'spawn', 'tools'],
      model: CONFIG.model,
      version: '1.0.0',
    },
  });
  log.info(`Registered as: ${CONFIG.agentName}`);
}

/**
 * Handle incoming messages
 */
async function handleMessage(data) {
  try {
    const msg = JSON.parse(data);
    log.debug('Received:', msg.type, msg.taskId || '');

    switch (msg.type) {
      case 'task.send':
        await handleTaskSend(msg);
        break;
      case 'task.cancel':
        handleTaskCancel(msg);
        break;
      case 'ping':
        send({ type: 'pong' });
        break;
      default:
        log.debug('Unknown message type:', msg.type);
    }
  } catch (error) {
    log.error('Failed to handle message:', error);
  }
}

/**
 * Execute a task using OpenClaw CLI
 */
async function handleTaskSend(msg) {
  const { taskId, message } = msg;
  
  if (!taskId || !message) {
    send({ type: 'task.error', taskId: taskId || 'unknown', error: 'Missing taskId or message' });
    return;
  }

  log.info(`Task received: ${taskId}`);
  log.info(`  Message: ${message.slice(0, 100)}${message.length > 100 ? '...' : ''}`);

  // Track task
  const startedAt = Date.now();
  activeTasks.set(taskId, { startedAt, message });

  // Send started acknowledgment
  send({
    type: 'task.started',
    taskId,
    metadata: { startedAt: new Date(startedAt).toISOString() },
  });

  try {
    // Execute using OpenClaw CLI in print mode
    const result = await executeWithCLI(message, taskId);
    
    const durationMs = Date.now() - startedAt;
    log.info(`Task completed: ${taskId} (${durationMs}ms)`);

    send({
      type: 'task.completed',
      taskId,
      content: result,
      status: 'completed',
      metadata: { durationMs },
    });

  } catch (error) {
    const durationMs = Date.now() - startedAt;
    log.error(`Task failed: ${taskId}`, error.message);

    send({
      type: 'task.error',
      taskId,
      error: error.message,
      status: 'failed',
      metadata: { durationMs },
    });
  } finally {
    activeTasks.delete(taskId);
  }
}

/**
 * Execute task using OpenClaw CLI
 */
function executeWithCLI(message, taskId) {
  return new Promise((resolve, reject) => {
    const args = [
      'agent',
      '--local',
      '--json',
      '--message', message,
    ];

    log.debug(`Executing: openclaw agent --local --json --message "..."`);

    const proc = spawn('openclaw', args, {
      cwd: process.env.HOME,
      env: { ...process.env, FORCE_COLOR: '0' },
      timeout: CONFIG.taskTimeout,
    });

    let stdout = '';
    let stderr = '';

    proc.stdout.on('data', (data) => {
      const chunk = data.toString();
      stdout += chunk;
      
      // Stream content deltas
      send({
        type: 'content.delta',
        taskId,
        content: chunk,
      });
    });

    proc.stderr.on('data', (data) => {
      stderr += data.toString();
    });

    proc.on('close', (code) => {
      if (code === 0) {
        // Try to parse JSON output
        try {
          const result = JSON.parse(stdout);
          resolve(result.reply || result.content || result.message || stdout.trim());
        } catch {
          resolve(stdout.trim() || 'Task completed');
        }
      } else {
        reject(new Error(stderr || `Process exited with code ${code}`));
      }
    });

    proc.on('error', (error) => {
      reject(error);
    });

    // Timeout handling
    setTimeout(() => {
      if (activeTasks.has(taskId)) {
        proc.kill('SIGTERM');
        reject(new Error('Task timeout'));
      }
    }, CONFIG.taskTimeout);
  });
}

/**
 * Cancel a running task
 */
function handleTaskCancel(msg) {
  const { taskId } = msg;
  if (activeTasks.has(taskId)) {
    log.info(`Cancelling task: ${taskId}`);
    // Task will be cleaned up by the process handler
    activeTasks.delete(taskId);
    send({ type: 'task.cancelled', taskId });
  }
}

/**
 * Schedule reconnection
 */
function scheduleReconnect() {
  if (reconnectTimer) return;
  
  log.info(`Reconnecting in ${CONFIG.reconnectInterval}ms...`);
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    connect();
  }, CONFIG.reconnectInterval);
}

/**
 * Graceful shutdown
 */
function shutdown() {
  log.info('Shutting down ACC bridge...');
  if (reconnectTimer) clearTimeout(reconnectTimer);
  if (ws) ws.close();
  process.exit(0);
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

// Start
log.info('ACC Bridge Hook starting...');
log.info(`  Agent: ${CONFIG.agentName}`);
log.info(`  ACC URL: ${CONFIG.accUrl}`);
log.info(`  Model: ${CONFIG.model}`);
connect();
