#!/usr/bin/env node
/**
 * Copies the built moxxy CLI bundle into the Tauri resources/ tree so
 * the installed app ships with the runner already on disk. The Rust
 * side resolves this path via `resolve_cli_entry()` falling back to
 * `tauri::path::resource_dir() / "moxxy-cli/bin.js"`.
 *
 * Runs as part of `pnpm prebuild` so `tauri build` always finds a
 * fresh bundle. Idempotent — re-running just overwrites.
 */

import { mkdir, copyFile, readdir, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const desktopRoot = resolve(here, '..');
const repoRoot = resolve(desktopRoot, '..', '..');
const cliDist = resolve(repoRoot, 'packages', 'cli', 'dist');
const resourcesDir = resolve(desktopRoot, 'src-tauri', 'resources', 'moxxy-cli');

async function main() {
  if (!existsSync(cliDist)) {
    console.error(`✗ ${cliDist} does not exist.`);
    console.error('  Run `pnpm --filter @moxxy/cli build` first.');
    process.exit(1);
  }

  await mkdir(resourcesDir, { recursive: true });

  // Copy bin.js + every sibling chunk the bundler emitted.
  const entries = await readdir(cliDist);
  let copied = 0;
  for (const name of entries) {
    const src = resolve(cliDist, name);
    const dst = resolve(resourcesDir, name);
    const s = await stat(src);
    if (s.isFile()) {
      await copyFile(src, dst);
      copied += 1;
    }
  }
  console.log(`✓ bundled ${copied} CLI file(s) → ${resourcesDir}`);
}

main().catch((e) => {
  console.error('✗ bundle-cli failed:', e);
  process.exit(1);
});
