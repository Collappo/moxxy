import { describe, expect, it, vi } from 'vitest';
import { asToolCallId } from '@moxxy/sdk';
import { TelegramPermissionResolver } from './permission.js';

const call = (name = 'Read') => ({ callId: asToolCallId('c1'), name, input: {} });
const ctx = { sessionId: 's', toolDescription: '' };

describe('TelegramPermissionResolver', () => {
  it('denies when no decider is attached', async () => {
    const r = new TelegramPermissionResolver();
    expect((await r.check(call(), ctx)).mode).toBe('deny');
  });

  it('routes to the decider, awaits resolvePending', async () => {
    const r = new TelegramPermissionResolver();
    r.setDecider(async () => {});
    const promise = r.check(call(), ctx);
    const resolved = r.resolvePending('c1', { mode: 'allow' });
    expect(resolved).toBe(true);
    expect((await promise).mode).toBe('allow');
  });

  it('caches allow_session and skips the decider on subsequent calls', async () => {
    const r = new TelegramPermissionResolver();
    const decider = vi.fn(async () => {});
    r.setDecider(decider);
    const p1 = r.check(call('Bash'), ctx);
    r.resolvePending('c1', { mode: 'allow_session' });
    expect((await p1).mode).toBe('allow_session');

    // Second call to Bash should not hit the decider
    const p2 = r.check(call('Bash'), ctx);
    expect((await p2).mode).toBe('allow_session');
    expect(decider).toHaveBeenCalledTimes(1);
  });

  it('abortAll resolves pending checks as deny', async () => {
    const r = new TelegramPermissionResolver();
    r.setDecider(async () => {});
    const promise = r.check(call(), ctx);
    r.abortAll('shutdown');
    const decision = await promise;
    expect(decision.mode).toBe('deny');
    expect(decision.reason).toContain('shutdown');
  });

  it('decider throw → deny with the error message', async () => {
    const r = new TelegramPermissionResolver();
    r.setDecider(async () => {
      throw new Error('boom');
    });
    const decision = await r.check(call(), ctx);
    expect(decision.mode).toBe('deny');
    expect(decision.reason).toContain('boom');
  });
});
