import OpenAI from 'openai';

export type ValidationResult = { ok: true } | { ok: false; message: string };

export interface ValidateKeyDeps {
  /** Inject the OpenAI SDK constructor for tests. */
  readonly client?: (apiKey: string) => {
    models: { list: () => Promise<unknown> };
  };
}

/**
 * "Is this key accepted by OpenAI?" Lists models — free, no inference cost.
 */
export async function validateKey(key: string, deps: ValidateKeyDeps = {}): Promise<ValidationResult> {
  if (!key || key.trim().length < 8) {
    return { ok: false, message: 'key looks too short' };
  }
  const make = deps.client ?? defaultMaker;
  try {
    const client = make(key);
    await client.models.list();
    return { ok: true };
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : String(err) };
  }
}

function defaultMaker(apiKey: string): { models: { list: () => Promise<unknown> } } {
  return new OpenAI({ apiKey }) as unknown as { models: { list: () => Promise<unknown> } };
}
