import {
  cancel,
  intro,
  isCancel,
  log,
  note,
  outro,
  password,
  select,
  spinner,
  text,
} from '@clack/prompts';
import {
  TELEGRAM_AUTHORIZED_CHAT_KEY,
  TELEGRAM_TOKEN_KEY,
  TELEGRAM_TOKEN_RE,
  TelegramChannel,
  type PairingIssuedEvent,
} from '@moxxy/plugin-telegram';
import { bootSessionWithConfig } from '../argv-helpers.js';
import type { ParsedArgv } from '../argv.js';
import { colors } from '../colors.js';
import { runChannelByName } from './run-channel.js';

interface State {
  readonly hasToken: boolean;
  /** "<prefix>…<suffix>" of the bot id for display. null when none. */
  readonly tokenPreview: string | null;
  readonly authorizedChatId: number | null;
}

/**
 * Interactive Telegram setup menu.
 *
 * Invoked by `runChannelByName` when the user runs `moxxy telegram`
 * or `moxxy channels telegram` with no subcommand in a TTY. Headless
 * invocations (or `--start`) bypass it and start the bot directly,
 * preserving the cron / systemd usage path.
 *
 * Menu offers actions appropriate to the current state:
 *   - no token            → "Set bot token" + "Quit"
 *   - token, not paired   → "Pair this terminal" + "Change token" + "Quit"
 *   - token + paired      → "Start bot" + "Unpair" + "Change token" + "Quit"
 *
 * Pairing is driven by the wizard end-to-end: the wizard opens a pair
 * window, the bot waits for /start, on /start it DMs a 6-digit code to
 * the user, and the user pastes the code back into this wizard.
 */
export async function runTelegramWizard(argv: ParsedArgv): Promise<number> {
  const { vault } = await bootSessionWithConfig(argv, {
    skipKeyPrompt: true,
    tolerateNoProvider: true,
    skipProviderActivation: true,
  });

  intro(colors.bold('moxxy telegram setup'));

  // Short-circuit if the user invoked `moxxy channels telegram pair` —
  // skip the menu, jump straight to the pair flow. Token-less state is
  // surfaced with a clear error rather than the menu fallback.
  if (argv.flags['pair'] === true) {
    const state = await readState(vault);
    if (!state.hasToken) {
      log.error('No bot token configured. Run `moxxy telegram` and pick "Set the bot token" first.');
      return 1;
    }
    return await actionPair(argv);
  }

  // eslint-disable-next-line no-constant-condition
  while (true) {
    const state = await readState(vault);
    printStatus(state);
    const action = await pickAction(state);
    if (action === null) {
      cancel('cancelled.');
      return 0;
    }
    if (action === 'quit') {
      outro(colors.dim('done.'));
      return 0;
    }
    if (action === 'set-token') {
      await actionSetToken(vault);
      continue;
    }
    if (action === 'pair') {
      return await actionPair(argv);
    }
    if (action === 'unpair') {
      await vault.delete(TELEGRAM_AUTHORIZED_CHAT_KEY);
      log.success('Unpaired. The next /start from any chat will begin a fresh pairing window.');
      continue;
    }
    if (action === 'start') {
      log.info('Starting the bot. Press Ctrl+C to stop.');
      outro(colors.dim('handing off to bot…'));
      return runChannelByName('telegram', {
        ...argv,
        flags: { ...argv.flags, __skipWizard: true },
      });
    }
  }
}

async function readState(vault: import('@moxxy/plugin-vault').VaultStore): Promise<State> {
  // env beats vault for token (matches the channel's own isAvailable
  // precedence) so the wizard reflects what the bot would actually see
  // at start time.
  const envToken = process.env.MOXXY_TELEGRAM_TOKEN;
  const vaultToken = envToken ?? (await vault.get(TELEGRAM_TOKEN_KEY));
  const authorized = await vault.get(TELEGRAM_AUTHORIZED_CHAT_KEY);
  return {
    hasToken: !!vaultToken,
    tokenPreview: vaultToken ? maskToken(vaultToken) : null,
    authorizedChatId: authorized ? Number(authorized) : null,
  };
}

function maskToken(token: string): string {
  const id = token.split(':')[0] ?? '';
  return id.length > 4 ? `${id.slice(0, 3)}…${id.slice(-3)}` : id;
}

function printStatus(state: State): void {
  const lines: string[] = [];
  lines.push(
    `Token        ${state.hasToken ? colors.bold(state.tokenPreview ?? 'set') : colors.dim('not set')}`,
  );
  lines.push(
    `Paired chat  ${state.authorizedChatId != null ? colors.bold(String(state.authorizedChatId)) : colors.dim('none')}`,
  );
  note(lines.join('\n'), 'status');
}

type Action = 'set-token' | 'pair' | 'unpair' | 'start' | 'quit';

async function pickAction(state: State): Promise<Action | null> {
  const options: Array<{ value: Action; label: string; hint?: string }> = [];
  if (state.hasToken && state.authorizedChatId != null) {
    options.push({
      value: 'start',
      label: 'Start the bot',
      hint: 'runs forever — Ctrl+C to stop',
    });
    options.push({
      value: 'unpair',
      label: 'Unpair this chat',
      hint: 'next /start begins a fresh pairing window',
    });
  } else if (state.hasToken) {
    options.push({
      value: 'pair',
      label: 'Pair a Telegram chat',
      hint: 'bot sends you a code in chat; paste it here',
    });
  }
  options.push({
    value: 'set-token',
    label: state.hasToken ? 'Change the bot token' : 'Set the bot token',
    hint: state.hasToken ? undefined : 'get one from @BotFather on Telegram',
  });
  options.push({ value: 'quit', label: 'Quit' });

  const choice = await select<Action>({ message: 'What do you want to do?', options });
  if (isCancel(choice)) return null;
  return choice as Action;
}

