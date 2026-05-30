import { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import type { MoxxyEvent, SessionInfo } from '@moxxy/sdk';
import { api } from './api';
import { chatStore } from './chatStore';

/**
 * Live context-window accounting for a workspace, derived entirely from the
 * event log the renderer already holds — no extra IPC for the token math.
 *
 *   - `contextTokens` is the size of the **most recent** prompt the provider
 *     reported (`input + cacheRead + cacheCreation`). That is exactly what
 *     occupies the model's window right now, so it's the honest "context
 *     used" number — and it drops the moment a smaller prompt (post-compaction)
 *     lands.
 *   - `contextWindow` comes from the active provider/model descriptor in
 *     `session.info` (fetched once per workspace/model), mirroring the TUI's
 *     `resolveContextWindow`.
 *   - `summary` is the cumulative per-session token fold the usage modal renders.
 *
 * The token fold is replicated locally (rather than imported from `@moxxy/sdk`)
 * on purpose: the SDK barrel pulls `node:crypto` into the graph, which Vite
 * externalizes for the browser and which then throws at runtime. The renderer
 * only ever touches `@moxxy/sdk` for *types*, never runtime values.
 */

// Anthropic ephemeral-cache price multipliers vs. an uncached input token —
// kept in sync with `@moxxy/sdk`'s token-accounting so the savings math matches.
const CACHE_READ_MULT = 0.1;
const CACHE_WRITE_MULT = 1.25;

export interface TokenSummary {
  /** Provider calls that reported usage. */
  readonly calls: number;
  readonly totalInput: number;
  readonly totalCacheRead: number;
  readonly totalCacheCreation: number;
  readonly totalOutput: number;
  /** input + cache read + cache write across the session. */
  readonly totalPrompt: number;
  /** cacheRead / totalPrompt. */
  readonly cacheHitRate: number;
  /** 1 − billedInputEq / uncachedInputEq — input cost saved by caching. */
  readonly savedRatio: number;
}

export interface ContextUsage {
  /** Tokens in the latest prompt sent to the model, or null before any call. */
  readonly contextTokens: number | null;
  /** Active model's context window, or null when unknown. */
  readonly contextWindow: number | null;
  /** contextTokens / contextWindow in [0, 1], or null when either is unknown. */
  readonly fraction: number | null;
  /** Cumulative per-session token accounting (folded from provider responses). */
  readonly summary: TokenSummary;
  /** Per-call prompt sizes in call order — feeds the growth sparkline. */
  readonly perCall: ReadonlyArray<number>;
  /** True once at least one provider response with usage has arrived. */
  readonly hasData: boolean;
}

const EMPTY_EVENTS: ReadonlyArray<MoxxyEvent> = Object.freeze([]);

/** Narrow a provider_response event that actually reported token usage. */
function promptTokensOf(e: MoxxyEvent): number | null {
  if (e.type !== 'provider_response') return null;
  if (
    e.inputTokens === undefined &&
    e.cacheReadTokens === undefined &&
    e.cacheCreationTokens === undefined
  ) {
    return null;
  }
  return (e.inputTokens ?? 0) + (e.cacheReadTokens ?? 0) + (e.cacheCreationTokens ?? 0);
}

/** Prompt size of the latest provider response that reported usage. */
function latestPromptTokens(events: ReadonlyArray<MoxxyEvent>): number | null {
  for (let i = events.length - 1; i >= 0; i--) {
    const n = promptTokensOf(events[i]!);
    if (n != null) return n;
  }
  return null;
}

/** Per-call prompt sizes (input + cache read + cache write), in order. */
function perCallPrompt(events: ReadonlyArray<MoxxyEvent>): number[] {
  const out: number[] = [];
  for (const e of events) {
    const n = promptTokensOf(e);
    if (n != null) out.push(n);
  }
  return out;
}

/** Fold provider_response usage into cumulative session totals. */
function foldSummary(events: ReadonlyArray<MoxxyEvent>): TokenSummary {
  let calls = 0;
  let totalInput = 0;
  let totalCacheRead = 0;
  let totalCacheCreation = 0;
  let totalOutput = 0;
  for (const e of events) {
    if (e.type !== 'provider_response') continue;
    if (promptTokensOf(e) == null && e.outputTokens === undefined) continue;
    calls += 1;
    totalInput += e.inputTokens ?? 0;
    totalCacheRead += e.cacheReadTokens ?? 0;
    totalCacheCreation += e.cacheCreationTokens ?? 0;
    totalOutput += e.outputTokens ?? 0;
  }
  const totalPrompt = totalInput + totalCacheRead + totalCacheCreation;
  const billedInputEq =
    totalInput + totalCacheRead * CACHE_READ_MULT + totalCacheCreation * CACHE_WRITE_MULT;
  return {
    calls,
    totalInput,
    totalCacheRead,
    totalCacheCreation,
    totalOutput,
    totalPrompt,
    cacheHitRate: totalPrompt > 0 ? totalCacheRead / totalPrompt : 0,
    savedRatio: totalPrompt > 0 ? 1 - billedInputEq / totalPrompt : 0,
  };
}

/** Mirror of the TUI's resolveContextWindow over a SessionInfo snapshot. */
function resolveContextWindow(info: SessionInfo | null, model: string | null): number | null {
  if (!info) return null;
  const provider =
    info.providers.find((p) => p.name === info.activeProvider) ?? info.providers[0];
  if (!provider) return null;
  const match = model ? provider.models.find((m) => m.id === model) : undefined;
  return match?.contextWindow ?? provider.models[0]?.contextWindow ?? null;
}

export function useContextUsage(workspaceId: string | null): ContextUsage {
  const events = useSyncExternalStore(chatStore.subscribe, () =>
    workspaceId ? chatStore.getChat(workspaceId).events : EMPTY_EVENTS,
  );
  const model = useSyncExternalStore(chatStore.subscribe, () =>
    workspaceId ? chatStore.getModel(workspaceId) : null,
  );

  // The context window is a property of the active provider/model, not the
  // log — fetch it once per (workspace, model). A provider switch resets the
  // sticky model, so keying on `model` also refetches after a provider change.
  const [info, setInfo] = useState<SessionInfo | null>(null);
  useEffect(() => {
    if (!workspaceId) return;
    let cancelled = false;
    void api()
      .invoke('session.info', { workspaceId })
      .then((raw) => {
        if (!cancelled) setInfo(raw);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [workspaceId, model]);

  const contextTokens = useMemo(() => latestPromptTokens(events), [events]);
  const perCall = useMemo(() => perCallPrompt(events), [events]);
  const summary = useMemo(() => foldSummary(events), [events]);
  const contextWindow = useMemo(() => resolveContextWindow(info, model), [info, model]);

  const fraction =
    contextWindow && contextWindow > 0 && contextTokens != null
      ? Math.max(0, Math.min(1, contextTokens / contextWindow))
      : null;

  return {
    contextTokens,
    contextWindow,
    fraction,
    summary,
    perCall,
    hasData: summary.calls > 0,
  };
}
