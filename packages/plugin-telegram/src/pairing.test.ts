import { describe, expect, it, vi } from 'vitest';
import {
  beginPairing,
  createPairingState,
  handleCode,
  handleStart,
  isAuthorized,
} from './pairing.js';

describe('pairing protocol', () => {
  it('starts in idle phase', () => {
    const s = createPairingState();
    expect(s.phase).toBe('idle');
    expect(s.authorizedChatId).toBeNull();
  });

  it('starts in paired phase when an authorized chat is restored', () => {
    const s = createPairingState({ authorizedChatId: 42 });
    expect(s.phase).toBe('paired');
    expect(isAuthorized(s, 42)).toBe(true);
    expect(isAuthorized(s, 99)).toBe(false);
  });

  it('beginPairing transitions to awaiting-code with a fresh 6-digit code', () => {
    const { state, code } = beginPairing(createPairingState());
    expect(state.phase).toBe('awaiting-code');
    expect(state.code).toBe(code);
    expect(code).toMatch(/^\d{6}$/);
    expect(state.expiresAt).toBeGreaterThan(Date.now() - 1);
  });

  it('handleStart rejects when no pairing window is open', () => {
    const s = createPairingState();
    const r = handleStart(s, 1);
    expect(r.action.kind).toBe('reject');
    if (r.action.kind !== 'reject') return;
    expect(r.action.message).toMatch(/Pairing not active/);
  });

  it('handleStart in awaiting-code phase prompts for the code', () => {
    const { state } = beginPairing(createPairingState());
    const r = handleStart(state, 1);
    expect(r.action.kind).toBe('request-code');
    expect(r.state.pendingChatId).toBe(1);
  });

  it('handleStart for an already-paired chat acknowledges', () => {
    const s = createPairingState({ authorizedChatId: 7 });
    const r = handleStart(s, 7);
    expect(r.action.kind).toBe('still-paired');
  });

  it('handleStart for a different chat when one is paired rejects', () => {
    const s = createPairingState({ authorizedChatId: 7 });
    const r = handleStart(s, 999);
    expect(r.action.kind).toBe('reject');
  });

  it('handleCode pairs on correct code from the pending chat', () => {
    const { state, code } = beginPairing(createPairingState());
    const afterStart = handleStart(state, 1).state;
    const r = handleCode(afterStart, 1, code);
    expect(r.action.kind).toBe('paired');
    expect(r.state.phase).toBe('paired');
    expect(r.state.authorizedChatId).toBe(1);
  });

  it('handleCode rejects on wrong code', () => {
    const { state } = beginPairing(createPairingState());
    const afterStart = handleStart(state, 1).state;
    const r = handleCode(afterStart, 1, '000000');
    expect(r.action.kind).toBe('reject');
    if (r.action.kind !== 'reject') return;
    expect(r.action.message).toMatch(/didn't match/);
  });

  it('handleCode asks again on non-digit input', () => {
    const { state } = beginPairing(createPairingState());
    const afterStart = handleStart(state, 1).state;
    const r = handleCode(afterStart, 1, 'hello');
    expect(r.action.kind).toBe('wait');
  });

  it('handleCode rejects a different chat than the pending one', () => {
    const { state, code } = beginPairing(createPairingState());
    const afterStart = handleStart(state, 1).state;
    const r = handleCode(afterStart, 2, code);
    expect(r.action.kind).toBe('reject');
  });

  it('expires after the TTL window', () => {
    vi.useFakeTimers();
    try {
      const t0 = Date.now();
      const { state, code } = beginPairing(createPairingState(), t0, 1000);
      const afterStart = handleStart(state, 1, t0 + 500).state;
      const r = handleCode(afterStart, 1, code, t0 + 2000);
      expect(r.action.kind).toBe('reject');
      expect(r.state.phase).toBe('expired');
    } finally {
      vi.useRealTimers();
    }
  });
});
