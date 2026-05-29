/**
 * FocusWidget — the floating mini surface.
 *
 * Three stages:
 *
 *   1. INACTIVE  44×44   Small square with the moxxy mark.
 *                        Click → ACTIVE.
 *
 *   2. ACTIVE    220×56  Mark + voice + text + restore-main + close.
 *                        Click mark → INACTIVE.
 *                        Click voice → MINI_VOICE.
 *                        Click text  → MINI_TEXT.
 *
 *   3. MINI      360×220 Compact panel for a single quick prompt.
 *                        Header has back-to-active + restore-main.
 *                        Body is either a text composer (mini-text)
 *                        or a push-to-talk button (mini-voice).
 *
 * Resizing happens by IPC: every stage transition sends focus.resize
 * to the main process which moves the BrowserWindow. Window position
 * is pinned by the main process (bottom-right corner OR centre,
 * depending on where the user dragged the widget).
 *
 * Inline styles throughout — we deliberately don't depend on any
 * external CSS file. Past regressions were stylesheet races where
 * the dot collapsed to 0×0 before focus.css finished parsing.
 */

import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { api } from '@/lib/api';
import { ChatStoreBridge, useChat } from '@/lib/useChat';
import { chatStore } from '@/lib/chatStore';
import { ConnectionBridge, useActiveWorkspaceId } from '@/lib/useConnection';

type Stage = 'inactive' | 'active' | 'mini-text' | 'mini-voice';

const SIZE: Record<Stage, { width: number; height: number }> = {
  inactive: { width: 44, height: 44 },
  active: { width: 220, height: 56 },
  'mini-text': { width: 360, height: 220 },
  'mini-voice': { width: 360, height: 220 },
};

// ---- Top-level wrapper ---------------------------------------------------

export function FocusWidget(): JSX.Element {
  const workspaceId = useActiveWorkspaceId();
  return (
    <>
      {/* Bridges receive IPC events and feed chatStore / connection
       *  state. They render null. Mounted at the top level so events
       *  flow even while we're sitting in inactive/active stages. */}
      <ConnectionBridge />
      <ChatStoreBridge />
      <Surface workspaceId={workspaceId} />
    </>
  );
}

function Surface({
  workspaceId,
}: {
  readonly workspaceId: string | null;
}): JSX.Element {
  const [stage, setStage] = useState<Stage>('inactive');

  // Tell the main process to resize the BrowserWindow whenever the
  // stage changes. Always runs (including on initial mount) so the
  // window grows from the seed 44×44 to its first stage's size.
  useEffect(() => {
    const { width, height } = SIZE[stage];
    void api().invoke('focus.resize', { width, height }).catch(() => undefined);
  }, [stage]);

  if (stage === 'inactive') {
    return <Inactive onActivate={() => setStage('active')} />;
  }
  if (stage === 'active') {
    return (
      <Active
        onCollapse={() => setStage('inactive')}
        onText={() => setStage('mini-text')}
        onVoice={() => setStage('mini-voice')}
      />
    );
  }
  if (stage === 'mini-text') {
    return (
      <MiniText
        workspaceId={workspaceId}
        onBack={() => setStage('active')}
      />
    );
  }
  return (
    <MiniVoice
      workspaceId={workspaceId}
      onBack={() => setStage('active')}
      onSent={() => setStage('mini-text')}
    />
  );
}

// ---- Stage 1: inactive ---------------------------------------------------
// Just a small square button with the moxxy mark. The window itself is
// 44×44; we paint a 36×36 white tile in the centre, 4 px transparent
// ring around it acts as the drag handle.

function Inactive({ onActivate }: { readonly onActivate: () => void }): JSX.Element {
  return (
    <div style={style.dragShell}>
      <button
        type="button"
        onClick={onActivate}
        aria-label="moxxy · click to expand"
        style={style.markButton}
      >
        <MarkGlyph />
      </button>
    </div>
  );
}

// ---- Stage 2: active -----------------------------------------------------
// Mark + voice + text + restore-main + close. The card fills the
// window; the inner row stays clickable while the wrapping div is a
// drag handle.

