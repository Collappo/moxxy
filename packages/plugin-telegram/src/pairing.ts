import { randomCode } from '@moxxy/plugin-vault';

export type PairingPhase = 'idle' | 'awaiting-code' | 'paired' | 'expired';

export interface PairingState {
  phase: PairingPhase;
  code: string | null;
  pendingChatId: number | null;
  expiresAt: number | null;
  authorizedChatId: number | null;
}

export interface PairingDecision {
  readonly state: PairingState;
  readonly action:
    | { kind: 'reject'; message: string }
    | { kind: 'request-code'; message: string }
    | { kind: 'paired'; message: string; chatId: number }
    | { kind: 'still-paired'; chatId: number }
    | { kind: 'wait'; message: string };
}

const DEFAULT_TTL_MS = 5 * 60 * 1000;

export function createPairingState(opts: { authorizedChatId?: number | null } = {}): PairingState {
  return {
    phase: opts.authorizedChatId ? 'paired' : 'idle',
    code: null,
    pendingChatId: null,
    expiresAt: null,
    authorizedChatId: opts.authorizedChatId ?? null,
  };
}

/** Initiate a new pairing — called from the host (terminal). Returns the code to show the user. */
export function beginPairing(
  state: PairingState,
  now: number = Date.now(),
  ttlMs: number = DEFAULT_TTL_MS,
): { state: PairingState; code: string } {
  const code = randomCode(6);
  return {
    state: {
      ...state,
      phase: 'awaiting-code',
      code,
      pendingChatId: null,
      expiresAt: now + ttlMs,
    },
    code,
  };
}

/** Called when the bot receives a /start from chatId. */
export function handleStart(
  state: PairingState,
  chatId: number,
  now: number = Date.now(),
): PairingDecision {
  if (state.authorizedChatId === chatId && state.phase === 'paired') {
    return { state, action: { kind: 'still-paired', chatId } };
  }
  if (state.authorizedChatId !== null && state.authorizedChatId !== chatId) {
    return {
      state,
      action: { kind: 'reject', message: 'This bot is paired with a different chat. Access denied.' },
    };
  }
  if (state.phase !== 'awaiting-code' || !state.code) {
    return {
      state,
      action: {
        kind: 'reject',
        message:
          "Pairing not active. Run `moxxy telegram pair` in your terminal to start a pairing window, then send /start again.",
      },
    };
  }
  if (state.expiresAt !== null && now > state.expiresAt) {
    return {
      state: { ...state, phase: 'expired', code: null, expiresAt: null },
      action: { kind: 'reject', message: 'Pairing window expired. Re-run `moxxy telegram pair`.' },
    };
  }
  return {
    state: { ...state, pendingChatId: chatId },
    action: {
      kind: 'request-code',
      message: 'Pairing in progress. Send me the 6-digit code from your terminal.',
    },
  };
}

/** Called for every text message during awaiting-code phase. */
export function handleCode(
  state: PairingState,
  chatId: number,
  text: string,
  now: number = Date.now(),
): PairingDecision {
  if (state.authorizedChatId === chatId && state.phase === 'paired') {
    return { state, action: { kind: 'still-paired', chatId } };
  }
  if (state.phase !== 'awaiting-code' || !state.code) {
    return {
      state,
      action: { kind: 'reject', message: 'Not in a pairing window. Send /start to begin.' },
    };
  }
  if (state.expiresAt !== null && now > state.expiresAt) {
    return {
      state: { ...state, phase: 'expired', code: null, expiresAt: null },
      action: { kind: 'reject', message: 'Pairing window expired. Re-run `moxxy telegram pair`.' },
    };
  }
  if (state.pendingChatId !== null && state.pendingChatId !== chatId) {
    return {
      state,
      action: {
        kind: 'reject',
        message: 'Another chat started pairing first. Wait for it to expire and try again.',
      },
    };
  }
  const normalized = text.replace(/\s+/g, '');
  if (!/^\d{6}$/.test(normalized)) {
    return {
      state,
      action: { kind: 'wait', message: 'Send the 6-digit code (digits only).' },
    };
  }
  if (normalized !== state.code) {
    return {
      state,
      action: { kind: 'reject', message: "Code didn't match. Try again, or re-pair if expired." },
    };
  }
  return {
    state: {
      phase: 'paired',
      code: null,
      pendingChatId: null,
      expiresAt: null,
      authorizedChatId: chatId,
    },
    action: {
      kind: 'paired',
      message: `Paired ✅ — chat ${chatId} is now authorized. Send a prompt to begin.`,
      chatId,
    },
  };
}

export function isAuthorized(state: PairingState, chatId: number): boolean {
  return state.phase === 'paired' && state.authorizedChatId === chatId;
}

export function clearPairing(state: PairingState): PairingState {
  return {
    phase: 'idle',
    code: null,
    pendingChatId: null,
    expiresAt: null,
    authorizedChatId: null,
  };
}
