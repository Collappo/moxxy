import { useCallback, useRef, useState, type KeyboardEvent } from 'react';

interface ComposerProps {
  readonly ready: boolean;
  readonly sending: boolean;
  readonly activeTurnId: string | null;
  readonly onSend: (prompt: string) => void;
  readonly onAbort: () => void;
}

/**
 * Multi-line composer:
 *
 *   ⌘↵ / Ctrl+↵   submit
 *   Shift+↵       newline
 *   Esc           clear draft
 *
 * Send swaps to Abort while a turn is in flight.
 */
export function Composer({
  ready,
  sending,
  activeTurnId,
  onSend,
  onAbort,
}: ComposerProps): JSX.Element {
  const [draft, setDraft] = useState('');
  const taRef = useRef<HTMLTextAreaElement>(null);
  const inFlight = activeTurnId !== null || sending;
  const canSubmit = ready && !inFlight && draft.trim().length > 0;

  const submit = useCallback(() => {
    if (!canSubmit) return;
    onSend(draft);
    setDraft('');
  }, [canSubmit, draft, onSend]);

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>): void => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      submit();
      return;
    }
    if (e.key === 'Escape') {
      e.preventDefault();
      setDraft('');
    }
  };

  return (
    <form
      data-testid="composer"
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
      style={{
        padding: '0.85rem 2rem 1rem',
        background: 'var(--color-bg)',
        borderTop: '1px solid var(--color-border)',
        display: 'flex',
        gap: '0.5rem',
        alignItems: 'flex-end',
      }}
    >
      <div
        style={{
          flex: 1,
          display: 'flex',
          flexDirection: 'column',
          gap: '0.25rem',
        }}
      >
        <textarea
          ref={taRef}
          data-testid="composer-input"
          aria-label="prompt"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder={ready ? 'Ask anything…' : 'Waiting for runner…'}
          disabled={!ready || inFlight}
          rows={Math.min(8, Math.max(1, draft.split('\n').length))}
          style={{
            width: '100%',
            resize: 'none',
            padding: '0.55rem 0.8rem',
            fontSize: '0.95rem',
            lineHeight: 1.5,
            color: 'var(--color-text)',
            background: 'var(--color-bg-card)',
            border: '1px solid var(--color-border)',
            borderRadius: 'var(--radius-block)',
            fontFamily: 'inherit',
            outline: 'none',
          }}
        />
        <div
          className="mono"
          style={{
            fontSize: '0.65rem',
            color: 'var(--color-text-dim)',
            display: 'flex',
            justifyContent: 'space-between',
          }}
        >
          <span>{draft.length} chars</span>
          <span>⌘↵ to send · Esc to clear · Shift+↵ newline</span>
        </div>
      </div>
      {inFlight ? (
        <button
          type="button"
          data-testid="composer-abort"
          onClick={onAbort}
          style={btnStyle('var(--color-pink)', true)}
        >
          Abort
        </button>
      ) : (
        <button
          type="submit"
          data-testid="composer-send"
          disabled={!canSubmit}
          style={btnStyle('var(--color-primary)', canSubmit)}
        >
          Send
        </button>
      )}
    </form>
  );
}

function btnStyle(bg: string, enabled: boolean): React.CSSProperties {
  return {
    padding: '0.5rem 0.9rem',
    background: bg,
    color: 'var(--color-bg)',
    borderRadius: 'var(--radius-block)',
    fontWeight: 600,
    opacity: enabled ? 1 : 0.4,
  };
}
