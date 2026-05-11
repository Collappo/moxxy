import type { ProviderRegistry } from '@moxxy/core';
import type { ProviderKeyValidation } from '@moxxy/sdk';

/**
 * Registry-based key validation. Looks up the provider in the session's
 * ProviderRegistry and delegates to its `validateKey` (if defined). The CLI
 * has zero knowledge of provider internals — adding a new provider just
 * means a new plugin whose defineProvider() sets `validateKey`.
 */
export async function validateProviderKey(
  providerName: string,
  key: string,
  providers: { list(): ReadonlyArray<{ name: string; validateKey?: (key: string) => Promise<ProviderKeyValidation> }> },
): Promise<ProviderKeyValidation> {
  const def = providers.list().find((p) => p.name === providerName);
  if (!def) {
    return { ok: false, message: `unknown provider: ${providerName}` };
  }
  if (!def.validateKey) {
    return {
      ok: false,
      message: `provider '${providerName}' does not support key validation`,
    };
  }
  return await def.validateKey(key);
}

export type { ProviderRegistry };
