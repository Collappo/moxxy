import { useCallback, useEffect, useSyncExternalStore } from 'react';
import { api } from './api';
import type { MoxxyEvent } from '@moxxy/sdk';
import { chatStore } from './chatStore';
import {
  chatReducer,
  initialChatState,
  type Block as ReducerBlock,
  type ChatAction as ReducerAction,
  type ChatState as ReducerState,
} from './chatReducer';

export type Block = ReducerBlock;
export type ChatAction = ReducerAction;
export type ChatState = ReducerState;

export interface UseChat {
  readonly blocks: ReadonlyArray<Block>;
  readonly activeTurnId: string | null;
  readonly sending: boolean;
  readonly error: string | null;
  readonly send: (
    prompt: string,
    attachments?: ReadonlyArray<{ path: string; name: string }>,
  ) => Promise<void>;
  readonly abort: () => Promise<void>;
  readonly clear: () => void;
}

// Test-only export of the pure reducer + initial state. Preserved so
// existing reducer tests keep working after the chatStore refactor.
// eslint-disable-next-line @typescript-eslint/naming-convention
export const __reducerForTest = {
  initial: () => initialChatState,
  apply: chatReducer,
};

/** Fire a turn against the runner without queueing checks. Shared by
 *  the public `useChat().send` and the queue drainer. */
async function sendImmediate(
  workspaceId: string,
  prompt: string,
  attachments?: ReadonlyArray<{ path: string; name: string }>,
): Promise<void> {
  const model = chatStore.getModel(workspaceId);
  try {
    const { turnId } = await api().invoke('session.runTurn', {
      workspaceId,
      prompt,
      ...(model ? { model } : {}),
      ...(attachments && attachments.length > 0 ? { attachments } : {}),
    });
    chatStore.dispatch(workspaceId, {
      type: 'send_started',
      turnId,
      prompt,
      ...(attachments && attachments.length > 0 ? { attachments } : {}),
    });
  } catch (e) {
    chatStore.dispatch(workspaceId, {
      type: 'send_failed',
      message: e instanceof Error ? e.message : String(e),
    });
  }
}

/**
 * Bridge component — forwards `runner.event` / `runner.turn.complete`
 * from the main process into the workspace-keyed {@link chatStore},
 * drains the per-workspace queue when a turn completes, and
 * rehydrates the persisted conversation on first mount so transcripts
 * survive restarts.
 */
export function ChatStoreBridge(): null {
  useEffect(() => {
    chatStore.hydrate();
    const offEvent = api().subscribe(
      'runner.event',
      ({ workspaceId, event }: { workspaceId: string; event: MoxxyEvent }) => {
        chatStore.dispatch(workspaceId, { type: 'event', event });
      },
    );
    const offComplete = api().subscribe(
      'runner.turn.complete',
      ({
        workspaceId,
        turnId,
        error,
      }: {
        workspaceId: string;
        turnId: string;
        error: string | null;
      }) => {
        chatStore.dispatch(workspaceId, { type: 'turn_complete', turnId, error });
        // Drain one queued turn (if any). The next turn.complete will
        // drain the one after that, etc.
        const next = chatStore.shiftQueue(workspaceId);
        if (next) {
          void sendImmediate(workspaceId, next.prompt, next.attachments);
        }
      },
    );
    return () => {
      offEvent();
      offComplete();
    };
  }, []);
  return null;
}

/** Read the queue snapshot for a workspace. Used by the composer to
 *  render the pending-sends preview. */
export function useQueuedTurns(
  workspaceId: string | null,
): ReadonlyArray<{ readonly id: string; readonly prompt: string }> {
  return useSyncExternalStore(chatStore.subscribe, () =>
    workspaceId ? chatStore.getQueue(workspaceId) : [],
  );
}

/**
 * Per-workspace chat handle. Send/abort/clear are bound to the
 * workspace so the UI can also target background workspaces (start
 * a follow-up turn in A while viewing B).
 */
export function useChat(workspaceId: string | null): UseChat {
  const state = useSyncExternalStore(chatStore.subscribe, () =>
    workspaceId ? chatStore.getChat(workspaceId) : initialChatState,
  );

  const send = useCallback(
    async (
      prompt: string,
      attachments?: ReadonlyArray<{ path: string; name: string }>,
    ): Promise<void> => {
      if (!workspaceId) return;
      const trimmed = prompt.trim();
      if (!trimmed && (!attachments || attachments.length === 0)) return;
      // If a turn is already running for this workspace, queue this
      // one instead of firing it immediately. The QueueDrainer (in
      // ChatStoreBridge) pops the queue on turn_complete and sends
      // the next one — same path as if the user had hit Enter
      // manually right after the previous turn finished.
      const cur = chatStore.getChat(workspaceId);
      if (cur.activeTurnId !== null || cur.sending) {
        chatStore.enqueue(workspaceId, trimmed, attachments);
        return;
      }
      await sendImmediate(workspaceId, trimmed, attachments);
    },
    [workspaceId],
  );

  const abort = useCallback(async (): Promise<void> => {
    if (!workspaceId || !state.activeTurnId) return;
    try {
      await api().invoke('session.abortTurn', {
        workspaceId,
        turnId: state.activeTurnId,
      });
    } catch {
      /* best-effort */
    }
  }, [workspaceId, state.activeTurnId]);

  const clear = useCallback((): void => {
    if (!workspaceId) return;
    // Use the store's clear() rather than dispatching a 'clear'
    // action so the persisted localStorage blob is removed in the
    // same step.
    chatStore.clear(workspaceId);
  }, [workspaceId]);

  return {
    blocks: state.blocks,
    activeTurnId: state.activeTurnId,
    sending: state.sending,
    error: state.error,
    send,
    abort,
    clear,
  };
}

/** Snapshot of workspace ids that currently carry unread activity. */
export function useUnreadWorkspaces(): ReadonlyArray<string> {
  return useSyncExternalStore(chatStore.subscribe, () =>
    chatStore.unreadWorkspaces(),
  );
}
