#!/usr/bin/env node
/**
 * Prepares a standalone server bundle for the packaged Electron app.
 * Run from repo root after `bun run build` (so packages/server and packages/contracts are built).
 * Output: packages/ui/server-bundle/ (dist + package.json + node_modules with @acc/contracts inlined).
 */
import { mkdir, cp, readFile, writeFile, rm } from 'fs/promises';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '../../..'); // repo root (scripts -> ui -> packages -> root)
const uiRoot = join(__dirname, '..');
const serverDir = join(root, 'packages/server');
const contractsDir = join(root, 'packages/contracts');
const bundleDir = join(uiRoot, 'server-bundle');

async function main() {
  console.log('Preparing server bundle for packaged app...');

  await rm(bundleDir, { recursive: true }).catch(() => {});
  await mkdir(bundleDir, { recursive: true });

  // Copy server dist and package.json
  await cp(join(serverDir, 'dist'), join(bundleDir, 'dist'), { recursive: true });
  const pkg = JSON.parse(await readFile(join(serverDir, 'package.json'), 'utf-8'));
  delete pkg.devDependencies;
  pkg.scripts = { start: 'node dist/run.js' };
  await writeFile(join(bundleDir, 'package.json'), JSON.stringify(pkg, null, 2));

  // Copy server node_modules (symlinks are copied as symlinks)
  await cp(join(serverDir, 'node_modules'), join(bundleDir, 'node_modules'), { recursive: true });

  // Replace @acc/contracts symlink with real package so the bundle is self-contained
  const accContracts = join(bundleDir, 'node_modules/@acc/contracts');
  await rm(accContracts, { recursive: true }).catch(() => {});
  await mkdir(join(accContracts, 'dist'), { recursive: true });
  await cp(join(contractsDir, 'dist'), join(accContracts, 'dist'), { recursive: true });
  const contractsPkg = JSON.parse(await readFile(join(contractsDir, 'package.json'), 'utf-8'));
  const contractsBundlePkg = {
    name: contractsPkg.name,
    version: contractsPkg.version,
    type: 'module',
    main: './dist/index.js',
  };
  await writeFile(join(accContracts, 'package.json'), JSON.stringify(contractsBundlePkg, null, 2));

  console.log('Server bundle ready at packages/ui/server-bundle');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
