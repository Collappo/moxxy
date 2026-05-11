#!/usr/bin/env node
import { parseArgv } from './argv.js';
import { runPromptCommand } from './commands/prompt.js';
import { runTuiCommand } from './commands/tui.js';
import { runSkillsCommand } from './commands/skills.js';
import { runPluginsCommand } from './commands/plugins.js';
import { runTelegramCommand } from './commands/telegram.js';

const HELP = `moxxy — block-based agentic loop

usage:
  moxxy                              start interactive TUI
  moxxy tui                          start interactive TUI
  moxxy -p "..."                     one-shot prompt to stdout
  moxxy --prompt "..." [flags]       same; flags: --allow-tools, --allow-all,
                                                  --output-format text|json|stream-json,
                                                  --model <model-id>
  moxxy telegram                     start the Telegram bot (must already be paired)
  moxxy telegram pair                begin a pairing window, print code, start bot
  moxxy telegram unpair              forget the authorized Telegram chat
  moxxy telegram status              show Telegram token + pairing status
  moxxy skills list|new <name>       manage skill files
  moxxy plugins list|reload          manage plugin host
  moxxy --help                       this help
  moxxy --version                    print version

env:
  ANTHROPIC_API_KEY                  required for the default Anthropic provider
  MOXXY_FIXTURES=record|replay       provider fixture mode (used by tests)
  MOXXY_VAULT_PASSPHRASE             headless vault passphrase (alt to keychain)
  MOXXY_TELEGRAM_TOKEN               override the vault-stored Telegram token
`;

async function main(): Promise<number> {
  const argv = parseArgv(process.argv.slice(2));

  switch (argv.command) {
    case 'help':
      process.stdout.write(HELP);
      return 0;
    case 'version':
      process.stdout.write('moxxy 0.0.0\n');
      return 0;
    case 'prompt':
      return await runPromptCommand(argv);
    case 'tui':
      return await runTuiCommand(argv);
    case 'skills':
      return await runSkillsCommand(argv);
    case 'plugins':
      return await runPluginsCommand(argv);
    case 'telegram':
      return await runTelegramCommand(argv);
    default:
      process.stderr.write(`unknown command: ${argv.command}\n${HELP}`);
      return 2;
  }
}

main().then(
  (code) => process.exit(code),
  (err) => {
    process.stderr.write(`fatal: ${err instanceof Error ? err.message : String(err)}\n`);
    process.exit(1);
  },
);
