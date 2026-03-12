#!/usr/bin/env node
/**
 * Connect to the Command Center WebSocket and print adapter output.
 * Run this, then in another terminal POST to /adapters/:id/send to see the result.
 *
 *   bun run scripts/watch-output.mjs
 *   # or: node scripts/watch-output.mjs
 */
import WebSocket from 'ws';

const url = process.env.WS_URL || 'ws://localhost:3333';
const ws = new WebSocket(url);

ws.on('open', () => {
  console.log('Connected to', url, '- send a message to an adapter to see output.\n');
});

ws.on('message', (raw) => {
  try {
    const msg = JSON.parse(raw.toString());
    if (msg.type !== 'event' || !msg.event) return;
    const { type, payload } = msg.event;
    if (type === 'content.delta' && payload?.delta) {
      process.stdout.write(payload.delta);
    } else if (type === 'turn.completed') {
      console.log('\n--- turn.completed:', payload?.status ?? msg.event.status, '---');
    }
  } catch {
    console.log(raw.toString());
  }
});

ws.on('close', () => {
  console.log('\nDisconnected.');
  process.exit(0);
});

ws.on('error', (err) => {
  console.error('WebSocket error:', err.message);
  process.exit(1);
});
