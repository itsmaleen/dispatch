#!/usr/bin/env node
/**
 * Dev script: build electron main/preload and run Electron with Vite dev server.
 * 
 * T3 Code Pattern:
 * - Server is pre-built to JS (by turbo running @acc/server dev with tsup --watch)
 * - Electron main process spawns the built server as a child process
 * - This script waits for Vite AND server build, then starts Electron
 * 
 * Run from packages/ui (bun run scripts/dev-electron.mjs).
 */
import { spawn, execSync } from 'child_process';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { existsSync } from 'fs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');
const monorepoRoot = join(root, '../..');
const serverDist = join(monorepoRoot, 'packages/server/dist/run.js');

// Find Vite dev server (may be on 5173, 5174, etc if port is busy)
const findViteServer = async (maxAttempts = 30) => {
  const ports = [5173, 5174, 5175, 5176];
  
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    for (const port of ports) {
      try {
        const res = await fetch(`http://localhost:${port}`, { signal: AbortSignal.timeout(500) });
        if (res.ok) return port;
      } catch {}
    }
    await new Promise(r => setTimeout(r, 500));
  }
  return null;
};

// Wait for server build to complete (tsup creates dist/run.js)
const waitForServerBuild = async (maxAttempts = 60) => {
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    if (existsSync(serverDist)) {
      return true;
    }
    await new Promise(r => setTimeout(r, 500));
  }
  return false;
};

console.log('⏳ Waiting for Vite dev server...');
const vitePort = await findViteServer();
if (!vitePort) {
  console.error('❌ Vite dev server not responding on ports 5173-5176');
  process.exit(1);
}
console.log(`✅ Vite dev server ready on port ${vitePort}`);

console.log('⏳ Waiting for server build (packages/server/dist/run.js)...');
const serverBuilt = await waitForServerBuild();
if (!serverBuilt) {
  console.error('❌ Server build not found. Make sure turbo is running @acc/server dev');
  process.exit(1);
}
console.log('✅ Server build ready');

// Build electron main and preload with tsc (clean CJS for Electron)
console.log('📦 Building Electron main/preload...');
execSync('bunx tsc -p tsconfig.electron.json', {
  stdio: 'inherit',
  cwd: root,
});

// Run Electron binary directly (not via node + cli.js, so main process require('electron') gets the API)
const { createRequire } = await import('module');
const require = createRequire(import.meta.url);
const electronBin = require('electron');

const env = { 
  ...process.env, 
  NODE_ENV: 'development',
  VITE_DEV_SERVER_URL: `http://localhost:${vitePort}`,
};
delete env.ELECTRON_RUN_AS_NODE; // required so require('electron') returns API, not path

console.log('🚀 Starting Electron (server will be spawned by main process)...');
const child = spawn(electronBin, [root], {
  env,
  stdio: 'inherit',
  cwd: root,
});

child.on('exit', (code) => process.exit(code ?? 0));
