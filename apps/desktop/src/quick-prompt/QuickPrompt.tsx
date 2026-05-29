import { useEffect, useRef, useState } from 'react';
import { invoke, subscribe } from '@/lib/tauri';

/**
 * The 480×140 tray-spawned window. Single-line composer that fires a
 * turn against the main window's runner (so the result is also visible
 * in the main transcript when the user pops it open). The response's
 * first 6 lines render inline; clicking opens the main window.
 */
export function QuickPrompt(): JSX.Element {
  const [draft, setDraft] = useState('');
  const [pending, setPending] = useState(false);
  const [reply, setReply] = useState<string>('');
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    // Listen for chunks addressed to the main window — quick prompt
    // doesn't have its own runner, it borrows the primary.
    const unsubs = [
      subscribe<{ kind?: string; text?: string }>('runner.event', (event) => {
        if (event.kind === 'chunk' && typeof event.text === 'string') {
          setReply((r) => r + event.text);
        }
      }),
      subscribe<{ turnId: string; error?: string | null }>(
        'runner.turn.complete',
        (payload) => {
          setPending(false);
          if (payload.error) setError(payload.error);
        },
      ),
    ];
    return () => {
      for (const u of unsubs) void u.then((fn) => fn());
    };
  }, []);

  const submit = async (): Promise<void> => {
    if (!draft.trim() || pending) return;
    setError(null);
    setReply('');
    setPending(true);
    try {
      await invoke<string>('run_turn', {
        args: { prompt: draft.trim(), window: 'main' },
      });
      setDraft('');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setPending(false);
    }
  };

  return (
    <div
      data-testid="quick-prompt"
      style={{
        position: 'absolute',
        inset: 0,
        padding: '0.6rem 0.75rem',
        background: 'var(--color-bg)',
        color: 'var(--color-text)',
        display: 'flex',
        flexDirection: 'column',
        gap: '0.4rem',
        borderRadius: 12,
        boxShadow: 'var(--elev)',
      }}
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
        style={{ display: 'flex', gap: '0.4rem' }}
      >
        <input
          data-testid="quick-prompt-input"
          ref={inputRef}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="Quick prompt…"
          disabled={pending}
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              setDraft('');
              setReply('');
              setError(null);
            }
          }}
          style={{
            flex: 1,
            padding: '0.4rem 0.6rem',
            fontSize: '0.85rem',
            background: 'var(--color-bg-card)',
            color: 'var(--color-text)',
            border: '1px solid var(--color-border)',
            borderRadius: 'var(--radius-block)',
            outline: 'none',
          }}
        />
        <button
          type="submit"
          data-testid="quick-prompt-send"
          disabled={!draft.trim() || pending}
          style={{
            padding: '0 0.7rem',
            fontSize: '0.85rem',
            color: 'var(--color-bg)',
            background: 'var(--color-primary)',
            borderRadius: 'var(--radius-block)',
            fontWeight: 600,
            opacity: !draft.trim() || pending ? 0.4 : 1,
          }}
        >
          {pending ? '…' : '↵'}
        </button>
      </form>
      <pre
        data-testid="quick-prompt-reply"
        className="mono"
        style={{
          margin: 0,
          fontSize: '0.75rem',
          color: 'var(--color-text-muted)',
          maxHeight: 90,
          overflow: 'hidden',
          whiteSpace: 'pre-wrap',
        }}
      >
        {error ? error : reply || ''}
      </pre>
    </div>
  );
}
