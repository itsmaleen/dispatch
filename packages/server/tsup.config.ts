import { defineConfig } from 'tsup';
import { readdir, readFile, writeFile } from 'fs/promises';
import { join } from 'path';

// Post-build hook to fix node: prefix being stripped by esbuild
async function fixNodePrefixes(distDir: string) {
  const files = await readdir(distDir);
  for (const file of files) {
    if (!file.endsWith('.js')) continue;
    const path = join(distDir, file);
    let content = await readFile(path, 'utf-8');
    // Fix sqlite import (node:sqlite -> sqlite stripping)
    content = content.replace(/from "sqlite"/g, 'from "node:sqlite"');
    content = content.replace(/from 'sqlite'/g, "from 'node:sqlite'");
    await writeFile(path, content);
  }
}

export default defineConfig({
  entry: ['src/index.ts', 'src/run.ts'],
  format: ['esm'],
  dts: true,
  clean: true,
  target: 'node22',
  platform: 'node',
  // Post-build: fix node: prefixes
  onSuccess: async () => {
    await fixNodePrefixes('./dist');
    console.log('[tsup] Fixed node: prefixes in dist');
  },
});
