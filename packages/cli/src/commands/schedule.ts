import * as path from 'node:path';
import * as os from 'node:os';
import { PermissionEngine } from '@moxxy/core';
import { isValidCron, nextFireTime, runSchedule } from '@moxxy/plugin-scheduler';
import type { ScheduleEntry } from '@moxxy/plugin-scheduler';
import type { ParsedArgv } from '../argv.js';
import { colors } from '../colors.js';
import { setupSessionWithConfig } from '../setup.js';
import {
  getDaemonStatus,
  installAndStartDaemon,
  stopAndUninstallDaemon,
} from './schedule-daemon-svc.js';
import { formatHelp } from './help-format.js';

const HELP = formatHelp({
  title: 'moxxy schedule',
  tagline: 'manage time-driven prompts',
  sections: [
    {
      title: 'COMMANDS',
      rows: [
        ['list', 'show every schedule with next fire time'],
        ['add <name> --cron "<expr>" --prompt "…"', 'create a recurring schedule'],
        ['add <name> --at "<iso>" --prompt "…"', 'create a one-shot at a specific timestamp'],
        ['remove <id>', 'delete a schedule'],
        ['enable <id>', 're-enable a disabled schedule'],
        ['disable <id>', 'pause without deleting'],
        ['run <id>', 'fire one immediately (for testing)'],
      ],
    },
    {
      title: 'DAEMON',
      rows: [
        ['daemon', 'run the poller headless until ^C'],
        ['daemon --background', 'install + start an OS unit (launchd / systemd --user)'],
        ['daemon --status', 'report whether the OS unit is loaded'],
        ['daemon --stop', 'unload + delete the OS unit'],
        ['setup', 'install the daemon AND pre-allow common headless tools'],
      ],
    },
    {
      title: 'ADD FLAGS',
      rows: [
        ['--channel <name>', "soft hint, e.g. 'telegram' (prompt calls the matching send tool)"],
        ['--model <id>', 'override the active model just for this schedule'],
        ['--timezone <zone>', 'IANA zone for cron interpretation (default: system local)'],
      ],
    },
  ],
  footer: [
    "Schedules are stored in ~/.moxxy/schedules.json. For 24/7 firing run",
    "'moxxy schedule daemon --background' once; for ad-hoc testing the",
    "foreground 'moxxy schedule daemon' (Ctrl+C to stop) is fine.",
  ],
});

function fmtNext(entry: ScheduleEntry): string {
  if (entry.cron) {
    const since = entry.lastRunAt ?? entry.createdAt;
    const next = nextFireTime(entry.cron, new Date(since), entry.timeZone);
    return next ? next.toISOString() : '(never — invalid)';
  }
  if (entry.runAt && entry.enabled) return new Date(entry.runAt).toISOString();
  return '(done)';
}

function flag(argv: ParsedArgv, key: string): string | undefined {
  const v = argv.flags[key];
  return typeof v === 'string' ? v : undefined;
}