function Active({
  onCollapse,
  onText,
  onVoice,
}: {
  readonly onCollapse: () => void;
  readonly onText: () => void;
  readonly onVoice: () => void;
}): JSX.Element {
  return (
    <div style={style.card}>
      <button
        type="button"
        onClick={onCollapse}
        aria-label="Collapse"
        style={style.cardBrand}
      >
        <MarkGlyph small />
      </button>
      <div style={style.divider} aria-hidden />
      <div style={style.cardActions}>
        <ActionButton onClick={onVoice} aria-label="Voice">
          <MicIcon />
        </ActionButton>
        <ActionButton onClick={onText} aria-label="Text">
          <EditIcon />
        </ActionButton>
        <ActionButton
          onClick={() => void api().invoke('focus.restoreMain').catch(() => undefined)}
          aria-label="Open main window"
        >
          <WindowIcon />
        </ActionButton>
        <ActionButton
          onClick={() => void api().invoke('focus.close').catch(() => undefined)}
          aria-label="Close focus mode"
          variant="danger"
        >
          <XIcon />
        </ActionButton>
      </div>
    </div>
  );
}

// ---- Stage 3a: mini-text -------------------------------------------------

function MiniText({
  workspaceId,
  onBack,
}: {
  readonly workspaceId: string | null;
  readonly onBack: () => void;
}): JSX.Element {
  const [draft, setDraft] = useState('');
  const chat = useChat(workspaceId);
  const latest = useLatestBlock(workspaceId);

  const submit = (): void => {
    if (!workspaceId || !draft.trim()) return;
    void chat.send(draft.trim());
    setDraft('');
  };

  return (
    <div style={style.panel}>
      <MiniHeader title="Text" onBack={onBack} />
      <div style={style.panelBody}>
        {chat.sending ? (
          <ThinkingLine />
        ) : latest ? (
          <LatestLine block={latest} />
        ) : (
          <IdleLine
            label={
              workspaceId ? 'Type a quick prompt below.' : 'No active workspace.'
            }
          />
        )}
      </div>
      <form
        style={style.composer}
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <input
          autoFocus
          placeholder={workspaceId ? 'Ask Moxxy…' : 'No active workspace'}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          disabled={!workspaceId}
          style={style.input}
        />
        <button
          type="submit"
          aria-label="Send"
          disabled={!workspaceId || !draft.trim()}
          style={style.send}
        >
          <SendIcon />
        </button>
      </form>
    </div>
  );
}

// ---- Stage 3b: mini-voice ------------------------------------------------

type VoicePhase = 'idle' | 'recording' | 'transcribing' | 'unavailable';

function MiniVoice({
  workspaceId,
  onBack,
  onSent,
}: {
  readonly workspaceId: string | null;
  readonly onBack: () => void;
  readonly onSent: () => void;
}): JSX.Element {
  const [phase, setPhase] = useState<VoicePhase>('idle');
  const [transcript, setTranscript] = useState('');
  const recorderRef = useRef<MediaRecorder | null>(null);

  const start = async (): Promise<void> => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const candidates = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4'];
      const mimeType = candidates.find((m) => MediaRecorder.isTypeSupported(m));
      const rec = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
      const chunks: Blob[] = [];
      rec.addEventListener('dataavailable', (ev) => {
        if (ev.data.size > 0) chunks.push(ev.data);
      });
      rec.addEventListener('stop', () => {
        stream.getTracks().forEach((t) => t.stop());
        void finalize(chunks, rec.mimeType);
      });
      rec.start();
      recorderRef.current = rec;
      setPhase('recording');
    } catch {
      setPhase('unavailable');
      window.setTimeout(() => setPhase('idle'), 1500);
    }
  };

  const stop = (): void => {
    const rec = recorderRef.current;
    if (rec?.state === 'recording') rec.stop();
    recorderRef.current = null;
  };

  const finalize = async (chunks: ReadonlyArray<Blob>, mimeType: string): Promise<void> => {
    setPhase('transcribing');
    try {
      const blob = new Blob([...chunks], { type: mimeType });
      const buf = await blob.arrayBuffer();
      const text = await api().invoke('session.transcribe', {
        audioBase64: arrayBufferToBase64(buf),
        mimeType,
      });
      if (text?.trim()) setTranscript(text.trim());
      setPhase('idle');
    } catch {
      setPhase('unavailable');
      window.setTimeout(() => setPhase('idle'), 1500);
    }
  };

  const sendTranscript = (): void => {
    if (!workspaceId || !transcript.trim()) return;
    void api()
      .invoke('session.runTurn', { workspaceId, prompt: transcript.trim() })
      .catch(() => undefined);
    setTranscript('');
    onSent();
  };

  return (
    <div style={style.panel}>
      <MiniHeader title="Voice" onBack={onBack} />
      <div
        style={{
          ...style.panelBody,
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 10,
        }}
      >
        <button
          type="button"
          onClick={() => (phase === 'recording' ? stop() : void start())}
          disabled={phase === 'transcribing' || phase === 'unavailable'}
          style={{
            ...style.micButton,
            ...(phase === 'recording' ? style.micButtonRecording : null),
            ...(phase === 'transcribing' || phase === 'unavailable'
              ? style.micButtonDisabled
              : null),
          }}
          aria-label={phase === 'recording' ? 'Tap to stop' : 'Tap to record'}
        >
          <MicIcon big />
        </button>
        {transcript ? (
          <div style={style.transcript}>{transcript}</div>
        ) : (
          <div style={style.hint}>
            {phase === 'recording'
              ? 'Listening…'
              : phase === 'transcribing'
                ? 'Transcribing…'
                : phase === 'unavailable'
                  ? 'No mic / transcriber.'
                  : 'Tap the mic and speak.'}
          </div>
        )}
        {transcript && phase === 'idle' && (
          <button type="button" onClick={sendTranscript} style={style.transcriptSend}>
            Send
          </button>
        )}
      </div>
    </div>
  );
}

