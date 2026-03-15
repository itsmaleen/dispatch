#!/usr/bin/env node
/**
 * Prepares the server for the packaged Electron app.
 * 
 * Strategy: Copy pre-built server dist + package.json + install deps.
 * Since we use node:sqlite (built-in), no native module rebuilding needed.
 * 
 * Output: packages/ui/server-bundle/
 */
import { mkdir, cp, readFile, writeFile, rm } from 'fs/promises';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '../../..'); // repo root
const uiRoot = join(__dirname, '..');
const serverDir = join(root, 'packages/server');
const contractsDir = join(root, 'packages/contracts');
const bundleDir = join(uiRoot, 'server-bundle');

async function main() {
  console.log('📦 Preparing server bundle for packaged app...');

  // Clean and create bundle directory
  await rm(bundleDir, { recursive: true }).catch(() => {});
  await mkdir(bundleDir, { recursive: true });

  // 1. Copy server dist
  console.log('  → Copying server dist...');
  await cp(join(serverDir, 'dist'), join(bundleDir, 'dist'), { recursive: true });

  // 2. Create package.json (strip workspace: deps and devDeps)
  console.log('  → Creating package.json...');
  const serverPkg = JSON.parse(await readFile(join(serverDir, 'package.json'), 'utf-8'));
  
  const bundlePkg = {
    name: serverPkg.name,
    version: serverPkg.version,
    type: 'module',
    main: './dist/run.js',
    scripts: { start: 'node dist/run.js' },
    dependencies: {},
  };

  // Copy non-workspace dependencies
  for (const [name, version] of Object.entries(serverPkg.dependencies || {})) {
    if (!version.startsWith('workspace:')) {
      bundlePkg.dependencies[name] = version;
    }
  }
  
  await writeFile(join(bundleDir, 'package.json'), JSON.stringify(bundlePkg, null, 2));

  // 3. Install production dependencies
  console.log('  → Installing production dependencies...');
  execSync('npm install --omit=dev --ignore-scripts --legacy-peer-deps', {
    cwd: bundleDir,
    stdio: 'inherit',
  });

  // 4. Inline @acc/contracts (since it was a workspace: dep)
  console.log('  → Inlining @acc/contracts...');
  const contractsTarget = join(bundleDir, 'node_modules/@acc/contracts');
  await rm(contractsTarget, { recursive: true }).catch(() => {});
  await mkdir(join(contractsTarget, 'dist'), { recursive: true });
  await cp(join(contractsDir, 'dist'), join(contractsTarget, 'dist'), { recursive: true });
  
  const contractsPkg = JSON.parse(await readFile(join(contractsDir, 'package.json'), 'utf-8'));
  await writeFile(join(contractsTarget, 'package.json'), JSON.stringify({
    name: contractsPkg.name,
    version: contractsPkg.version,
    type: 'module',
    main: './dist/index.js',
  }, null, 2));

  console.log('✅ Server bundle ready at packages/ui/server-bundle');
  console.log('   (No native modules - using node:sqlite built-in)');
}

main().catch((err) => {
  console.error('❌ Bundle preparation failed:', err);
  process.exit(1);
});
