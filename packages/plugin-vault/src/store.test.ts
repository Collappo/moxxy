import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { VaultStore } from './store.js';
import { createStaticKeySource } from './keysource.js';
import { deriveKey, generateSalt } from './crypto.js';

let tmp: string;
let filePath: string;
const stableKey = deriveKey('test-passphrase', generateSalt());

const newStore = () =>
  new VaultStore({ filePath, keySource: createStaticKeySource(stableKey) });

beforeEach(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'mox-vault-'));
  filePath = path.join(tmp, 'vault.json');
});
afterEach(async () => {
  await fs.rm(tmp, { recursive: true, force: true });
});

describe('VaultStore', () => {
  it('creates a new vault file on first set', async () => {
    const store = newStore();
    await store.set('hello', 'world');
    expect(await store.get('hello')).toBe('world');

    const raw = JSON.parse(await fs.readFile(filePath, 'utf8'));
    expect(raw.version).toBe(1);
    expect(raw.kdf).toBe('scrypt');
    expect(raw.entries.hello).toMatchObject({ iv: expect.any(String), tag: expect.any(String) });
    // Ciphertext should never contain the plaintext
    expect(raw.entries.hello.data).not.toContain('world');
  });

  it('round-trips multiple entries across instances', async () => {
    const a = newStore();
    await a.set('foo', 'one');
    await a.set('bar', 'two', ['ops']);
    const b = newStore();
    expect(await b.get('foo')).toBe('one');
    expect(await b.get('bar')).toBe('two');
    const listed = await b.list();
    expect(listed.map((e) => e.name).sort()).toEqual(['bar', 'foo']);
    const bar = listed.find((e) => e.name === 'bar');
    expect(bar?.tags).toEqual(['ops']);
  });

  it('returns null on missing key', async () => {
    const store = newStore();
    expect(await store.get('absent')).toBeNull();
    expect(await store.has('absent')).toBe(false);
  });

  it('overwrites updates updatedAt but preserves createdAt', async () => {
    const store = newStore();
    await store.set('x', 'a');
    const first = (await store.list())[0]!;
    await new Promise((r) => setTimeout(r, 10));
    await store.set('x', 'b');
    const second = (await store.list())[0]!;
    expect(second.createdAt).toBe(first.createdAt);
    expect(second.updatedAt).not.toBe(first.updatedAt);
    expect(await store.get('x')).toBe('b');
  });

  it('delete removes the entry', async () => {
    const store = newStore();
    await store.set('x', '1');
    expect(await store.delete('x')).toBe(true);
    expect(await store.delete('x')).toBe(false);
    expect(await store.get('x')).toBeNull();
  });

  it('fails to decrypt with a different key', async () => {
    const a = newStore();
    await a.set('x', 'secret');
    const otherKey = deriveKey('different', generateSalt());
    const b = new VaultStore({ filePath, keySource: createStaticKeySource(otherKey) });
    await expect(b.get('x')).rejects.toThrow();
  });
});
