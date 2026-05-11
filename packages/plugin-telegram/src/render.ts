import type { MoxxyEvent } from '@moxxy/sdk';

const TELEGRAM_MESSAGE_LIMIT = 4000; // 4096 minus a safety margin

export interface RenderedFrame {
  text: string;
  hasUpdate: boolean;
}

/**
 * Accumulates events from a turn into a single Markdown string we can keep
 * `editMessageText`-ing on the Telegram side. Bot rate limits favor edits over
 * many separate sends.
 */
export class TurnRenderer {
  private chunks: string[] = [];
  private toolLines: string[] = [];
  private finalAssistant: string | null = null;
  private errorLine: string | null = null;
  private lastFrame = '';

  accept(event: MoxxyEvent): RenderedFrame {
    switch (event.type) {
      case 'assistant_chunk':
        this.chunks.push(event.delta);
        break;
      case 'assistant_message':
        this.finalAssistant = event.content;
        this.chunks = [];
        break;
      case 'tool_call_requested':
        this.toolLines.push(`🔧 ${event.name}(${truncJson(event.input)})`);
        break;
      case 'tool_call_denied':
        this.toolLines.push(`✗ denied: ${event.reason}`);
        break;
      case 'tool_result':
        if (event.ok) this.toolLines.push(`✓ ok`);
        else this.toolLines.push(`✗ ${event.error?.kind}: ${event.error?.message ?? ''}`);
        break;
      case 'skill_created':
        this.toolLines.push(`💡 created skill: ${event.name}`);
        break;
      case 'error':
        this.errorLine = `❗ ${event.kind}: ${event.message}`;
        break;
      default:
        break;
    }
    const frame = this.snapshot();
    const hasUpdate = frame !== this.lastFrame;
    this.lastFrame = frame;
    return { text: frame, hasUpdate };
  }

  snapshot(): string {
    const parts: string[] = [];
    if (this.toolLines.length > 0) {
      parts.push(this.toolLines.slice(-10).join('\n'));
    }
    const body = this.finalAssistant ?? this.chunks.join('');
    if (body) parts.push(body);
    if (this.errorLine) parts.push(this.errorLine);
    return truncate(parts.join('\n\n'), TELEGRAM_MESSAGE_LIMIT) || '…';
  }

  reset(): void {
    this.chunks = [];
    this.toolLines = [];
    this.finalAssistant = null;
    this.errorLine = null;
    this.lastFrame = '';
  }
}

function truncJson(value: unknown): string {
  const s = typeof value === 'string' ? value : JSON.stringify(value);
  if (s.length <= 60) return s;
  return s.slice(0, 60) + '…';
}

function truncate(s: string, n: number): string {
  return s.length <= n ? s : s.slice(0, n - 12) + '…[truncated]';
}

export function splitForTelegram(text: string, limit: number = TELEGRAM_MESSAGE_LIMIT): string[] {
  const out: string[] = [];
  let remaining = text;
  while (remaining.length > limit) {
    const cut = remaining.lastIndexOf('\n', limit);
    const idx = cut > 0 ? cut : limit;
    out.push(remaining.slice(0, idx));
    remaining = remaining.slice(idx);
  }
  if (remaining) out.push(remaining);
  return out;
}
