import { randomCode } from '@moxxy/plugin-vault';

/**
 * Pairing state machine — bot-issued code direction.
 *
 * Flow:
 *   1. Terminal opens a pairing window (`beginPairing`).
 *   2. User sends /start to the bot in Telegram (`handleStart`).
 *      The bot generates a 6-digit code and DMs it back to that chat.
 *   3. User reads the code in Telegram and pastes it into the moxxy
 *      terminal (`submitTerminalCode`). On match the chat is authorized.
 *
 * Why this direction (vs. the older "terminal shows code, user types it
 * in Telegram"): copying digits *out* of an auth-trusted device is the
 * natural pattern (Authy / Signal device-link / GitHub mobile all work
 * this way), and the terminal can validate the code synchronously
 * inside the wizard instead of waiting for a chat round-trip.
 */

export type PairingPhase =
  | 'idle'
  | 'awaiting-start'
  | 'awaiting-terminal'
  | 'paired'
  | 'expired';

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
    | { kind: 'issue-code'; message: string; code: string; chatId: number }
    | { kind: 'paired'; chatId: number }
    | { kind: 'still-paired'; chatId: number }
    | { kind: 'mismatch'; message: string }
    | { kind: 'expired'; message: string }
    | { kind: 'not-pending'; message: string }
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

/**
 * Open a pairing window from the terminal side. The state flips to
 * `awaiting-start`; no code is generated yet — the code is created when
 * /start arrives so it can be DM'd to the chat that initiated it.
 */
export function beginPairing(
  state: PairingState,
  now: number = Date.now(),
  ttlMs: number = DEFAULT_TTL_MS,
): PairingState {
  return {
    ...state,
    phase: 'awaiting-start',
    code: null,
    pendingChatId: null,
    expiresAt: now + ttlMs,
  };
}

/**
 * Called when the bot receives a /start from `chatId`.
 *
 * Behavior depends on phase:
 *   - paired (same chat)   → still-paired (already authorized; greet)
 *   - paired (other chat)  → reject (the bot is owned by someone else)
 *   - idle / expired       → reject with hint to run the wizard
 *   - awaiting-start       → generate code, transition to awaiting-terminal, return code to DM
 *   - awaiting-terminal    → re-issue the same code to the same chat;
 *                            tell a different chat to wait its turn
 */
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
  if (state.phase === 'idle' || state.phase === 'expired') {
    return {
      state,
      action: {
        kind: 'reject',
        message:
          'No pairing window is open. Run `moxxy channels telegram pair` in your terminal first, then send /start again.',
      },
    };
  }
  if (state.expiresAt !== null && now > state.expiresAt) {
    return {
      state: { ...state, phase: 'expired', code: null, pendingChatId: null, expiresAt: null },
      action: { kind: 'expired', message: 'Pairing window expired. Re-run `moxxy channels telegram pair`.' },
    };
  }
  if (state.phase === 'awaiting-terminal') {
    if (state.pendingChatId === chatId && state.code) {
      return {
        state,
        action: {
          kind: 'issue-code',
          chatId,
          code: state.code,
          message: 'Your pairing code is still active:',
        },
      };
    }
    return {
      state,
      action: {
        kind: 'wait',
        message:
          'Another chat started pairing first. Wait for that window to finish or expire, then try again.',
      },
    };
  }
  // awaiting-start → issue a new code for this chat. Preserve the
  // original expiry set by `beginPairing` so the user can't extend the
  // window by re-triggering /start.
  const code = randomCode(6);
  const nextState: PairingState = {
    ...state,
    phase: 'awaiting-terminal',
    code,
    pendingChatId: chatId,
  };
  return {
    state: nextState,
    action: {
      kind: 'issue-code',
      chatId,
      code,
      message:
        'Your pairing code is valid for 5 minutes. Paste it into the moxxy terminal to authorize this chat.',
    },
  };
}

/**
 * Called when the user pastes a code in the moxxy terminal.
 */
export function submitTerminalCode(
  state: PairingState,
  rawInput: string,
  now: number = Date.now(),
): PairingDecision {
  if (state.phase === 'paired' && state.authorizedChatId !== null) {
    return { state, action: { kind: 'still-paired', chatId: state.authorizedChatId } };
  }
  if (state.phase === 'idle') {
    return {
      state,
      action: { kind: 'not-pending', message: 'No pairing in progress.' },
    };
  }
  if (state.phase === 'awaiting-start') {
    return {
      state,
      action: {
        kind: 'not-pending',
        message: 'No /start received yet — open Telegram and send /start to your bot first.',
      },
    };
  }
  if (state.phase === 'expired' || (state.expiresAt !== null && now > state.expiresAt)) {
    return {
      state: { ...state, phase: 'expired', code: null, pendingChatId: null, expiresAt: null },
      action: { kind: 'expired', message: 'Pairing window expired. Re-run `moxxy channels telegram pair`.' },
    };
  }
  const normalized = rawInput.replace(/\s+/g, '');
  if (!/^\d{6}$/.test(normalized)) {
    return {
      state,
      action: { kind: 'mismatch', message: 'Enter the 6-digit code (digits only).' },
    };
  }
  if (normalized !== state.code || state.pendingChatId === null) {
    return {
      state,
      action: { kind: 'mismatch', message: "Code didn't match. Check the digits and try again." },
    };
  }
  return {
    state: {
      phase: 'paired',
      code: null,
      pendingChatId: null,
      expiresAt: null,
      authorizedChatId: state.pendingChatId,
    },
    action: { kind: 'paired', chatId: state.pendingChatId },
  };
}

export function isAuthorized(state: PairingState, chatId: number): boolean {
  return state.phase === 'paired' && state.authorizedChatId === chatId;
}

export function clearPairing(_state: PairingState): PairingState {
  return {
    phase: 'idle',
    code: null,
    pendingChatId: null,
    expiresAt: null,
    authorizedChatId: null,
  };
}
