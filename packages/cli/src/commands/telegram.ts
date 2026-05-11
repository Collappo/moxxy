import { setupSessionWithConfig } from '../setup.js';
import type { ParsedArgv } from '../argv.js';
import { TelegramChannel, TelegramPermissionResolver } from '@moxxy/plugin-telegram';
import { createLogger } from '@moxxy/core';

const TOKEN_ENV = 'MOXXY_TELEGRAM_TOKEN';

export async function runTelegramCommand(argv: ParsedArgv): Promise<number> {
  const sub = argv.positional[0] ?? 'start';
  switch (sub) {
    case 'start':
    case 'pair':
      return await runStart(argv, sub === 'pair');
    case 'unpair':
      return await runUnpair(argv);
    case 'status':
      return await runStatus(argv);
    default:
      process.stderr.write(
        `unknown 'telegram' subcommand: ${sub}\n` +
          `  moxxy telegram         start the bot\n` +
          `  moxxy telegram pair    start the bot and begin a pairing window\n` +
          `  moxxy telegram unpair  forget the authorized chat\n` +
          `  moxxy telegram status  show pairing/token status\n`,
      );
      return 2;
  }
}

async function runStart(argv: ParsedArgv, withPairing: boolean): Promise<number> {
  const resolver = new TelegramPermissionResolver();

  const { session, vault } = await setupSessionWithConfig({
    cwd: process.cwd(),
    verbose: Boolean(argv.flags.verbose),
    resolver,
    model: argv.flags.model ? String(argv.flags.model) : undefined,
    configPath: argv.flags.config ? String(argv.flags.config) : undefined,
  });

  const token = process.env[TOKEN_ENV] ?? (await vault.get('telegram_bot_token'));
  if (!token) {
    process.stderr.write(
      'No Telegram bot token. Run `moxxy` (TUI), invoke the `telegram-setup` skill, ' +
        'or store one via `vault_set` under the name `telegram_bot_token`.\n',
    );
    return 1;
  }

  const channel = new TelegramChannel({
    session,
    vault,
    resolver,
    token,
    model: argv.flags.model ? String(argv.flags.model) : undefined,
    logger: argv.flags.verbose ? createLogger({ minLevel: 'debug' }) : undefined,
  });

  if (withPairing) {
    const code = channel.beginPairingWindow();
    process.stderr.write(`\n  Telegram pairing code:  ${code}\n`);
    process.stderr.write('  Send /start to your bot, then type this code in Telegram.\n');
    process.stderr.write('  (Window: 5 minutes)\n\n');
  } else if (channel.pairingPhase() !== 'paired') {
    process.stderr.write(
      'No chat is paired yet. Run `moxxy telegram pair` to start a pairing window first.\n',
    );
    return 1;
  }

  const shutdown = async (): Promise<void> => {
    process.stderr.write('\nstopping telegram channel...\n');
    await channel.stop();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  await channel.start();
  return 0;
}

async function runUnpair(argv: ParsedArgv): Promise<number> {
  void argv;
  const { vault } = await setupSessionWithConfig({ cwd: process.cwd() });
  const removed = await vault.delete('telegram_authorized_chat_id');
  process.stdout.write(removed ? 'unpaired\n' : 'no pairing was active\n');
  return 0;
}

async function runStatus(argv: ParsedArgv): Promise<number> {
  void argv;
  const { vault } = await setupSessionWithConfig({ cwd: process.cwd() });
  const hasToken = await vault.has('telegram_bot_token');
  const authorized = await vault.get('telegram_authorized_chat_id');
  process.stdout.write(
    JSON.stringify(
      {
        tokenConfigured: hasToken,
        authorizedChatId: authorized ? Number(authorized) : null,
      },
      null,
      2,
    ) + '\n',
  );
  return 0;
}
