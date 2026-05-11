import { describe, expect, it } from 'vitest';
import { decrypt, deriveKey, encrypt, generateSalt, randomCode } from './crypto.js';

describe('crypto primitives', () => {
  it('round-trips plaintext through encrypt/decrypt', () => {
    const salt = generateSalt();
    const key = deriveKey('hunter2', salt);
    const blob = encrypt('secret value', key);
    expect(decrypt(blob, key)).toBe('secret value');
  });

  it('fails to decrypt with wrong key', () => {
    const salt = generateSalt();
    const key1 = deriveKey('one', salt);
    const key2 = deriveKey('two', salt);
    const blob = encrypt('secret', key1);
    expect(() => decrypt(blob, key2)).toThrow();
  });

  it('produces different ciphertext for the same plaintext', () => {
    const key = deriveKey('p', generateSalt());
    const a = encrypt('same', key);
    const b = encrypt('same', key);
    expect(a.data).not.toBe(b.data);
    expect(a.iv).not.toBe(b.iv);
  });

  it('randomCode produces zero-padded fixed-length digit strings', () => {
    for (let i = 0; i < 20; i++) {
      const code = randomCode(6);
      expect(code).toMatch(/^\d{6}$/);
    }
    expect(randomCode(4)).toMatch(/^\d{4}$/);
  });
});