// ---- Helpers -------------------------------------------------------------

interface LatestBlock {
  readonly who: 'user' | 'assistant';
  readonly text: string;
}

// Cache the latest-block snapshot per workspace so useSyncExternalStore
// receives a stable reference when nothing actually changed. Returning
// a fresh `{ who, text }` object every call would re-trigger render
// loops infinitely — useSyncExternalStore strictly compares snapshots.
const latestBlockCache = new Map<string, { key: string; block: LatestBlock }>();

function readLatestBlock(workspaceId: string | null): LatestBlock | null {
  if (!workspaceId) return null;
  const blocks = chatStore.getChat(workspaceId).blocks;
  for (let i = blocks.length - 1; i >= 0; i--) {
    const b = blocks[i]!;
    if ((b.kind === 'assistant' || b.kind === 'user') && b.text.trim()) {
      const key = `${b.kind}:${b.text.length}:${b.text.slice(0, 64)}`;
      const cached = latestBlockCache.get(workspaceId);
      if (cached?.key === key) return cached.block;
      const block: LatestBlock = { who: b.kind, text: b.text };
      latestBlockCache.set(workspaceId, { key, block });
      return block;
    }
  }
  if (latestBlockCache.has(workspaceId)) latestBlockCache.delete(workspaceId);
  return null;
}

function useLatestBlock(workspaceId: string | null): LatestBlock | null {
  return useSyncExternalStore(chatStore.subscribe, () =>
    readLatestBlock(workspaceId),
  );
}

function MiniHeader({
  title,
  onBack,
}: {
  readonly title: string;
  readonly onBack: () => void;
}): JSX.Element {
  return (
    <header style={style.miniHeader}>
      <button type="button" onClick={onBack} style={style.miniBack} aria-label="Back">
        <ChevronIcon />
      </button>
      <div style={style.miniTitle}>
        <MarkGlyph small />
        <span>{title}</span>
      </div>
      <button
        type="button"
        onClick={() => void api().invoke('focus.restoreMain').catch(() => undefined)}
        style={style.miniRestore}
        aria-label="Open main window"
      >
        <WindowIcon />
      </button>
    </header>
  );
}

function ActionButton({
  onClick,
  children,
  variant,
  ...rest
}: {
  readonly onClick: () => void;
  readonly children: React.ReactNode;
  readonly variant?: 'danger';
  readonly 'aria-label': string;
}): JSX.Element {
  const [hover, setHover] = useState(false);
  return (
    <button
      type="button"
      onClick={onClick}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        ...style.actionBtn,
        ...(hover
          ? variant === 'danger'
            ? { background: 'rgba(239, 68, 68, 0.15)', color: '#ef4444' }
            : { background: 'rgba(15, 23, 42, 0.07)', color: '#0f172a' }
          : null),
      }}
      aria-label={rest['aria-label']}
    >
      {children}
    </button>
  );
}

function MarkGlyph({ small = false }: { readonly small?: boolean }): JSX.Element {
  const dim = small ? 22 : 24;
  return (
    <span
      aria-hidden
      style={{
        width: dim,
        height: dim,
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontFamily: 'Inter, system-ui, sans-serif',
        fontSize: small ? 14 : 16,
        fontWeight: 800,
        color: '#ec4899',
        letterSpacing: '-0.04em',
      }}
    >
      m
    </span>
  );
}

function ThinkingLine(): JSX.Element {
  return (
    <div style={style.lineRow}>
      <Dot delay={0} />
      <Dot delay={160} />
      <Dot delay={320} />
      <span style={{ color: '#ec4899', fontWeight: 600, fontSize: 13 }}>working…</span>
    </div>
  );
}

