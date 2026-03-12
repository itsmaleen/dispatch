#!/usr/bin/env node
/**
 * Dev script: build electron main/preload and run Electron with Vite dev server.
 * Run from packages/ui (bun run scripts/dev-electron.mjs).
 */
import { spawn, execSync } from 'child_process';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');

// Build electron main and preload with tsc (clean CJS for Electron)
execSync('bunx tsc -p tsconfig.electron.json', {
  stdio: 'inherit',
  cwd: root,
});

// Run Electron binary directly (not via node + cli.js, so main process require('electron') gets the API)
const { createRequire } = await import('module');
const require = createRequire(import.meta.url);
const electronBin = require('electron');

const env = { ...process.env, NODE_ENV: 'development' };
delete env.ELECTRON_RUN_AS_NODE; // required so require('electron') returns API, not path

const child = spawn(electronBin, [root], {
  env,
  stdio: 'inherit',
  cwd: root,
});

child.on('exit', (code) => process.exit(code ?? 0));