export async function runScheduleCommand(argv: ParsedArgv): Promise<number> {
  const sub = argv.positional[0] ?? 'list';

  if (sub === 'help' || sub === '--help' || sub === '-h' || argv.flags['help'] === true) {
    process.stdout.write(HELP);
    return 0;
  }

  if (sub === 'setup') return await runSetup(argv);

  // `daemon` has four modes:
  //   1. (default) — run the poller in the foreground until ^C.
  //   2. --background — install an OS unit and exit immediately.
  //   3. --stop      — uninstall the OS unit.
  //   4. --status    — report whether the OS unit is loaded + running.
  if (sub === 'daemon') {
    if (argv.flags.stop) {
      const result = await stopAndUninstallDaemon();
      process.stdout.write(
        `${result.ok ? colors.bold('stopped') : colors.red('failed')}  ${colors.dim(result.message)}\n`,
      );
      return result.ok ? 0 : 1;
    }
    if (argv.flags.status) {
      const status = await getDaemonStatus();
      if (status.platform === 'unsupported') {
        process.stdout.write(colors.red('background daemon is unsupported on this platform') + '\n');
        return 1;
      }
      const rows: Array<[string, string]> = [
        ['platform', status.platform],
        ['installed', status.installed ? 'yes' : 'no'],
        ['running', status.running ? 'yes' : 'no'],
      ];
      if (status.unitPath) rows.push(['unit', status.unitPath]);
      if (status.logPath) rows.push(['log', status.logPath]);
      const col = Math.max(...rows.map(([k]) => k.length));
      for (const [k, v] of rows) {
        process.stdout.write(`${colors.bold(k.padEnd(col))}  ${colors.dim(v)}\n`);
      }
      return 0;
    }
    if (argv.flags.background) {
      const result = await installAndStartDaemon();
      process.stdout.write(
        `${result.ok ? colors.bold('started') : colors.red('failed')}  ${colors.dim(result.message)}\n`,
      );
      if (result.ok) {
        process.stdout.write(
          colors.dim(`         logs: ${result.logPath}\n         manage: moxxy schedule daemon --status|--stop\n`),
        );
      }
      return result.ok ? 0 : 1;
    }

    // Foreground path — boot a full session and idle while the
    // poller (installed by the scheduler plugin's onInit hook) ticks.
    const { session, scheduler } = await setupSessionWithConfig({ cwd: process.cwd() });
    process.stdout.write(
      `${colors.bold('scheduler daemon')}  ${colors.dim('provider=' + (session.providers.getActiveName() ?? '(none)'))}\n` +
        colors.dim('                 ^C to stop. Schedules fire while this process is alive.\n'),
    );
    let stopRequested = false;
    const shutdown = async (): Promise<void> => {
      if (stopRequested) return;
      stopRequested = true;
      process.stdout.write('\nstopping scheduler…\n');
      await scheduler.poller.stop();
      process.exit(0);
    };
    process.on('SIGINT', () => void shutdown());
    process.on('SIGTERM', () => void shutdown());
    // Idle forever — the poller uses unref'd timers, so we need a
    // long-lived handle to keep the event loop alive. setInterval at
    // a long cadence costs nothing.
    setInterval(() => {}, 60_000);
    return await new Promise<number>(() => {
      /* never resolves; SIGINT calls shutdown() which exits the process */
    });
  }

  // All non-daemon paths need the store but NOT the provider, so we
  // can short-circuit setup if it ever offers that mode. For now,
  // setupSessionWithConfig is the only setup entry — call it with
  // tolerateNoProvider so 'moxxy schedule list' works pre-init.
  const { scheduler } = await setupSessionWithConfig({
    cwd: process.cwd(),
    skipKeyPrompt: true,
    tolerateNoProvider: true,
  });

  switch (sub) {
    case 'list': {
      const all = await scheduler.store.list();
      if (all.length === 0) {
        process.stdout.write(colors.dim('(no schedules — add one with `moxxy schedule add` or a tool call)\n'));
        return 0;
      }
      const nameCol = Math.max(8, ...all.map((s) => s.name.length));
      for (const s of all) {
        const status = s.enabled ? 'on' : 'off';
        const src = s.source === 'skill' ? `skill:${s.skillName}` : 'manual';
        const trig = s.cron ? `cron "${s.cron}"` : `at ${new Date(s.runAt!).toISOString()}`;
        process.stdout.write(
          `${colors.bold(s.name.padEnd(nameCol))}  ${colors.dim(status)}  ${colors.dim(trig)}\n` +
            `${' '.repeat(nameCol + 2)}${colors.dim(`id ${s.id} · ${src} · next ${fmtNext(s)}`)}\n` +
            `${' '.repeat(nameCol + 2)}${colors.dim(s.prompt.slice(0, 80).replace(/\n/g, ' ') + (s.prompt.length > 80 ? '…' : ''))}\n`,
        );
      }
      return 0;
    }

    case 'add': {
      const name = argv.positional[1];
      const prompt = flag(argv, 'prompt');
      const cron = flag(argv, 'cron');
      const at = flag(argv, 'at');
      if (!name || !prompt || (!cron && !at)) {
        process.stderr.write(
          colors.red('missing required args') +
            '\n  usage: moxxy schedule add <name> --cron "<expr>" --prompt "<text>"\n' +
            '         moxxy schedule add <name> --at "<iso>" --prompt "<text>"\n',
        );
        return 2;
      }
      if (cron && !isValidCron(cron)) {
        process.stderr.write(colors.red(`invalid cron expression: "${cron}"`) + '\n');
        return 2;
      }
      const runAt = at ? Date.parse(at) : undefined;
      if (at && (runAt === undefined || Number.isNaN(runAt))) {
        process.stderr.write(colors.red(`invalid --at timestamp: "${at}"`) + '\n');
        return 2;
      }
      const created = await scheduler.store.create({
        name,
        prompt,
        ...(cron ? { cron } : {}),
        ...(runAt !== undefined ? { runAt } : {}),
        ...(flag(argv, 'timezone') ? { timeZone: flag(argv, 'timezone')! } : {}),
        ...(flag(argv, 'channel') ? { channel: flag(argv, 'channel')! } : {}),
        ...(flag(argv, 'model') ? { model: flag(argv, 'model')! } : {}),
      });
      process.stdout.write(
        `${colors.bold('created')}  ${colors.bold(created.name)}  ${colors.dim(created.id)}\n` +
          `         ${colors.dim('next: ' + fmtNext(created))}\n`,
      );
      return 0;
    }

    case 'remove': {
      const id = argv.positional[1];
      if (!id) {
        process.stderr.write(colors.red('missing id') + '\n  usage: moxxy schedule remove <id>\n');
        return 2;
      }
      const ok = await scheduler.store.delete(id);
      process.stdout.write(
        ok ? `${colors.bold('removed')}  ${id}\n` : colors.dim(`no schedule with id ${id}`) + '\n',
      );
      return ok ? 0 : 1;
    }

    case 'enable':
    case 'disable': {
      const id = argv.positional[1];
      if (!id) {
        process.stderr.write(`${colors.red('missing id')}\n  usage: moxxy schedule ${sub} <id>\n`);
        return 2;
      }
      const updated = await scheduler.store.update(id, { enabled: sub === 'enable' });
      if (!updated) {
        process.stderr.write(colors.dim(`no schedule with id ${id}`) + '\n');
        return 1;
      }
      process.stdout.write(`${colors.bold(sub === 'enable' ? 'enabled' : 'disabled')}  ${updated.name}\n`);
      return 0;
    }

    case 'run': {
      const id = argv.positional[1];
      if (!id) {
        process.stderr.write(colors.red('missing id') + '\n  usage: moxxy schedule run <id>\n');
        return 2;
      }
      // `run` needs a real session to dispatch the prompt — reboot
      // with provider activation.
      const { session, scheduler: full } = await setupSessionWithConfig({ cwd: process.cwd() });
      void session;
      const entry = await full.store.get(id);
      if (!entry) {
        process.stderr.write(colors.dim(`no schedule with id ${id}`) + '\n');
        return 1;
      }
      process.stdout.write(`${colors.bold('firing')}   ${entry.name}…\n`);
      const outcome = await runSchedule(entry, {
        runPrompt: async ({ prompt, model }) => {
          const { runTurn } = await import('@moxxy/core');
          let text = '';
          for await (const event of runTurn(session, prompt, model ? { model } : {})) {
            if (event.type === 'assistant_message') text = event.content;
          }
          return { text };
        },
      }, full.store);
      const tag = outcome.ok ? colors.bold('done') : colors.red('fail');
      process.stdout.write(
        `${tag}     ${colors.dim('inbox: ' + (outcome.inboxPath ?? '(none)'))}\n` +
          (outcome.error ? `         ${colors.red(outcome.error)}\n` : '') +
          (outcome.text ? `         ${colors.dim(outcome.text.slice(0, 400))}\n` : ''),
      );
      return outcome.ok ? 0 : 1;
    }

    default:
      process.stderr.write(colors.red(`unknown subcommand: ${sub}`) + '\n' + HELP);
      return 2;
  }
}

