#!/usr/bin/env node
/**
 * Simple ACC Bridge - Test script for connecting to ACC server
 * 
 * Usage: ACC_URL=ws://localhost:3333/channel AGENT_NAME=molty node simple-bridge.mjs
 */

import WebSocket from 'ws';
import { writeFileSync, existsSync, readFileSync, unlinkSync } from 'fs';
import { join } from 'path';

const ACC_URL = process.env.ACC_URL ?? 'ws://localhost:3333/channel';
const AGENT_NAME = process.env.AGENT_NAME ?? 'test-agent';
const TASK_DIR = process.env.TASK_DIR ?? '/tmp/acc-tasks';

console.log(`Starting ACC Bridge...`);
console.log(`  ACC URL: ${ACC_URL}`);
console.log(`  Agent: ${AGENT_NAME}`);
console.log(`  Task Dir: ${TASK_DIR}`);

let ws;

function connect() {
  ws = new WebSocket(ACC_URL, {
    headers: {
      'Authorization': 'Bearer dev-token',
      'X-Agent-Name': AGENT_NAME,
    },
  });

  ws.on('open', () => {
    console.log('✅ Connected to ACC server');
    // Register
    ws.send(JSON.stringify({
      type: 'register',
      metadata: {
        agentName: AGENT_NAME,
        capabilities: ['spawn'],
        version: '0.1.0',
      },
    }));
  });

  ws.on('message', (data) => {
    const msg = JSON.parse(data.toString());
    console.log('📨 Received:', msg.type, msg.taskId ?? '');
    
    if (msg.type === 'task.send') {
      handleTask(msg);
    } else if (msg.type === 'ping') {
      ws.send(JSON.stringify({ type: 'pong' }));
    }
  });

  ws.on('close', () => {
    console.log('❌ Disconnected, reconnecting in 5s...');
    setTimeout(connect, 5000);
  });

  ws.on('error', (err) => {
    console.error('WebSocket error:', err.message);
  });
}

async function handleTask(msg) {
  const { taskId, message } = msg;
  console.log(`\n📥 Task ${taskId}:`);
  console.log(`   ${message.slice(0, 200)}...`);
  
  // Write task to file for external processing
  const taskFile = join(TASK_DIR, `${taskId}.json`);
  const resultFile = join(TASK_DIR, `${taskId}.result.json`);
  
  try {
    writeFileSync(taskFile, JSON.stringify({ taskId, message, receivedAt: new Date().toISOString() }));
    console.log(`   Written to: ${taskFile}`);
    
    // Send started
    ws.send(JSON.stringify({ type: 'task.started', taskId }));
    
    // Poll for result file
    const startTime = Date.now();
    const timeout = 120000; // 2 min
    
    while (Date.now() - startTime < timeout) {
      await new Promise(r => setTimeout(r, 1000));
      
      if (existsSync(resultFile)) {
        const result = JSON.parse(readFileSync(resultFile, 'utf-8'));
        console.log(`   ✅ Got result for ${taskId}`);
        
        ws.send(JSON.stringify({
          type: 'task.completed',
          taskId,
          content: result.content ?? result.result ?? 'Done',
          status: result.status ?? 'completed',
        }));
        
        // Cleanup
        unlinkSync(taskFile);
        unlinkSync(resultFile);
        return;
      }
    }
    
    throw new Error('Task timeout');
    
  } catch (error) {
    console.error(`   ❌ Task failed:`, error.message);
    ws.send(JSON.stringify({
      type: 'task.error',
      taskId,
      error: error.message,
    }));
  }
}

// Ensure task dir exists
import { mkdirSync } from 'fs';
try { mkdirSync(TASK_DIR, { recursive: true }); } catch {}

connect();

process.on('SIGINT', () => {
  console.log('\nShutting down...');
  ws?.close();
  process.exit(0);
});
