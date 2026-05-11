import { setupSessionWithConfig } from '../setup.js';
import type { ParsedArgv } from '../argv.js';

export async function runChannelsCommand(argv: ParsedArgv): Promise<number> {
  const sub = argv.positional[0] ?? 'list';
  if (sub === 'list') {
    const { session } = await setupSessionWithConfig({ cwd: process.cwd() });
    for (const def of session.channels.list()) {
      process.stdout.write(`${def.name}\t${def.description}\n`);
    }
    return 0;
  }
  process.stderr.write(`unknown 'channels' subcommand: ${sub}\n  moxxy channels list\n`);
  return 2;
}
