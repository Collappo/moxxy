import type { Block } from '@/lib/useChat';

/**
 * One transcript block. Kept as a tiny component-per-kind so a
 * future markdown renderer / tool-input inspector slots in without
 * touching the parent.
 */
export function BlockView({ block }: { readonly block: Block }): JSX.Element {
  switch (block.kind) {
    case 'user':
      return <UserBlock text={block.text} />;
    case 'assistant':
      return (
        <AssistantBlock
          text={block.text}
          streaming={block.streaming}
          stopReason={block.stopReason}
        />
      );
    case 'tool':
      return (
        <ToolBlock
          name={block.name}
          input={block.input}
          status={block.status}
          output={block.output}
          error={block.error}
        />
      );
    case 'system':
      return <SystemBlock text={block.text} tone={block.tone} />;
  }
}

function UserBlock({ text }: { readonly text: string }): JSX.Element {
  return (
    <div
      data-testid="block-user"
      style={{
        alignSelf: 'flex-end',
        maxWidth: '70%',
        padding: '0.55rem 0.85rem',
        background: 'var(--color-bg-card)',
        border: '1px solid var(--color-border)',
        borderRadius: 'var(--radius-block)',
        whiteSpace: 'pre-wrap',
      }}
    >
      {text}
    </div>
  );
}

function AssistantBlock({
  text,
  streaming,
  stopReason,
}: {
  readonly text: string;
  readonly streaming: boolean;
  readonly stopReason?: string;
}): JSX.Element {
  return (
    <div
      data-testid="block-assistant"
      data-streaming={streaming}
      style={{
        maxWidth: '90%',
        padding: '0.75rem 1rem',
        background: 'var(--color-bg-card)',
        border: '1px solid var(--color-border)',
        borderRadius: 'var(--radius-block)',
        whiteSpace: 'pre-wrap',
        lineHeight: 1.7,
      }}
    >
      {text}
      {streaming && (
        <span
          aria-hidden
          style={{ marginLeft: 4, color: 'var(--color-primary)' }}
        >
          ▍
        </span>
      )}
      {stopReason && stopReason !== 'end_turn' && (
        <span
          className="mono"
          style={{
            display: 'block',
            marginTop: '0.4rem',
            fontSize: '0.65rem',
            color: 'var(--color-text-dim)',
            textTransform: 'uppercase',
            letterSpacing: '0.06em',
          }}
        >
          stop: {stopReason.replace(/_/g, ' ')}
        </span>
      )}
    </div>
  );
}

function ToolBlock({
  name,
  input,
  status,
  output,
  error,
}: {
  readonly name: string;
  readonly input: unknown;
  readonly status: 'running' | 'ok' | 'error';
  readonly output?: unknown;
  readonly error?: string;
}): JSX.Element {
  const accent =
    status === 'error'
      ? 'var(--color-pink)'
      : status === 'ok'
        ? 'var(--color-green)'
        : 'var(--color-primary)';
  const summary = summarise(input);
  return (
    <details
      data-testid="block-tool"
      data-status={status}
      className="mono"
      style={{
        alignSelf: 'flex-start',
        maxWidth: '90%',
        fontSize: '0.75rem',
        color: 'var(--color-text-dim)',
        borderLeft: `2px solid ${accent}`,
        paddingLeft: '0.5rem',
      }}
    >
      <summary
        style={{
          cursor: 'pointer',
          display: 'flex',
          gap: '0.4rem',
          alignItems: 'baseline',
        }}
      >
        <span style={{ color: accent }}>[{status}]</span>
        <span style={{ color: 'var(--color-text-muted)' }}>{name}</span>
        {summary && (
          <span
            style={{
              opacity: 0.7,
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              maxWidth: 360,
            }}
          >
            {summary}
          </span>
        )}
      </summary>
      <div
        style={{
          marginTop: '0.4rem',
          display: 'flex',
          flexDirection: 'column',
          gap: '0.3rem',
        }}
      >
        <pre style={preStyle}>{stringify(input)}</pre>
        {output !== undefined && <pre style={preStyle}>{stringify(output)}</pre>}
        {error && <pre style={{ ...preStyle, color: 'var(--color-pink)' }}>{error}</pre>}
      </div>
    </details>
  );
}

function SystemBlock({
  text,
  tone,
}: {
  readonly text: string;
  readonly tone: 'info' | 'error';
}): JSX.Element {
  const color = tone === 'error' ? 'var(--color-pink)' : 'var(--color-text-dim)';
  return (
    <div
      data-testid="block-system"
      role={tone === 'error' ? 'alert' : 'status'}
      className="mono"
      style={{
        alignSelf: 'center',
        fontSize: '0.7rem',
        padding: '0.3rem 0.6rem',
        color,
        textTransform: 'lowercase',
        letterSpacing: '0.04em',
        opacity: 0.85,
      }}
    >
      — {text} —
    </div>
  );
}

const preStyle: React.CSSProperties = {
  margin: 0,
  padding: '0.4rem 0.5rem',
  background: 'var(--color-bg)',
  border: '1px solid var(--color-border)',
  borderRadius: 4,
  fontSize: '0.7rem',
  whiteSpace: 'pre-wrap',
  wordBreak: 'break-word',
  maxHeight: 280,
  overflow: 'auto',
};

function summarise(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value.length > 80 ? value.slice(0, 80) + '…' : value;
  try {
    const stringified = JSON.stringify(value);
    return stringified.length > 80 ? stringified.slice(0, 80) + '…' : stringified;
  } catch {
    return '';
  }
}

function stringify(value: unknown): string {
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}
