import { useCallback, useEffect, useState } from 'react';
import { api } from './api';
import type { ConnectionPhase, ConnectionSnapshot } from '@shared/ipc';

/**
 * Subscribes to the supervisor's `connection.changed` stream and
 * also fetches a one-shot snapshot on mount so late mounts don't
 * miss the initial phase.
 */
export interface UseConnection {
  readonly snapshot: ConnectionSnapshot | null;
  readonly retry: () => Promise<void>;
}

export function useConnection(): UseConnection {
  const [snapshot, setSnapshot] = useState<ConnectionSnapshot | null>(null);

  useEffect(() => {
    let cancelled = false;

    void api()
      .invoke('connection.snapshot')
      .then((s) => {
        if (!cancelled) setSnapshot(s);
      })
      .catch(() => {
        /* preload missing — leave null */
      });

    const unsub = api().subscribe('connection.changed', (phase: ConnectionPhase) => {
      setSnapshot((prev) => {
        if (prev) return { ...prev, phase };
        return {
          phase,
          cliPath: null,
          attempts: 0,
          log: [],
        };
      });
    });

    return () => {
      cancelled = true;
      unsub();
    };
  }, []);

  const retry = useCallback(async () => {
    try {
      await api().invoke('connection.retry');
    } catch {
      /* best-effort */
    }
  }, []);

  return { snapshot, retry };
}

export function isConnected(phase: ConnectionPhase | undefined): boolean {
  return phase?.phase === 'connected';
}
