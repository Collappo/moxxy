import { deriveKey } from './crypto.js';

const KEYTAR_SERVICE = 'moxxy';
const KEYTAR_ACCOUNT = 'vault-master-key';

export interface MasterKeySource {
  /** Returns the raw 32-byte AES key. May open a keychain or prompt the user. */
  obtain(salt: Buffer): Promise<Buffer>;
  /** Persist the master key (or its derivation seed) for future sessions. */
  persist?(key: Buffer, salt: Buffer): Promise<void>;
  readonly name: string;
}

export interface CombinedKeySourceOptions {
  readonly passphrasePrompt: () => Promise<string>;
  readonly envVar?: string;
  readonly disableKeytar?: boolean;
}

/**
 * Tries OS keychain via keytar first; falls back to env var, then to an
 * interactive passphrase prompt. The chosen source's name is exposed so
 * callers can surface it ("vault unlocked via macOS Keychain", etc).
 */
export function createCombinedKeySource(opts: CombinedKeySourceOptions): MasterKeySource {
  let resolvedName = 'unknown';
  return {
    get name() {
      return resolvedName;
    },
    async obtain(salt) {
      const envName = opts.envVar ?? 'MOXXY_VAULT_PASSPHRASE';
      const envValue = process.env[envName];
      if (envValue) {
        resolvedName = `env:${envName}`;
        return deriveKey(envValue, salt);
      }

      if (!opts.disableKeytar) {
        const fromKeychain = await tryKeytarGet();
        if (fromKeychain) {
          resolvedName = 'keytar';
          return Buffer.from(fromKeychain, 'base64');
        }
      }

      const passphrase = await opts.passphrasePrompt();
      resolvedName = 'passphrase';
      const key = deriveKey(passphrase, salt);
      if (!opts.disableKeytar) await tryKeytarSet(key.toString('base64'));
      return key;
    },
    async persist(key) {
      if (!opts.disableKeytar) await tryKeytarSet(key.toString('base64'));
    },
  };
}

async function tryKeytarGet(): Promise<string | null> {
  try {
    const mod = (await import('keytar')) as {
      getPassword?: (svc: string, acct: string) => Promise<string | null>;
      default?: { getPassword: (svc: string, acct: string) => Promise<string | null> };
    };
    const fn = mod.getPassword ?? mod.default?.getPassword;
    if (!fn) return null;
    return await fn(KEYTAR_SERVICE, KEYTAR_ACCOUNT);
  } catch {
    return null;
  }
}

async function tryKeytarSet(value: string): Promise<void> {
  try {
    const mod = (await import('keytar')) as {
      setPassword?: (svc: string, acct: string, password: string) => Promise<void>;
      default?: { setPassword: (svc: string, acct: string, password: string) => Promise<void> };
    };
    const fn = mod.setPassword ?? mod.default?.setPassword;
    if (!fn) return;
    await fn(KEYTAR_SERVICE, KEYTAR_ACCOUNT, value);
  } catch {
    // Best-effort; keychain failures must not break the vault.
  }
}

export function createStaticKeySource(key: Buffer): MasterKeySource {
  return {
    name: 'static',
    async obtain() {
      return key;
    },
  };
}
