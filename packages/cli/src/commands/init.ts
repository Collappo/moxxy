import * as readline from 'node:readline/promises';
import { setupSessionWithConfig } from '../setup.js';
import { PROVIDER_KEYS, resolveProviderApiKey } from '../provider-keys.js';
import type { ParsedArgv } from '../argv.js';

/**
 * Interactive one-time setup. Walks the user through:
 *   1. Vault unlock (passphrase prompt, on first use).
 *   2. Provider API keys (one per known provider — anthropic, openai).
 *   3. Optionally, a starter project moxxy.config.yaml.
 *
 * Safe to re-run; entries already in the vault are left untouched.
 */
export async function runInitCommand(_argv: ParsedArgv): Promise<number> {
  if (!process.stdin.isTTY) {
    process.stderr.write('`moxxy init` must be run in an interactive terminal.\n');
    return 1;
  }

  process.stdout.write('\nmoxxy — first-time setup\n\n');
  process.stdout.write(
    'This will store API keys in the encrypted vault at ~/.moxxy/vault.json.\n' +
      'You can skip any provider by leaving the prompt empty.\n\n',
  );

  // Booting the session here triggers the vault master-key flow (keychain or
  // passphrase) ONCE up front — better UX than asking again per provider.
  const { vault } = await setupSessionWithConfig({ cwd: process.cwd() });

  const rl = readline.createInterface({ input: process.stdin, output: process.stderr });
  try {
    for (const [provider, canonical] of Object.entries(PROVIDER_KEYS)) {
      const existing = await vault.get(canonical).catch(() => null);
      if (existing) {
        process.stdout.write(`  ${provider}: ${canonical} already set (skipping).\n`);
        continue;
      }
      const envValue = process.env[canonical];
      if (envValue) {
        const answer = (await rl.question(`  ${provider}: ${canonical} found in env. Save to vault? [Y/n] `)).trim();
        if (answer === '' || /^y/i.test(answer)) {
          await vault.set(canonical, envValue, [provider]);
          process.stdout.write(`    saved from env.\n`);
        }
        continue;
      }
      const answer = (await rl.question(`  ${provider}: paste ${canonical} (or empty to skip): `)).trim();
      if (!answer) {
        process.stdout.write(`    skipped.\n`);
        continue;
      }
      await resolveProviderApiKey(provider, vault, {
        providerConfig: { apiKey: answer },
      });
      await vault.set(canonical, answer, [provider]);
      process.stdout.write(`    saved.\n`);
    }
  } finally {
    rl.close();
  }

  process.stdout.write('\nDone. Try `moxxy -p "hello"` to verify.\n');
  return 0;
}
