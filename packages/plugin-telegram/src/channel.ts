import { Bot, InlineKeyboard, GrammyError, HttpError } from 'grammy';
import type { Context } from 'grammy';
import { runTurn, silentLogger, type Session } from '@moxxy/core';
import type { VaultStore } from '@moxxy/plugin-vault';
import { TelegramPermissionResolver } from './permission.js';
import {
  beginPairing,
  clearPairing,
  createPairingState,
  handleCode,
  handleStart,
  isAuthorized,
  type PairingState,
} from './pairing.js';
import { TurnRenderer, splitForTelegram } from './render.js';
import type { PermissionContext, PendingToolCall } from '@moxxy/sdk';

const AUTHORIZED_CHAT_KEY = 'telegram_authorized_chat_id';
const TOKEN_KEY = 'telegram_bot_token';

export interface TelegramChannelOptions {
  readonly session: Session;
  readonly vault: VaultStore;
  readonly resolver: TelegramPermissionResolver;
  readonly token?: string;
  readonly model?: string;
  readonly logger?: { info(msg: string, meta?: Record<string, unknown>): void; warn(msg: string, meta?: Record<string, unknown>): void };
  readonly editFrameMs?: number;
}

export class TelegramChannel {
  private readonly opts: TelegramChannelOptions;
  private bot: Bot | null = null;
  private pairing: PairingState = createPairingState();
  private busy = false;
  private currentMessageId: number | null = null;
  private currentChatId: number | null = null;
  private renderer = new TurnRenderer();
  private editTimer: ReturnType<typeof setTimeout> | null = null;
  private lastSentFrame = '';
  private readonly editFrameMs: number;

  constructor(opts: TelegramChannelOptions) {
    this.opts = opts;
    this.editFrameMs = opts.editFrameMs ?? 1000;
  }

  async start(): Promise<void> {
    const token = this.opts.token ?? (await this.opts.vault.get(TOKEN_KEY));
    if (!token) {
      throw new Error(
        `Telegram bot token not found. Run \`moxxy telegram setup\` to obtain one, or set MOXXY_TELEGRAM_TOKEN.`,
      );
    }
    const authorizedRaw = await this.opts.vault.get(AUTHORIZED_CHAT_KEY);
    const authorizedChatId = authorizedRaw ? Number(authorizedRaw) : null;
    this.pairing = createPairingState({ authorizedChatId });

    this.bot = new Bot(token);
    this.opts.resolver.setDecider((call, ctx) => this.askForPermission(call, ctx));

    this.bot.command('start', (ctx) => this.handleStart(ctx));
    this.bot.on('callback_query:data', (ctx) => this.handleCallback(ctx));
    this.bot.on('message:text', (ctx) => this.handleText(ctx));
    this.bot.catch((err) => {
      const e = err.error;
      if (e instanceof GrammyError) this.opts.logger?.warn('grammy error', { description: e.description });
      else if (e instanceof HttpError) this.opts.logger?.warn('http error', { message: e.message });
      else this.opts.logger?.warn('telegram error', { err: String(e) });
    });

    this.opts.logger?.info?.('telegram channel starting', {
      paired: this.pairing.phase === 'paired',
    });

    await this.bot.start({ drop_pending_updates: false });
  }

  async stop(): Promise<void> {
    this.opts.resolver.abortAll('telegram channel stopping');
    if (this.editTimer) clearTimeout(this.editTimer);
    if (this.bot) await this.bot.stop();
  }

  /** Begin a pairing window. Returns the 6-digit code to display in the host. */
  beginPairingWindow(): string {
    const { state, code } = beginPairing(this.pairing);
    this.pairing = state;
    return code;
  }

  pairingPhase(): PairingState['phase'] {
    return this.pairing.phase;
  }

  unpair(): void {
    this.pairing = clearPairing(this.pairing);
  }

  private async handleStart(ctx: Context): Promise<void> {
    const chatId = ctx.chat?.id;
    if (!chatId) return;
    const decision = handleStart(this.pairing, chatId);
    this.pairing = decision.state;
    const action = decision.action;
    if (action.kind === 'still-paired') {
      await ctx.reply('Welcome back! Send me a prompt.');
      return;
    }
    if (action.kind === 'reject' || action.kind === 'request-code') {
      await ctx.reply(action.message);
    }
  }

  private async handleText(ctx: Context): Promise<void> {
    const chatId = ctx.chat?.id;
    const text = ctx.message?.text;
    if (!chatId || !text) return;

    if (this.pairing.phase === 'awaiting-code') {
      const decision = handleCode(this.pairing, chatId, text);
      this.pairing = decision.state;
      switch (decision.action.kind) {
        case 'paired':
          await this.opts.vault.set(AUTHORIZED_CHAT_KEY, String(decision.action.chatId));
          await ctx.reply(decision.action.message);
          return;
        case 'reject':
        case 'wait':
          await ctx.reply(decision.action.message);
          return;
        default:
          return;
      }
    }

    if (!isAuthorized(this.pairing, chatId)) {
      await ctx.reply(
        'This bot is paired with a different chat (or not paired yet). Run `moxxy telegram pair` on your terminal to (re-)pair.',
      );
      return;
    }

    if (this.busy) {
      await ctx.reply('I am still working on the previous prompt. Send /reset to abort it.');
      return;
    }

    await this.runUserTurn(ctx, chatId, text);
  }

