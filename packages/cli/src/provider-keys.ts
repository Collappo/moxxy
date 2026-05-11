import type { VaultStore } from '@moxxy/plugin-vault';
import * as readline from 'node:readline/promises';

/**
 * Map provider name → canonical key name. Same string is used both as the
 * vault entry name AND as the env-var fallback, so a user who's set
 * ANTHROPIC_API_KEY in their environment doesn't need to mirror it in the
 * vault, and vice versa.
 */
export const PROVIDER_KEYS: Record<string, string> = {
  anthropic: 'ANTHROPIC_API_KEY',
  openai: 'OPENAI_API_KEY',
};

export interface ResolveOptions {
  /** Already-merged provider config (from moxxy.config.ts + CLI flags). If apiKey is set, we trust it and skip resolution. */
  readonly providerConfig?: Record<string, unknown>;
  /** Allow interactive prompts when the key isn't found anywhere. */
  readonly interactive?: boolean;
  /** Print this label in the prompt (defaults to "<PROVIDER_NAME>:"). */
  readonly promptLabel?: string;
  /** When the key isn't found, persist the answer to the vault under the canonical name. Defaults to true. */
  readonly persistToVault?: boolean;
  /** Custom prompt function for tests. */
  readonly promptFn?: (label: string) => Promise<string>;
}

export interface ResolveResult {
  readonly source: 'config' | 'vault' | 'env' | 'prompt';
  readonly providerConfig: Record<string, unknown>;
  /** The canonical key name (e.g. ANTHROPIC_API_KEY). null for providers we don't know about. */
  readonly canonicalName: string | null;
}

/**
 * Resolve the active provider's API key, in order: existing config → vault → env →
 * interactive prompt (TTY only). When prompted, save the answer back to the
 * vault so future runs don't ask again.
 */
export async function resolveProviderApiKey(
  providerName: string,
  vault: VaultStore,
  opts: ResolveOptions = {},
): Promise<ResolveResult> {
  const config = { ...(opts.providerConfig ?? {}) };
  const canonical = PROVIDER_KEYS[providerName] ?? null;

  if (config.apiKey) {
    return { source: 'config', providerConfig: config, canonicalName: canonical };
  }
  if (!canonical) {
    // Unknown provider; let it pass through with whatever config we have.
    return { source: 'config', providerConfig: config, canonicalName: null };
  }

  // 1. Vault
  try {
    const fromVault = await vault.get(canonical);
    if (fromVault) {
      config.apiKey = fromVault;
      return { source: 'vault', providerConfig: config, canonicalName: canonical };
    }
  } catch {
    // Vault couldn't open (no passphrase, etc) — fall through to env.
  }

  // 2. Env
  const fromEnv = process.env[canonical];
  if (fromEnv) {
    config.apiKey = fromEnv;
    return { source: 'env', providerConfig: config, canonicalName: canonical };
  }

  // 3. Interactive prompt
  if (opts.interactive ?? process.stdin.isTTY) {
    const prompt = opts.promptFn ?? defaultPrompt;
    const label = opts.promptLabel ?? `${canonical}: `;
    const value = (await prompt(label)).trim();
    if (!value) {
      throw new Error(`No ${canonical} provided.`);
    }
    config.apiKey = value;
    if (opts.persistToVault !== false) {
      try {
        await vault.set(canonical, value, [providerName]);
      } catch {
        // Vault write failed (no passphrase) — key still usable this session.
      }
    }
    return { source: 'prompt', providerConfig: config, canonicalName: canonical };
  }

  throw new Error(
    `No API key for provider '${providerName}'. Set ${canonical} env var, ` +
      `store it in the vault (vault_set('${canonical}', '...'))., ` +
      `or run \`moxxy init\` in an interactive terminal to configure.`,
  );
}

async function defaultPrompt(label: string): Promise<string> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stderr });
  try {
    return await rl.question(label);
  } finally {
    rl.close();
  }
}
