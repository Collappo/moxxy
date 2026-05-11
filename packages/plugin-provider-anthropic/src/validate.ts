import Anthropic from '@anthropic-ai/sdk';

export type ValidationResult = { ok: true } | { ok: false; message: string };

export interface ValidateKeyDeps {
  /** Inject the Anthropic SDK constructor for tests. */
  readonly client?: (apiKey: string) => {
    messages: { create: (args: Record<string, unknown>) => Promise<unknown> };
  };
  readonly model?: string;
}

/**
 * "Is this key accepted by Anthropic?" Issues a 1-token completion — effectively
 * free. Returns ok or a useful error message.
 */
export async function validateKey(key: string, deps: ValidateKeyDeps = {}): Promise<ValidationResult> {
  if (!key || key.trim().length < 8) {
    return { ok: false, message: 'key looks too short' };
  }
  const make = deps.client ?? defaultMaker;
  try {
    const client = make(key);
    await client.messages.create({
      model: deps.model ?? 'claude-haiku-4-5-20251001',
      max_tokens: 1,
      messages: [{ role: 'user', content: 'ping' }],
    });
    return { ok: true };
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : String(err) };
  }
}

function defaultMaker(apiKey: string): { messages: { create: (args: Record<string, unknown>) => Promise<unknown> } } {
  return new Anthropic({ apiKey }) as unknown as {
    messages: { create: (args: Record<string, unknown>) => Promise<unknown> };
  };
}
