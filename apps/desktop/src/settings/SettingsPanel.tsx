import { useState } from 'react';
import { useSettings } from '@/lib/useSettings';
import { Skeleton } from '@/lib/Skeleton';
import { SkillsView } from './SkillsView';

type Tab = 'providers' | 'mcp' | 'skills' | 'vault';

/**
 * Tabbed settings panel — providers, MCP servers, skills, vault. Each
 * tab reads its slice via `useSettings` and only the active tab does
 * heavy work (the IPC fan-out happens on refresh; tab switch is just
 * filtering the rendered view).
 */
export function SettingsPanel(): JSX.Element {
  const s = useSettings();
  const [tab, setTab] = useState<Tab>('providers');

  return (
    <main
      style={{
        flex: 1,
        overflowY: 'auto',
        padding: '1.5rem 2rem',
        display: 'flex',
        flexDirection: 'column',
        gap: '1rem',
      }}
    >
      <header style={{ display: 'flex', alignItems: 'baseline', gap: '1rem' }}>
        <h1 style={{ margin: 0, fontSize: '1.25rem', fontWeight: 700 }}>
          Settings
        </h1>
        <nav style={{ display: 'flex', gap: '0.25rem' }}>
          {(['providers', 'mcp', 'skills', 'vault'] as const).map((t) => (
            <button
              key={t}
              type="button"
              data-testid={`settings-tab-${t}`}
              data-active={tab === t}
              onClick={() => setTab(t)}
              style={{
                padding: '0.3rem 0.7rem',
                fontSize: '0.8rem',
                color: tab === t ? 'var(--color-text)' : 'var(--color-text-muted)',
                borderBottom:
                  tab === t
                    ? '2px solid var(--color-primary)'
                    : '2px solid transparent',
              }}
            >
              {t}
            </button>
          ))}
        </nav>
        <button
          type="button"
          onClick={() => void s.refresh()}
          style={{
            marginLeft: 'auto',
            fontSize: '0.75rem',
            color: 'var(--color-text-dim)',
            border: '1px solid var(--color-border)',
            borderRadius: 'var(--radius-block)',
            padding: '0.2rem 0.55rem',
          }}
        >
          Refresh
        </button>
      </header>
      {s.error && (
        <p
          role="alert"
          style={{
            margin: 0,
            padding: '0.45rem 0.65rem',
            border: '1px solid var(--color-pink)',
            background: 'color-mix(in oklab, var(--color-pink) 12%, transparent)',
            borderRadius: 'var(--radius-block)',
            fontSize: '0.85rem',
          }}
        >
          {s.error}
        </p>
      )}
      {s.loading ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
          <Skeleton.Card />
          <Skeleton.Card />
          <Skeleton.Card />
        </div>
      ) : (
        <>
          {tab === 'providers' && <ProvidersTab providers={s.providers} />}
          {tab === 'mcp' && <McpTab servers={s.mcp} onToggle={s.toggleMcp} />}
          {tab === 'skills' && <SkillsView s={s} />}
          {tab === 'vault' && <VaultTab vault={s.vault} />}
        </>
      )}
    </main>
  );
}

function ProvidersTab({
  providers,
}: {
  readonly providers: ReturnType<typeof useSettings>['providers'];
}): JSX.Element {
  if (providers.length === 0) {
    return <EmptyNote>No providers known to the connected runner.</EmptyNote>;
  }
  return (
    <CardList>
      {providers.map((p) => (
        <RowCard
          key={p.name}
          title={p.name}
          badge={
            <Badge tone={p.ready ? 'ok' : 'muted'}>{p.ready ? 'Ready' : 'Not ready'}</Badge>
          }
        />
      ))}
    </CardList>
  );
}

function McpTab({
  servers,
  onToggle,
}: {
  readonly servers: ReadonlyArray<{ name: string; enabled: boolean; connected: boolean }>;
  readonly onToggle: (name: string, enabled: boolean) => Promise<void>;
}): JSX.Element {
  if (servers.length === 0) {
    return <EmptyNote>No MCP servers configured.</EmptyNote>;
  }
  return (
    <CardList>
      {servers.map((srv) => (
        <RowCard
          key={srv.name}
          testId={`mcp-row-${srv.name}`}
          title={srv.name}
          subtitle={`${srv.enabled ? 'enabled' : 'disabled'} · ${srv.connected ? 'connected' : 'detached'}`}
          badge={
            srv.connected ? <Badge tone="ok">Connected</Badge> : <Badge tone="muted">Detached</Badge>
          }
          action={
            <ToggleButton enabled={srv.enabled} onClick={() => void onToggle(srv.name, !srv.enabled)} />
          }
        />
      ))}
    </CardList>
  );
}