async function actionSetToken(
  vault: import('@moxxy/plugin-vault').VaultStore,
): Promise<boolean> {
  note(
    'Open https://t.me/BotFather, run /newbot (or /token for an existing bot), copy the\n' +
      'token it returns (looks like 1234567890:ABCdef…), and paste it below. It goes\n' +
      "straight into the moxxy vault under '" +
      TELEGRAM_TOKEN_KEY +
      "' — no env var needed.",
    'get a bot token',
  );
  const token = await password({
    message: 'Paste the Telegram bot token',
    mask: '•',
    validate: (v) => {
      if (!v || v.trim().length === 0) return 'required';
      if (!TELEGRAM_TOKEN_RE.test(v.trim())) {
        return 'doesn\'t look like a Telegram token — expected "<digits>:<22+ url-safe chars>"';
      }
      return undefined;
    },
  });
  if (isCancel(token)) return false;
  await vault.set(TELEGRAM_TOKEN_KEY, String(token).trim(), ['telegram']);
  log.success('Token stored in vault.');
  return true;
}

/**
 * Drive the bot-issued pairing flow end-to-end.
 *
 * Steps:
 *   1. Boot session, build a TelegramChannel directly, wire the
 *      session's permission resolver.
 *   2. Subscribe to pairing-issued events BEFORE starting the bot so
 *      we can't race past the first /start.
 *   3. Start the bot in `pair` mode.
 *   4. Wait (with spinner) for the user to send /start in Telegram.
 *   5. Prompt the user for the 6-digit code the bot DM'd them; on
 *      mismatch let them retry (up to 3 tries inside the same window).
 *   6. On success, the channel persists the authorized chat id to the
 *      vault and DMs a confirmation; we then hand off SIGINT to keep
 *      the bot running until the user Ctrl-Cs.
 */
async function actionPair(argv: ParsedArgv): Promise<number> {
  const { session, vault, config } = await bootSessionWithConfig(argv, {
    skipKeyPrompt: true,
    tolerateNoProvider: true,
    skipProviderActivation: true,
  });

  const configOpts = (config.channels?.['telegram'] ?? {}) as Record<string, unknown>;
  const channel = new TelegramChannel({
    vault,
    token: (configOpts['token'] as string | undefined) ?? undefined,
    logger: session.logger as never,
  });
  session.setPermissionResolver(channel.permissionResolver);

  // Subscribe BEFORE start so the first /start can't fire before us.
  let issuedResolve: ((e: PairingIssuedEvent) => void) | null = null;
  const issued = new Promise<PairingIssuedEvent>((resolve) => {
    issuedResolve = resolve;
  });
  const unsubscribe = channel.onPairingIssued((e) => {
    issuedResolve?.(e);
    issuedResolve = null;
  });

  outro(colors.dim('opening pairing window…'));

  const handle = await channel.start({ session, pair: true });

  // From here on we own the bot lifecycle. Any failure path needs to
  // call handle.stop() before returning.
  const stopBot = async (): Promise<void> => {
    unsubscribe();
    try {
      await handle.stop('wizard');
    } catch {
      /* ignore */
    }
  };

  const spin = spinner();
  spin.start('Waiting for /start from a Telegram chat…');

  let event: PairingIssuedEvent;
  try {
    event = await issued;
  } catch (err) {
    spin.stop('pairing aborted');
    log.error(`Pairing aborted: ${err instanceof Error ? err.message : String(err)}`);
    await stopBot();
    return 1;
  }
  spin.stop(`Code sent to Telegram chat ${event.chatId}.`);
  log.info(
    'Open the bot in Telegram. You should see the 6-digit code there.\n' +
      'Paste it below to authorize this chat.',
  );

  let confirmed = false;
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const entered = await text({
      message: 'Enter the 6-digit code',
      placeholder: '123456',
      validate: (v) => {
        const normalized = (v ?? '').replace(/\s+/g, '');
        if (!/^\d{6}$/.test(normalized)) return 'Enter the 6 digits the bot sent you';
        return undefined;
      },
    });
    if (isCancel(entered)) {
      cancel('pairing cancelled');
      await stopBot();
      return 0;
    }
    const result = await channel.confirmPairingCode(String(entered));
    if (result.ok) {
      log.success(`Paired ✓ — chat ${result.chatId} is authorized.`);
      confirmed = true;
      break;
    }
    if (result.reason === 'expired' || result.reason === 'no-window') {
      log.error(result.message);
      await stopBot();
      return 1;
    }
    log.warn(result.message);
  }
  if (!confirmed) {
    log.error('Too many wrong attempts. Run the pair flow again.');
    await stopBot();
    return 1;
  }

  log.info('Bot is running. Press Ctrl+C to stop.');

  // Hand off the running bot. SIGINT shuts it down cleanly and exits.
  const shutdown = async (): Promise<void> => {
    await stopBot();
    await session.close('SIGINT').catch(() => undefined);
    process.exit(0);
  };
  process.on('SIGINT', () => void shutdown());
  process.on('SIGTERM', () => void shutdown());

  await handle.running;
  return 0;
}
