import { describe, expect, it, vi } from 'vitest';
import { validateProviderKey } from './validate-key.js';

function makeRegistry(
  defs: Array<{
    name: string;
    validateKey?: (k: string) => Promise<{ ok: true } | { ok: false; message: string }>;
  }>,
): { list: () => typeof defs } {
  return { list: () => defs };
}

describe('validateProviderKey (registry-based dispatch)', () => {
  it('delegates to the matching provider def', async () => {
    const validateKey = vi.fn().mockResolvedValue({ ok: true });
    const registry = makeRegistry([{ name: 'foo', validateKey }]);
    const res = await validateProviderKey('foo', 'a-long-enough-key', registry);
    expect(res).toEqual({ ok: true });
    expect(validateKey).toHaveBeenCalledWith('a-long-enough-key');
  });

  it('returns "unknown provider" when no def matches', async () => {
    const registry = makeRegistry([]);
    const res = await validateProviderKey('absent', 'key', registry);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.message).toContain('unknown provider');
  });

  it('returns a clear error when the def has no validateKey', async () => {
    const registry = makeRegistry([{ name: 'cant-validate' }]);
    const res = await validateProviderKey('cant-validate', 'key', registry);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.message).toContain('does not support key validation');
  });

  it("propagates the provider def's error message", async () => {
    const validateKey = vi.fn().mockResolvedValue({ ok: false, message: 'forbidden' });
    const registry = makeRegistry([{ name: 'bar', validateKey }]);
    const res = await validateProviderKey('bar', 'key', registry);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.message).toBe('forbidden');
  });

  it('works with the real session.providers registry shape', async () => {
    const registry = {
      list: () => [
        {
          name: 'real-provider',
          validateKey: async () => ({ ok: true as const }),
        },
      ],
    };
    const res = await validateProviderKey('real-provider', 'key', registry);
    expect(res.ok).toBe(true);
  });
});
