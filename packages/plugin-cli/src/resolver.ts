import {
  createDeferredPermissionResolver,
  type DeferredPermissionResolver,
  type DeferredPermissionResolverOptions,
  type PermissionPromptHandler,
} from '@moxxy/core';

export type { PermissionPromptHandler };

export interface InteractivePermissionResolverOptions extends DeferredPermissionResolverOptions {}

/**
 * Build a PermissionResolver around an interactive prompt. Thin alias over
 * core's `createDeferredPermissionResolver` — kept for backwards compat with
 * the previous import path.
 *
 * For new code, prefer importing `createDeferredPermissionResolver` from
 * `@moxxy/core` directly: the same resolver shape is shared with other
 * channels (Telegram, future web/Slack).
 */
export function createInteractivePermissionResolver(
  opts: InteractivePermissionResolverOptions,
): DeferredPermissionResolver {
  return createDeferredPermissionResolver({
    name: opts.name ?? 'interactive',
    prompt: opts.prompt,
    sessionAllows: opts.sessionAllows,
  });
}