function VaultTab({
  vault,
}: {
  readonly vault: ReadonlyArray<{ name: string }>;
}): JSX.Element {
  return (
    <>
      <EmptyNote>Vault entries — names only; values are encrypted at rest by the moxxy CLI.</EmptyNote>
      {vault.length > 0 && (
        <CardList>
          {vault.map((v) => (
            <RowCard key={v.name} title={v.name} mono badge={<Badge tone="muted">Encrypted</Badge>} />
          ))}
        </CardList>
      )}
    </>
  );
}

// ---- shared card primitives ----------------------------------------------

function CardList({ children }: { readonly children: React.ReactNode }): JSX.Element {
  return (
    <ul
      role="list"
      style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 8 }}
    >
      {children}
    </ul>
  );
}

function RowCard({
  title,
  subtitle,
  badge,
  action,
  mono,
  testId,
}: {
  readonly title: string;
  readonly subtitle?: string;
  readonly badge?: React.ReactNode;
  readonly action?: React.ReactNode;
  readonly mono?: boolean;
  readonly testId?: string;
}): JSX.Element {
  return (
    <li
      {...(testId ? { 'data-testid': testId } : {})}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        padding: '12px 14px',
        background: 'var(--color-card-bg)',
        border: '1px solid var(--color-card-border)',
        borderRadius: 12,
      }}
    >
      <div style={{ flex: 1, minWidth: 0 }}>
        <div
          className={mono ? 'mono' : undefined}
          style={{
            fontSize: 13.5,
            fontWeight: 600,
            color: 'var(--color-text)',
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
          }}
        >
          {title}
        </div>
        {subtitle && (
          <div className="mono" style={{ fontSize: 11, color: 'var(--color-text-dim)', marginTop: 2 }}>
            {subtitle}
          </div>
        )}
      </div>
      {badge}
      {action}
    </li>
  );
}

type BadgeTone = 'ok' | 'muted' | 'warn' | 'error';

function Badge({ tone, children }: { readonly tone: BadgeTone; readonly children: React.ReactNode }): JSX.Element {
  const palette: Record<BadgeTone, { bg: string; fg: string }> = {
    ok: { bg: '#ecfdf5', fg: 'var(--color-green)' },
    muted: { bg: 'rgba(148, 163, 184, 0.16)', fg: 'var(--color-text-muted)' },
    warn: { bg: '#fffbeb', fg: 'var(--color-amber)' },
    error: { bg: '#fef2f2', fg: 'var(--color-red)' },
  };
  const c = palette[tone];
  return (
    <span
      style={{
        flexShrink: 0,
        fontSize: 10.5,
        fontWeight: 700,
        textTransform: 'uppercase',
        letterSpacing: '0.04em',
        padding: '3px 9px',
        borderRadius: 999,
        background: c.bg,
        color: c.fg,
      }}
    >
      {children}
    </span>
  );
}

function ToggleButton({
  enabled,
  onClick,
}: {
  readonly enabled: boolean;
  readonly onClick: () => void;
}): JSX.Element {
  return (
    <button
      type="button"
      className="btn-chip"
      onClick={onClick}
      style={{
        flexShrink: 0,
        fontSize: 12,
        fontWeight: 600,
        padding: '5px 12px',
        borderRadius: 999,
        border: enabled ? '1px solid transparent' : '1px solid var(--color-card-border)',
        background: enabled ? 'var(--color-primary-soft)' : '#fff',
        color: enabled ? 'var(--color-primary-strong)' : 'var(--color-text-muted)',
      }}
    >
      {enabled ? 'Disable' : 'Enable'}
    </button>
  );
}

function EmptyNote({ children }: { readonly children: React.ReactNode }): JSX.Element {
  return (
    <p style={{ margin: 0, fontSize: 13, color: 'var(--color-text-dim)', lineHeight: 1.6 }}>{children}</p>
  );
}
