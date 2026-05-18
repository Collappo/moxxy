import { describe, expect, it, vi } from 'vitest';
import {
  beginPairing,
  createPairingState,
  handleStart,
  isAuthorized,
  submitTerminalCode,
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

  it('beginPairing transitions to awaiting-start without issuing a code yet', () => {
    const state = beginPairing(createPairingState());
    expect(state.phase).toBe('awaiting-start');
    expect(state.code).toBeNull();
    expect(state.expiresAt).toBeGreaterThan(Date.now() - 1);
  });

  it('handleStart rejects when no pairing window is open', () => {
    const s = createPairingState();
    const r = handleStart(s, 1);
    expect(r.action.kind).toBe('reject');
    if (r.action.kind !== 'reject') return;
    expect(r.action.message).toMatch(/No pairing window/);
  });

  it('handleStart in awaiting-start issues a fresh 6-digit code to the chat', () => {
    const state = beginPairing(createPairingState());
    const r = handleStart(state, 1);
    expect(r.action.kind).toBe('issue-code');
    if (r.action.kind !== 'issue-code') return;
    expect(r.action.code).toMatch(/^\d{6}$/);
    expect(r.action.chatId).toBe(1);
    expect(r.state.phase).toBe('awaiting-terminal');
    expect(r.state.pendingChatId).toBe(1);
    expect(r.state.code).toBe(r.action.code);
  });

  it('handleStart re-issues the same code when the same chat re-sends /start', () => {
    const state = beginPairing(createPairingState());
    const first = handleStart(state, 1);
    if (first.action.kind !== 'issue-code') throw new Error('expected issue-code');
    const second = handleStart(first.state, 1);
    expect(second.action.kind).toBe('issue-code');
    if (second.action.kind !== 'issue-code') return;
    expect(second.action.code).toBe(first.action.code);
  });

  it('handleStart tells a competing chat to wait when one is already pending', () => {
    const state = beginPairing(createPairingState());
    const after = handleStart(state, 1).state;
    const r = handleStart(after, 2);
    expect(r.action.kind).toBe('wait');
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

  it('submitTerminalCode pairs on the correct code', () => {
    const state = beginPairing(createPairingState());
    const issued = handleStart(state, 1);
    if (issued.action.kind !== 'issue-code') throw new Error('expected issue-code');
    const r = submitTerminalCode(issued.state, issued.action.code);
    expect(r.action.kind).toBe('paired');
    expect(r.state.phase).toBe('paired');
    expect(r.state.authorizedChatId).toBe(1);
  });

  it('submitTerminalCode reports a mismatch on a wrong code', () => {
    const state = beginPairing(createPairingState());
    const issued = handleStart(state, 1);
    const r = submitTerminalCode(issued.state, '000000');
    expect(r.action.kind).toBe('mismatch');
    if (r.action.kind !== 'mismatch') return;
    expect(r.action.message).toMatch(/didn't match/);
  });

  it('submitTerminalCode rejects non-digit input as a mismatch', () => {
    const state = beginPairing(createPairingState());
    const issued = handleStart(state, 1);
    const r = submitTerminalCode(issued.state, 'hello');
    expect(r.action.kind).toBe('mismatch');
    if (r.action.kind !== 'mismatch') return;
    expect(r.action.message).toMatch(/6-digit/);
  });

  it('submitTerminalCode reports not-pending when no /start has landed', () => {
    const state = beginPairing(createPairingState());
    const r = submitTerminalCode(state, '123456');
    expect(r.action.kind).toBe('not-pending');
  });

  it('expires after the TTL window', () => {
    vi.useFakeTimers();
    try {
      const t0 = Date.now();
      const state = beginPairing(createPairingState(), t0, 1000);
      const issued = handleStart(state, 1, t0 + 500);
      if (issued.action.kind !== 'issue-code') throw new Error('expected issue-code');
      const r = submitTerminalCode(issued.state, issued.action.code, t0 + 2000);
      expect(r.action.kind).toBe('expired');
      expect(r.state.phase).toBe('expired');
    } finally {
      vi.useRealTimers();
    }
  });
});