function LatestLine({ block }: { readonly block: LatestBlock }): JSX.Element {
  const prefix = block.who === 'user' ? 'you · ' : '';
  return (
    <div
      style={{
        ...style.lineRow,
        whiteSpace: 'nowrap',
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        display: 'block',
        fontSize: 13,
        color: '#0f172a',
        lineHeight: 1.4,
      }}
      title={block.text}
    >
      {prefix && (
        <span style={{ opacity: 0.55, fontWeight: 600, marginRight: 4 }}>{prefix}</span>
      )}
      {block.text.trim().split(/\n/)[0]}
    </div>
  );
}

function IdleLine({ label }: { readonly label: string }): JSX.Element {
  return (
    <div style={{ fontSize: 12.5, color: '#64748b', fontStyle: 'italic' }}>{label}</div>
  );
}

function Dot({ delay }: { readonly delay: number }): JSX.Element {
  return (
    <span
      style={{
        display: 'inline-block',
        width: 5,
        height: 5,
        borderRadius: 5,
        background: '#ec4899',
        margin: '0 1px',
        animation: 'focus-thinking 1.2s ease-in-out infinite',
        animationDelay: `${delay}ms`,
      }}
    />
  );
}

// ---- Icons (inline SVG — no external dependency, always renders) ---------

function MicIcon({ big = false }: { readonly big?: boolean }): JSX.Element {
  const size = big ? 26 : 15;
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden>
      <rect x="9" y="3" width="6" height="12" rx="3" stroke="currentColor" strokeWidth="2" />
      <path d="M5 11a7 7 0 0014 0M12 18v3" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}
function EditIcon(): JSX.Element {
  return (
    <svg width={14} height={14} viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M4 20h4l10-10-4-4L4 16v4zM14 6l4 4"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
function WindowIcon(): JSX.Element {
  return (
    <svg width={14} height={14} viewBox="0 0 24 24" fill="none" aria-hidden>
      <rect x="3" y="5" width="18" height="14" rx="2" stroke="currentColor" strokeWidth="2" />
      <path d="M3 9h18" stroke="currentColor" strokeWidth="2" />
    </svg>
  );
}
function XIcon(): JSX.Element {
  return (
    <svg width={12} height={12} viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M6 6l12 12M18 6L6 18"
        stroke="currentColor"
        strokeWidth="2.4"
        strokeLinecap="round"
      />
    </svg>
  );
}
function ChevronIcon(): JSX.Element {
  return (
    <svg width={12} height={12} viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M15 6l-6 6 6 6"
        stroke="currentColor"
        strokeWidth="2.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
function SendIcon(): JSX.Element {
  return (
    <svg width={14} height={14} viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M3 12l18-9-7 18-3-8-8-1z"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinejoin="round"
        fill="currentColor"
        fillOpacity="0.85"
      />
    </svg>
  );
}

// ---- Utilities -----------------------------------------------------------

function arrayBufferToBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]!);
  }
  return btoa(binary);
}

// ---- Styles (inline objects — no external stylesheet dependency) --------

const drag = { WebkitAppRegion: 'drag' as const };
const noDrag = { WebkitAppRegion: 'no-drag' as const };

