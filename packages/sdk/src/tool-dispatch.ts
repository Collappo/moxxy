import { asToolCallId } from './ids.js';
import type { MoxxyEvent } from './events.js';
import type { ModeContext } from './mode.js';
import type { ToolCallVerdict } from './hooks.js';
import type { CollectedToolUse } from './mode-helpers.js';

/**
 * Execute a single tool-use end-to-end: dispatch `dispatchToolCall` hooks, run
 * the permission check, invoke the tool, and emit the approved/denied/result
 * events. An async generator so a loop strategy can `yield*` it; callers that
 * don't need the events can drain it (`for await (const _ of …) {}`) — either
 * way the events reach the log via `ctx.emit`.
 *
 * Shared by every loop strategy (tool-use, plan-execute, developer, bmad) so
 * the defensive outer try/catch below lives in ONE place. Without it, a throw
 * from a hook handler / permission resolver / the emit itself escapes the
 * generator and leaves this (and any later) call as an orphan
 * `tool_call_requested` with no matching `tool_result` — which the provider
 * then rejects on the next turn.
 */
export async function* dispatchToolCall(
  ctx: ModeContext,
  t: CollectedToolUse,
  iteration: number,
): AsyncGenerator<MoxxyEvent, void, unknown> {
  try {
    const verdict = await ctx.hooks.dispatchToolCall({
      sessionId: ctx.sessionId,
      cwd: '',
      log: ctx.log,
      env: {},
      turnId: ctx.turnId,
      iteration,
      call: { callId: asToolCallId(t.id), name: t.name, input: t.input },
    });
    const actualInput = verdict.action === 'rewrite' ? verdict.input : t.input;

    const denyReason = hookDeny(verdict);
    if (denyReason) {
      yield* emitDenied(ctx, t, denyReason, 'hook');
      return;
    }

    const decision = await ctx.permissions.check(
      { callId: asToolCallId(t.id), name: t.name, input: actualInput },
      { sessionId: String(ctx.sessionId), toolDescription: ctx.tools.get(t.name)?.description },
    );
    if (decision.mode === 'deny') {
      yield* emitDenied(ctx, t, decision.reason ?? 'denied by resolver', 'resolver');
      return;
    }
    yield await ctx.emit({
      type: 'tool_call_approved',
      sessionId: ctx.sessionId,
      turnId: ctx.turnId,
      source: 'system',
      callId: asToolCallId(t.id),
      decidedBy: 'resolver',
      mode: decision.mode,
    });

    try {
      const output = await ctx.tools.execute(t.name, actualInput, ctx.signal, {
        callId: t.id,
        sessionId: String(ctx.sessionId),
        turnId: String(ctx.turnId),
        log: ctx.log,
        ...(ctx.subagents ? { subagents: ctx.subagents } : {}),
      });
      yield await ctx.emit({
        type: 'tool_result',
        sessionId: ctx.sessionId,
        turnId: ctx.turnId,
        source: 'tool',
        callId: asToolCallId(t.id),
        ok: true,
        output,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const kind: 'aborted' | 'threw' = ctx.signal.aborted ? 'aborted' : 'threw';
      yield await ctx.emit({
        type: 'tool_result',
        sessionId: ctx.sessionId,
        turnId: ctx.turnId,
        source: 'tool',
        callId: asToolCallId(t.id),
        ok: false,
        error: { kind, message },
      });
    }
  } catch (err) {
    // Defensive: a hook handler, permission resolver, or the emit itself threw
    // before we could produce a tool_result. Synthesize a failed result so the
    // event log stays well-formed (no orphan tool_call_requested).
    const message = err instanceof Error ? err.message : String(err);
    yield await ctx.emit({
      type: 'tool_result',
      sessionId: ctx.sessionId,
      turnId: ctx.turnId,
      source: 'tool',
      callId: asToolCallId(t.id),
      ok: false,
      error: { kind: 'threw', message: `pre-execute failure: ${message}` },
    });
  }
}

function hookDeny(verdict: ToolCallVerdict): string | null {
  return verdict.action === 'deny' ? verdict.reason : null;
}

async function* emitDenied(
  ctx: ModeContext,
  t: CollectedToolUse,
  reason: string,
  by: 'hook' | 'resolver' | 'policy',
): AsyncGenerator<MoxxyEvent, void, unknown> {
  yield await ctx.emit({
    type: 'tool_call_denied',
    sessionId: ctx.sessionId,
    turnId: ctx.turnId,
    source: 'system',
    callId: asToolCallId(t.id),
    decidedBy: by,
    reason,
  });
  yield await ctx.emit({
    type: 'tool_result',
    sessionId: ctx.sessionId,
    turnId: ctx.turnId,
    source: 'tool',
    callId: asToolCallId(t.id),
    ok: false,
    error: { kind: 'denied', message: reason },
  });
}
