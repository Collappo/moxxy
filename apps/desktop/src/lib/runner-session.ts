import { useEffect, useReducer, useRef } from 'react';
import { invoke, subscribe } from './tauri';

/**
 * One transcript "block" the chat surface renders. The runner streams
 * many MoxxyEvent variants; for Phase 1 we coalesce them into three
 * UI-shaped blocks (user / assistant chunks / tool activity). Later
 * phases extend the renderer with the full variant set.
 */
export type Block =
  | { readonly id: string; readonly kind: 'user'; readonly text: string }
  | {
      readonly id: string;
      readonly kind: 'assistant';
      readonly text: string;
      readonly streaming: boolean;
    }
  | {
      readonly id: string;
      readonly kind: 'tool';
      readonly name: string;
      readonly status: 'running' | 'done' | 'error';
    };

export interface RunnerSession {
  readonly ready: boolean;
  readonly blocks: ReadonlyArray<Block>;
  readonly activeTurnId: string | null;
  readonly error: string | null;
  /** Send a prompt. Resolves once the runner accepts the turn. */
  readonly send: (prompt: string) => Promise<void>;
  /** Abort the active turn, if any. */
  readonly abort: () => Promise<void>;
}

/**
 * Subset of runner event shapes the Phase 1 reducer needs. The runner
 * streams much richer events; unknown kinds are ignored without error so
 * the desktop stays forward-compatible as new event types ship.
 */
interface RunnerEvent {
  kind?: string;
  text?: string;
  toolCall?: { name?: string; status?: 'running' | 'done' | 'error' };
}

type Action =
  | { type: 'ready'; value: boolean }
  | { type: 'sent'; turnId: string; prompt: string }
  | { type: 'event'; event: RunnerEvent }
  | { type: 'complete'; turnId: string; error?: string | null }
  | { type: 'error'; message: string };

interface State {
  ready: boolean;
  blocks: Block[];
  activeTurnId: string | null;
  error: string | null;
  /** Id of the streaming assistant block, if one is open. */
  streamingAssistantId: string | null;
  nextId: number;
}

const initialState: State = {
  ready: false,
  blocks: [],
  activeTurnId: null,
  error: null,
  streamingAssistantId: null,
  nextId: 1,
};

function reducer(state: State, action: Action): State {
  switch (action.type) {
    case 'ready':
      return { ...state, ready: action.value };
    case 'sent': {
      const userBlockId = `b${state.nextId}`;
      return {
        ...state,
        activeTurnId: action.turnId,
        error: null,
        blocks: [
          ...state.blocks,
          { id: userBlockId, kind: 'user', text: action.prompt },
        ],
        streamingAssistantId: null,
        nextId: state.nextId + 1,
      };
    }
    case 'event': {
      const { event } = action;
      // Assistant text chunk: append to the open streaming block, or
      // open a fresh one if none is in flight.
      if (event.kind === 'chunk' && typeof event.text === 'string') {
        if (state.streamingAssistantId) {
          return {
            ...state,
            blocks: state.blocks.map((b) =>
              b.id === state.streamingAssistantId && b.kind === 'assistant'
                ? { ...b, text: b.text + (event.text ?? '') }
                : b,
            ),
          };
        }
        const id = `b${state.nextId}`;
        return {
          ...state,
          blocks: [
            ...state.blocks,
            { id, kind: 'assistant', text: event.text, streaming: true },
          ],
          streamingAssistantId: id,
          nextId: state.nextId + 1,
        };
      }
      // Tool activity strip — runs as a side block, doesn't break the
      // streaming assistant block. Unknown statuses default to 'running'.
      if (event.kind === 'tool' && event.toolCall?.name) {
        const id = `b${state.nextId}`;
        return {
          ...state,
          blocks: [
            ...state.blocks,
            {
              id,
              kind: 'tool',
              name: event.toolCall.name,
              status: event.toolCall.status ?? 'running',
            },
          ],
          nextId: state.nextId + 1,
        };
      }
      return state;
    }
    case 'complete': {
      // Close any open streaming block; record any error.
      return {
        ...state,
        activeTurnId: null,
        streamingAssistantId: null,
        error: action.error ?? null,
        blocks: state.blocks.map((b) =>
          b.id === state.streamingAssistantId && b.kind === 'assistant'
            ? { ...b, streaming: false }
            : b,
        ),
      };
    }
    case 'error':
      return { ...state, error: action.message };
    default:
      return state;
  }
}

/**
 * Hook that turns the Tauri command surface + event stream into a single
 * declarative state for the chat UI. Subscribes on mount, drains its
 * listeners on unmount.
 */
export function useRunnerSession(): RunnerSession {
  const [state, dispatch] = useReducer(reducer, initialState);
  // Keep refs to dispatch + state so the imperative `send` / `abort`
  // callbacks below don't change identity on every render.
  const dispatchRef = useRef(dispatch);
  dispatchRef.current = dispatch;
  const activeTurnRef = useRef<string | null>(null);
  activeTurnRef.current = state.activeTurnId;

  useEffect(() => {
    let cancelled = false;

    void invoke<boolean>('runner_ready')
      .then((ready) => {
        if (!cancelled) dispatchRef.current({ type: 'ready', value: ready });
      })
      .catch(() => {
        /* defensive — leave default */
      });

    const unsubs: Array<Promise<() => void>> = [
      subscribe<boolean>('runner.ready', (v) =>
        dispatchRef.current({ type: 'ready', value: v }),
      ),
      subscribe<RunnerEvent>('runner.event', (event) =>
        dispatchRef.current({ type: 'event', event }),
      ),
      subscribe<{ turnId: string; error?: string | null }>(
        'runner.turn.complete',
        (payload) =>
          dispatchRef.current({
            type: 'complete',
            turnId: payload.turnId,
            error: payload.error ?? null,
          }),
      ),
      subscribe<string>('runner.error', (message) =>
        dispatchRef.current({ type: 'error', message }),
      ),
    ];

    return () => {
      cancelled = true;
      for (const u of unsubs) {
        void u.then((fn) => fn());
      }
    };
  }, []);

  return {
    ready: state.ready,
    blocks: state.blocks,
    activeTurnId: state.activeTurnId,
    error: state.error,
    send: async (prompt: string) => {
      const text = prompt.trim();
      if (!text) return;
      const turnId = await invoke<string>('run_turn', { args: { prompt: text } });
      dispatchRef.current({ type: 'sent', turnId, prompt: text });
    },
    abort: async () => {
      const turnId = activeTurnRef.current;
      if (!turnId) return;
      await invoke('abort_turn', { turnId });
    },
  };
}
