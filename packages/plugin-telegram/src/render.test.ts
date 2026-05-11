import { describe, expect, it } from 'vitest';
import { asPluginId, asSessionId, asToolCallId, asTurnId, type MoxxyEvent } from '@moxxy/sdk';
import { splitForTelegram, TurnRenderer } from './render.js';

const sid = asSessionId('s');
const tid = asTurnId('t');
const c1 = asToolCallId('c1');
const baseEvent = (e: Partial<MoxxyEvent> & Pick<MoxxyEvent, 'type'>, seq = 0): MoxxyEvent =>
  ({
    sessionId: sid,
    turnId: tid,
    source: 'system',
    id: `e${seq}` as never,
    seq,
    ts: 0,
    ...e,
  }) as MoxxyEvent;

describe('TurnRenderer', () => {
  it('accumulates assistant chunks into the body', () => {
    const r = new TurnRenderer();
    r.accept(baseEvent({ type: 'assistant_chunk', delta: 'hello ', source: 'model' }, 0));
    const second = r.accept(baseEvent({ type: 'assistant_chunk', delta: 'world', source: 'model' }, 1));
    expect(second.text).toBe('hello world');
  });

  it('replaces chunks with the final assistant_message on stop', () => {
    const r = new TurnRenderer();
    r.accept(baseEvent({ type: 'assistant_chunk', delta: 'partial', source: 'model' }, 0));
    const final = r.accept(
      baseEvent({ type: 'assistant_message', content: 'final', stopReason: 'end_turn', source: 'model' }, 1),
    );
    expect(final.text).toBe('final');
  });

  it('emits tool lines on tool_call_requested + tool_result', () => {
    const r = new TurnRenderer();
    r.accept(baseEvent({ type: 'tool_call_requested', callId: c1, name: 'Read', input: { path: '/a' }, source: 'model' }, 0));
    const after = r.accept(baseEvent({ type: 'tool_result', callId: c1, ok: true, output: 'ok', source: 'tool' }, 1));
    expect(after.text).toContain('🔧 Read');
    expect(after.text).toContain('✓ ok');
  });

  it('appends an error footer when an error event arrives', () => {
    const r = new TurnRenderer();
    const out = r.accept(baseEvent({ type: 'error', kind: 'fatal', message: 'boom', source: 'system' }, 0));
    expect(out.text).toContain('❗ fatal: boom');
  });

  it('reports hasUpdate=false when the same event yields the same frame', () => {
    const r = new TurnRenderer();
    r.accept(baseEvent({ type: 'assistant_chunk', delta: 'x', source: 'model' }, 0));
    const second = r.accept(baseEvent({ type: 'plugin_event', pluginId: asPluginId('p'), subtype: 'noop', payload: null, source: 'plugin' }, 1));
    expect(second.hasUpdate).toBe(false);
  });
});

describe('splitForTelegram', () => {
  it('returns one chunk when under the limit', () => {
    expect(splitForTelegram('hello')).toEqual(['hello']);
  });

  it('splits at newline preference when over the limit', () => {
    const text = 'a'.repeat(2000) + '\n' + 'b'.repeat(2000) + '\n' + 'c'.repeat(2000);
    const parts = splitForTelegram(text, 2500);
    expect(parts.length).toBeGreaterThan(1);
    for (const part of parts) expect(part.length).toBeLessThanOrEqual(2500);
    expect(parts.join('')).toBe(text);
  });
});
