/**
 * Test-only shim: re-exports the pure reducer + initial state from
 * `useChat.ts` so tests can exercise the state machine without a
 * React render. The reducer lives module-private inside useChat.ts
 * to keep its surface tight — this re-export is the seam.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
import * as mod from './useChat';

interface Internals {
  initial: () => unknown;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  apply: (state: any, action: any) => any;
}

export const reducerForTest: Internals = ((): Internals => {
  // Pull the internals via a tiny test-only export pattern: useChat
  // exports symbols at runtime for the test module. We attach them
  // here in module load order.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const m = mod as unknown as { __reducerForTest?: Internals };
  if (!m.__reducerForTest) {
    throw new Error(
      'useChat module did not expose __reducerForTest — this is a test wiring bug.',
    );
  }
  return m.__reducerForTest;
})();
