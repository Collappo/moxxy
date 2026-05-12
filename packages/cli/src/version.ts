import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import * as path from 'node:path';

/**
 * Resolve the @moxxy/cli package version at runtime. Uses createRequire
 * so the lookup works under both source-tsc dev (jiti) and prod
 * (compiled dist) without relying on import-attributes JSON support.
 *
 * Returns `undefined` if anything fails — we never want a missing
 * version line to crash the TUI mount.
 */
export function cliVersion(): string | undefined {
  try {
    const here = fileURLToPath(import.meta.url);
    // dist/version.js → ../package.json   |   src/version.ts → ../package.json
    const pkgPath = path.resolve(path.dirname(here), '..', 'package.json');
    const require = createRequire(import.meta.url);
    const pkg = require(pkgPath) as { version?: string };
    return typeof pkg.version === 'string' ? pkg.version : undefined;
  } catch {
    return undefined;
  }
}