  private async runUserTurn(ctx: Context, chatId: number, text: string): Promise<void> {
    this.busy = true;
    this.renderer.reset();
    this.currentChatId = chatId;
    const initial = await ctx.reply('…');
    this.currentMessageId = initial.message_id;
    this.lastSentFrame = '…';

    const unsubscribe = this.opts.session.log.subscribe((event) => {
      const frame = this.renderer.accept(event);
      if (frame.hasUpdate) this.scheduleEdit();
    });

    try {
      for await (const _event of runTurn(this.opts.session, text, this.opts.model ? { model: this.opts.model } : {})) {
        void _event;
      }
      // Final flush
      await this.flushEdit(true);
    } catch (err) {
      this.opts.logger?.warn('telegram turn failed', { err: err instanceof Error ? err.message : String(err) });
      try {
        await ctx.reply(`Turn failed: ${err instanceof Error ? err.message : String(err)}`);
      } catch {
        /* ignore */
      }
    } finally {
      unsubscribe();
      this.busy = false;
      this.currentChatId = null;
      this.currentMessageId = null;
    }
  }

  private scheduleEdit(): void {
    if (this.editTimer) return;
    this.editTimer = setTimeout(() => {
      this.editTimer = null;
      void this.flushEdit(false);
    }, this.editFrameMs);
  }

  private async flushEdit(final: boolean): Promise<void> {
    if (this.editTimer) {
      clearTimeout(this.editTimer);
      this.editTimer = null;
    }
    if (!this.bot || !this.currentChatId || !this.currentMessageId) return;
    const frame = this.renderer.snapshot();
    if (!frame || frame === this.lastSentFrame) {
      if (final && !frame) {
        await this.safeEdit(this.currentChatId, this.currentMessageId, '(no output)');
      }
      return;
    }

    // If the frame exceeds 4000 chars after splitting, send tail as new messages
    const parts = splitForTelegram(frame);
    const head = parts[0]!;
    await this.safeEdit(this.currentChatId, this.currentMessageId, head);
    this.lastSentFrame = head;

    if (final && parts.length > 1) {
      for (const tail of parts.slice(1)) {
        try {
          await this.bot.api.sendMessage(this.currentChatId, tail);
        } catch {
          /* ignore */
        }
      }
    }
  }

  private async safeEdit(chatId: number, messageId: number, text: string): Promise<void> {
    try {
      await this.bot!.api.editMessageText(chatId, messageId, text);
    } catch (err) {
      // 400 message-not-modified is benign; log others
      if (err instanceof GrammyError && err.description?.includes('not modified')) return;
      this.opts.logger?.warn('editMessageText failed', { err: String(err) });
    }
  }

  private async askForPermission(call: PendingToolCall, ctx: PermissionContext): Promise<void> {
    if (!this.bot || !this.currentChatId) return;
    void ctx;
    const keyboard = new InlineKeyboard()
      .text('Allow once', `perm:${call.callId}:allow`)
      .text('Allow session', `perm:${call.callId}:allow_session`)
      .row()
      .text('Deny', `perm:${call.callId}:deny`);
    const description = this.opts.session.tools.get(call.name)?.description ?? '';
    const summary =
      `🔐 Tool permission requested\n` +
      `Tool: ${call.name}\n` +
      (description ? `Desc: ${description}\n` : '') +
      `Input: ${truncate(JSON.stringify(call.input), 300)}`;
    try {
      await this.bot.api.sendMessage(this.currentChatId, summary, { reply_markup: keyboard });
    } catch (err) {
      this.opts.logger?.warn('permission send failed', { err: String(err) });
      // Force deny if we can't show the prompt
      this.opts.resolver.resolvePending(call.callId, { mode: 'deny', reason: 'unable to render prompt' });
    }
  }

  private async handleCallback(ctx: Context): Promise<void> {
    const data = ctx.callbackQuery?.data;
    if (!data || !data.startsWith('perm:')) return;
    const parts = data.split(':');
    if (parts.length !== 3) return;
    const [, callId, choice] = parts;
    if (!callId || !choice) return;

    const decision = mapChoice(choice);
    const handled = this.opts.resolver.resolvePending(callId, decision);
    await ctx.answerCallbackQuery({ text: handled ? choice : 'no pending permission' });
    if (handled && ctx.callbackQuery?.message) {
      try {
        await ctx.editMessageReplyMarkup({});
      } catch {
        /* ignore */
      }
    }
  }
}

function mapChoice(choice: string): import('@moxxy/sdk').PermissionDecision {
  if (choice === 'allow') return { mode: 'allow' };
  if (choice === 'allow_session') return { mode: 'allow_session' };
  return { mode: 'deny', reason: 'denied by user' };
}

function truncate(s: string, n: number): string {
  return s.length <= n ? s : s.slice(0, n) + '…';
}

// Tests need silentLogger to be importable; not used here but keep for tree-shake noise.
void silentLogger;