const DEFAULT_HEADLESS_ALLOW_TOOLS = ['telegram_send_message', 'web_fetch'];

async function runSetup(argv: ParsedArgv): Promise<number> {
  // Tools to pre-allow. Default covers the two most common delivery
  // shapes (Telegram push + web_fetch for scraping). Users override
  // with --allow tool1,tool2 — passing --allow '' clears the list so
  // no permissions are touched.
  const allowFlag = argv.flags.allow;
  const tools =
    typeof allowFlag === 'string'
      ? allowFlag
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean)
      : DEFAULT_HEADLESS_ALLOW_TOOLS;

  const skipDaemon = argv.flags['no-daemon'] === true;

  process.stdout.write(colors.bold('moxxy scheduler setup') + '\n\n');

  const tag = (ok: boolean): string => (ok ? colors.bold('ok  ') : colors.red('fail'));

  // Step 1 — pre-allow tools for headless fires.
  if (tools.length === 0) {
    process.stdout.write(`${colors.bold('skip')}  ${colors.dim('tool allowlist (--allow="")')}\n`);
  } else {
    const policyPath = path.join(os.homedir(), '.moxxy', 'permissions.json');
    const engine = await PermissionEngine.load(policyPath);
    const before = engine.policySnapshot;
    const existingAllowNames = new Set(before.allow.map((r) => r.name));
    const added: string[] = [];
    const skipped: string[] = [];
    for (const t of tools) {
      if (existingAllowNames.has(t)) {
        skipped.push(t);
        continue;
      }
      await engine.addAllow({ name: t, reason: 'moxxy schedule setup — headless fire' });
      added.push(t);
    }
    process.stdout.write(
      `${tag(true)}  ${colors.bold('allow')}  ` +
        (added.length > 0 ? colors.bold(added.join(', ')) : colors.dim('(none new)')) +
        (skipped.length > 0 ? colors.dim(`  [already allowed: ${skipped.join(', ')}]`) : '') +
        '\n' +
        `        ${colors.dim('→ ' + policyPath)}\n`,
    );
  }

  // Step 2 — install the background OS unit.
  if (skipDaemon) {
    process.stdout.write(`${colors.bold('skip')}  ${colors.dim('daemon install (--no-daemon)')}\n`);
  } else {
    const result = await installAndStartDaemon();
    process.stdout.write(`${tag(result.ok)}  ${colors.bold('daemon')}  ${colors.dim(result.message)}\n`);
    if (result.ok) {
      process.stdout.write(`        ${colors.dim('→ logs: ' + result.logPath)}\n`);
    } else {
      process.stdout.write(
        `        ${colors.dim('→ see `moxxy schedule daemon --status` after fixing the error above')}\n`,
      );
    }
  }

  // Step 3 — Telegram pairing status (informational, doesn't fail setup).
  if (tools.includes('telegram_send_message')) {
    try {
      const { vault } = await setupSessionWithConfig({
        cwd: process.cwd(),
        skipKeyPrompt: true,
        tolerateNoProvider: true,
      });
      const hasToken = await vault.has('telegram_bot_token');
      const chatRaw = await vault.get('telegram_authorized_chat_id');
      const hasChat = !!chatRaw;
      if (hasToken && hasChat) {
        process.stdout.write(
          `${tag(true)}  ${colors.bold('telegram')}  ${colors.dim('token + paired chat ' + Number(chatRaw))}\n`,
        );
      } else {
        const missing: string[] = [];
        if (!hasToken) missing.push('bot token');
        if (!hasChat) missing.push('paired chat');
        process.stdout.write(
          `${tag(false)}  ${colors.bold('telegram')}  ${colors.dim('missing ' + missing.join(' + '))}\n` +
            `          ${colors.dim('→ run `moxxy telegram` to pair')}\n`,
        );
      }
    } catch (err) {
      process.stdout.write(
        `${tag(false)}  ${colors.bold('telegram')}  ${colors.dim('check failed: ' + (err instanceof Error ? err.message : String(err)))}\n`,
      );
    }
  }

  process.stdout.write(
    '\n' +
      colors.bold('NEXT') + '\n' +
      `  ${colors.dim('· create a schedule from a moxxy chat ("send me HN at 9am via telegram")')}\n` +
      `  ${colors.dim('· moxxy schedule list / moxxy schedule run <id>')}\n`,
  );
  return 0;
}
