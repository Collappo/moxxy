import type { ParsedArgv } from '../argv.js';
import { bootSession, helpRequested } from '../argv-helpers.js';
import { printError } from '../errors.js';
import { runPluginNewCommand } from './plugin-new.js';
import { colors } from '../colors.js';
import { formatHelp } from './help-format.js';

const HELP = formatHelp({
  title: 'moxxy plugins',
  tagline: 'manage the plugin host',
  sections: [
    {
      title: 'COMMANDS',
      rows: [
        ['list', 'list loaded plugins'],
        ['reload', 'rescan discovery roots and hot-reload'],
        ['new <name> [--here]', 'scaffold a new user-scope plugin'],
      ],
    },
  ],
});

export async function runPluginsCommand(argv: ParsedArgv): Promise<number> {
  const sub = argv.positional[0] ?? 'list';
  if (sub === 'new') {
    return await runPluginNewCommand(argv);
  }
  if (sub === 'help' || helpRequested(argv)) {
    process.stdout.write(HELP);
    return 0;
  }
  const session = await bootSession(argv, {
    skipKeyPrompt: true,
    tolerateNoProvider: true,
    skipProviderActivation: true,
  });
  if (sub === 'list') {
    const list = session.pluginHost.list();
    const nameCol = Math.max(8, ...list.map((p) => p.name.length));
    for (const p of list) {
      process.stdout.write(
        `${colors.bold(p.name.padEnd(nameCol))}  ${colors.dim('@' + p.version)}\n`,
      );
    }
    return 0;
  }
  if (sub === 'reload') {
    await session.pluginHost.reload();
    process.stdout.write(colors.dim('reload complete') + '\n');
    return 0;
  }
  printError(`unknown 'plugins' subcommand: ${sub}\n${HELP}`);
  return 2;
}
