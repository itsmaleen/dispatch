#!/usr/bin/env node
/**
 * Prepares the server for the packaged Electron app.
 * 
 * Strategy (T3 Code pattern):
 * 1. Copy pre-built server dist to staging
 * 2. Generate package.json with resolved dependencies
 * 3. Run bun install --production (compiles native modules fresh)
 * 4. Native modules (like better-sqlite3 from claude-agent-sdk) will be 
 *    rebuilt by electron-builder for Electron's Node ABI
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
  console.log('📦 Preparing server bundle for packaged app (T3 pattern)...');

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

  // 3. Install production dependencies with npm (more reliable for native modules)
  // npm handles native module compilation correctly for Electron
  console.log('  → Installing production dependencies (npm)...');
  execSync('npm install --omit=dev --legacy-peer-deps', {
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

  // 5. Rebuild native modules for Electron
  console.log('  → Rebuilding native modules for Electron...');
  try {
    // Get Electron version from ui package
    const uiPkg = JSON.parse(await readFile(join(uiRoot, 'package.json'), 'utf-8'));
    const electronVersion = uiPkg.dependencies?.electron || uiPkg.devDependencies?.electron || '40.0.0';
    const cleanVersion = electronVersion.replace(/[\^~]/, '');
    
    execSync(`npx @electron/rebuild --version=${cleanVersion} --module-dir=.`, {
      cwd: bundleDir,
      stdio: 'inherit',
    });
    console.log('  ✓ Native modules rebuilt for Electron');
  } catch (err) {
    console.warn('  ⚠ electron-rebuild failed, electron-builder will retry during packaging');
  }

  console.log('✅ Server bundle ready at packages/ui/server-bundle');
}

main().catch((err) => {
  console.error('❌ Bundle preparation failed:', err);
  process.exit(1);
});