const style: Record<string, React.CSSProperties> = {
  dragShell: {
    width: '100%',
    height: '100%',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 4,
    boxSizing: 'border-box',
    ...drag,
  },
  markButton: {
    width: 36,
    height: 36,
    padding: 0,
    margin: 0,
    background: '#ffffff',
    border: '1px solid rgba(15, 23, 42, 0.12)',
    borderRadius: 10,
    boxShadow:
      '0 6px 14px -6px rgba(15, 23, 42, 0.25), 0 2px 4px -2px rgba(15, 23, 42, 0.15)',
    cursor: 'pointer',
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    transition: 'transform 120ms ease, box-shadow 200ms ease',
    ...noDrag,
  },
  card: {
    width: '100%',
    height: '100%',
    boxSizing: 'border-box',
    padding: '6px 10px 6px 8px',
    display: 'flex',
    alignItems: 'center',
    gap: 6,
    background: '#ffffff',
    border: '1px solid rgba(15, 23, 42, 0.12)',
    borderRadius: 12,
    boxShadow:
      '0 10px 24px -10px rgba(15, 23, 42, 0.25), 0 4px 10px -6px rgba(15, 23, 42, 0.15)',
    ...drag,
  },
  cardBrand: {
    width: 32,
    height: 32,
    padding: 0,
    margin: 0,
    background: 'transparent',
    border: 'none',
    borderRadius: 8,
    cursor: 'pointer',
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
    ...noDrag,
  },
  divider: {
    width: 1,
    height: 24,
    background: 'rgba(15, 23, 42, 0.12)',
    flexShrink: 0,
  },
  cardActions: {
    display: 'flex',
    gap: 2,
    marginLeft: 'auto',
    ...noDrag,
  },
  actionBtn: {
    width: 32,
    height: 32,
    padding: 0,
    margin: 0,
    border: 'none',
    background: 'transparent',
    borderRadius: 8,
    color: '#64748b',
    cursor: 'pointer',
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    transition: 'background-color 140ms ease, color 140ms ease',
  },
  panel: {
    width: '100%',
    height: '100%',
    boxSizing: 'border-box',
    display: 'flex',
    flexDirection: 'column',
    background: '#ffffff',
    border: '1px solid rgba(15, 23, 42, 0.12)',
    borderRadius: 14,
    boxShadow:
      '0 18px 36px -12px rgba(15, 23, 42, 0.28), 0 6px 14px -8px rgba(15, 23, 42, 0.18)',
    overflow: 'hidden',
  },
  miniHeader: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '8px 10px',
    borderBottom: '1px solid rgba(15, 23, 42, 0.08)',
    ...drag,
  },
  miniBack: {
    width: 24,
    height: 24,
    padding: 0,
    background: 'transparent',
    border: 'none',
    color: '#64748b',
    cursor: 'pointer',
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    ...noDrag,
  },
  miniTitle: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 6,
    fontSize: 11.5,
    fontWeight: 700,
    textTransform: 'uppercase',
    letterSpacing: '0.05em',
    color: '#64748b',
  },
  miniRestore: {
    width: 24,
    height: 24,
    padding: 0,
    background: 'transparent',
    border: 'none',
    color: '#64748b',
    cursor: 'pointer',
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    ...noDrag,
  },
  panelBody: {
    flex: 1,
    padding: '10px 14px',
    display: 'flex',
    alignItems: 'center',
    minHeight: 0,
  },
  lineRow: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 4,
  },
  composer: {
    display: 'flex',
    alignItems: 'center',
    gap: 6,
    padding: '8px 10px',
    borderTop: '1px solid rgba(15, 23, 42, 0.08)',
    background: '#fff',
    ...noDrag,
  },
  input: {
    flex: 1,
    height: 32,
    padding: '0 10px',
    fontSize: 13,
    color: '#0f172a',
    background: '#f8fafc',
    border: '1px solid rgba(15, 23, 42, 0.12)',
    borderRadius: 8,
    outline: 'none',
    fontFamily: 'inherit',
  },
  send: {
    width: 32,
    height: 32,
    border: 'none',
    borderRadius: 8,
    background: 'linear-gradient(135deg, #ec4899, #d946ef)',
    color: '#fff',
    cursor: 'pointer',
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  micButton: {
    width: 72,
    height: 72,
    border: 'none',
    borderRadius: 36,
    background: 'linear-gradient(135deg, #ec4899, #d946ef)',
    color: '#fff',
    cursor: 'pointer',
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    boxShadow: '0 12px 24px -10px rgba(236, 72, 153, 0.55)',
    transition: 'transform 120ms ease, background 200ms ease',
  },
  micButtonRecording: {
    background: '#ef4444',
    boxShadow: '0 0 0 4px rgba(239, 68, 68, 0.25), 0 12px 24px -10px rgba(239, 68, 68, 0.55)',
  },
  micButtonDisabled: {
    opacity: 0.6,
    cursor: 'default',
  },
  transcript: {
    fontSize: 12.5,
    color: '#0f172a',
    padding: '6px 10px',
    background: '#f8fafc',
    border: '1px solid rgba(15, 23, 42, 0.12)',
    borderRadius: 8,
    maxWidth: '100%',
    textAlign: 'center',
  },
  hint: {
    fontSize: 12,
    color: '#64748b',
    letterSpacing: '0.02em',
  },
  transcriptSend: {
    padding: '6px 14px',
    borderRadius: 999,
    fontSize: 12,
    fontWeight: 700,
    border: 'none',
    background: 'linear-gradient(135deg, #ec4899, #d946ef)',
    color: '#fff',
    cursor: 'pointer',
  },
};

// ---- Keyframe for the thinking dots --------------------------------------
// Injected once on first import — avoids relying on an external CSS file.

if (typeof document !== 'undefined' && !document.getElementById('focus-keyframes')) {
  const styleTag = document.createElement('style');
  styleTag.id = 'focus-keyframes';
  styleTag.textContent = `
    @keyframes focus-thinking {
      0%, 100% { transform: translateY(0); opacity: 0.4; }
      50%      { transform: translateY(-3px); opacity: 1; }
    }
  `;
  document.head.appendChild(styleTag);
}
