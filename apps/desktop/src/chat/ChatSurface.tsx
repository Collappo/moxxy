import { useChat } from '@/lib/useChat';
import type { ConnectionPhase } from '@shared/ipc';
import { StatusLine } from './StatusLine';
import { Transcript } from './Transcript';
import { Composer } from './Composer';

interface ChatSurfaceProps {
  readonly phase: ConnectionPhase;
}

/**
 * Full chat pane assembled from StatusLine + Transcript + Composer.
 * Reads the runner event stream via `useChat`, runs turns via
 * `session.runTurn` over IPC.
 */
export function ChatSurface({ phase }: ChatSurfaceProps): JSX.Element {
  const chat = useChat();
  const ready = phase.phase === 'connected';

  return (
    <main
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100vh',
        background: 'var(--color-bg)',
      }}
    >
      <StatusLine phase={phase} />
      {chat.blocks.length === 0 ? (
        <EmptyState ready={ready} />
      ) : (
        <Transcript blocks={chat.blocks} />
      )}
      <Composer
        ready={ready}
        sending={chat.sending}
        activeTurnId={chat.activeTurnId}
        onSend={(p) => void chat.send(p)}
        onAbort={() => void chat.abort()}
      />
      {chat.error && (
        <div
          role="alert"
          style={{
            position: 'absolute',
            left: '50%',
            bottom: 120,
            transform: 'translateX(-50%)',
            padding: '0.5rem 0.9rem',
            background: 'var(--color-pink)',
            color: 'var(--color-bg)',
            borderRadius: 'var(--radius-block)',
            fontSize: '0.85rem',
            boxShadow: '0 18px 40px -22px #14163229',
          }}
        >
          {chat.error}
        </div>
      )}
    </main>
  );
}

function EmptyState({ ready }: { readonly ready: boolean }): JSX.Element {
  return (
    <div
      style={{
        flex: 1,
        display: 'grid',
        placeItems: 'center',
        padding: '2rem',
        textAlign: 'center',
      }}
    >
      <div>
        <h2 style={{ margin: 0, fontSize: '1.4rem' }}>
          <span className="grad-text">moxxy is ready</span>
        </h2>
        <p style={{ margin: '0.4rem 0 0', color: 'var(--color-text-dim)' }}>
          {ready
            ? 'Type a prompt below to start your first turn.'
            : 'Waiting for the runner to come online…'}
        </p>
      </div>
    </div>
  );
}
