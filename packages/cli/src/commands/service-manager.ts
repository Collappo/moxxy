import { spawnSync } from 'node:child_process';
import { mkdir, readFile, unlink, writeFile } from 'node:fs/promises';
import { homedir, userInfo } from 'node:os';
import path from 'node:path';

/**
 * OS-level service manager for moxxy. Each "service" wraps a moxxy
 * subcommand that's expected to stay running indefinitely (a channel
 * bot, the scheduler poller, an HTTP listener). The platform-native
 * supervisor (launchd on macOS, systemd --user on Linux) handles
 * crash-recovery and login-restart, so users don't need to keep a
 * terminal open just to have their Telegram bot online.
 *
 * Concrete unit layout:
 *   - macOS: launchd LaunchAgent at
 *     `~/Library/LaunchAgents/com.moxxy.<id>.plist`
 *   - Linux: systemd user unit at
 *     `~/.config/systemd/user/moxxy-<id>.service`
 *
 * Logs go to `~/.moxxy/services/<id>.log` (or `$MOXXY_HOME/services/<id>.log`)
 * regardless of platform — single tail-target makes "moxxy service logs"
 * a one-liner.
 *
 * `ServiceSpec.execArgs` is appended to `[<node> <cli>]` to form the
 * unit's ExecStart. The CLI path comes from `process.argv[1]` at
 * install time, so the unit tracks whichever moxxy binary the user
 * installed (npm-link, global pnpm, etc.).
 */

export type ServicePlatform = 'darwin' | 'linux' | 'unsupported';

export interface ServiceSpec {
  /** Stable short identifier — used in unit filenames and log paths. */
  readonly id: string;
  /** One-line human description that lands in the unit's Description field. */
  readonly description: string;
  /** CLI args appended to `[<node>, <cli>]` to build the unit's ExecStart. */
  readonly execArgs: ReadonlyArray<string>;
  /** Optional extra env vars exported into the daemon process. */
  readonly env?: Readonly<Record<string, string>>;
}

export interface ServiceStatus {
  readonly platform: ServicePlatform;
  readonly id: string;
  readonly installed: boolean;
  readonly running: boolean;
  readonly unitPath: string | null;
  readonly logPath: string;
}

export interface ServiceResult {
  readonly ok: boolean;
  readonly message: string;
  readonly logPath: string;
}

export function servicePlatform(): ServicePlatform {
  if (process.platform === 'darwin') return 'darwin';
  if (process.platform === 'linux') return 'linux';
  return 'unsupported';
}

function moxxyHome(): string {
  return process.env.MOXXY_HOME ?? path.join(homedir(), '.moxxy');
}

export function serviceLogPath(spec: { id: string }): string {
  return path.join(moxxyHome(), 'services', `${spec.id}.log`);
}

export function launchdLabel(spec: { id: string }): string {
  return `com.moxxy.${spec.id}`;
}

export function plistPath(spec: { id: string }): string {
  return path.join(homedir(), 'Library', 'LaunchAgents', `${launchdLabel(spec)}.plist`);
}

export function systemdUnitName(spec: { id: string }): string {
  return `moxxy-${spec.id}.service`;
}

export function systemdUnitPath(spec: { id: string }): string {
  return path.join(homedir(), '.config', 'systemd', 'user', systemdUnitName(spec));
}

function nodeBin(): string {
  return process.execPath;
}

function cliBin(): string {
  return process.argv[1] ?? '';
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function renderPlist(spec: ServiceSpec, node: string, cli: string, log: string, home: string): string {
  const programArgs = [node, cli, ...spec.execArgs]
    .map((s) => `    <string>${escapeXml(s)}</string>`)
    .join('\n');
  // PATH is set explicitly because launchd's env is intentionally bare —
  // child processes spawned from within node (e.g. screencapture in the
  // computer-control plugin) need at least the standard bin dirs.
  const envPairs: Array<[string, string]> = [
    ['PATH', '/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin'],
    ...Object.entries(spec.env ?? {}),
  ];
  const envBlock = envPairs
    .map(([k, v]) => `    <key>${escapeXml(k)}</key>\n    <string>${escapeXml(v)}</string>`)
    .join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${escapeXml(launchdLabel(spec))}</string>
  <key>ProgramArguments</key>
  <array>
${programArgs}
  </array>
  <key>WorkingDirectory</key>
  <string>${escapeXml(home)}</string>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>StandardOutPath</key>
  <string>${escapeXml(log)}</string>
  <key>StandardErrorPath</key>
  <string>${escapeXml(log)}</string>
  <key>EnvironmentVariables</key>
  <dict>
${envBlock}
  </dict>
</dict>
</plist>
`;
}

function renderSystemdUnit(spec: ServiceSpec, node: string, cli: string, log: string, home: string): string {
  const execStart = [node, cli, ...spec.execArgs].map((s) => quoteForSystemd(s)).join(' ');
  const envLines = Object.entries(spec.env ?? {})
    .map(([k, v]) => `Environment=${k}=${v}`)
    .join('\n');
  return `[Unit]
Description=${spec.description}
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
ExecStart=${execStart}
WorkingDirectory=${home}
Restart=on-failure
RestartSec=10
StandardOutput=append:${log}
StandardError=append:${log}
${envLines}

[Install]
WantedBy=default.target
`;
}

function quoteForSystemd(s: string): string {
  // systemd ExecStart tokenization handles unquoted args fine when they
  // contain no whitespace; quote only when we need to.
  if (!/[\s"]/.test(s)) return s;
  return '"' + s.replace(/"/g, '\\"') + '"';
}

async function fileExists(p: string): Promise<boolean> {
  try {
    await readFile(p);
    return true;
  } catch {
    return false;
  }
}

export async function getServiceStatus(spec: ServiceSpec): Promise<ServiceStatus> {
  const log = serviceLogPath(spec);
  const p = servicePlatform();
  if (p === 'darwin') {
    const target = plistPath(spec);
    const installed = await fileExists(target);
    let running = false;
    if (installed) {
      const uid = userInfo().uid;
      const result = spawnSync('launchctl', ['print', `gui/${uid}/${launchdLabel(spec)}`], {
        encoding: 'utf8',
        timeout: 5000,
      });
      running = result.status === 0;
    }
    return { platform: 'darwin', id: spec.id, installed, running, unitPath: target, logPath: log };
  }
  if (p === 'linux') {
    const target = systemdUnitPath(spec);
    const installed = await fileExists(target);
    let running = false;
    if (installed) {
      const result = spawnSync('systemctl', ['--user', 'is-active', systemdUnitName(spec)], {
        encoding: 'utf8',
        timeout: 5000,
      });
      running = result.stdout.trim() === 'active';
    }
    return { platform: 'linux', id: spec.id, installed, running, unitPath: target, logPath: log };
  }
  return { platform: 'unsupported', id: spec.id, installed: false, running: false, unitPath: null, logPath: log };
}

export async function installAndStartService(spec: ServiceSpec): Promise<ServiceResult> {
  const node = nodeBin();
  const cli = cliBin();
  const log = serviceLogPath(spec);
  const home = homedir();
  if (!cli) {
    return {
      ok: false,
      message: 'could not determine the moxxy CLI path (process.argv[1] missing)',
      logPath: log,
    };
  }
  await mkdir(path.dirname(log), { recursive: true });

  if (process.platform === 'darwin') {
    const target = plistPath(spec);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, renderPlist(spec, node, cli, log, home), 'utf8');
    const uid = userInfo().uid;
    // bootout first so re-install picks up the new plist; ignore exit
    // status because "no such service" is also non-zero.
    spawnSync('launchctl', ['bootout', `gui/${uid}/${launchdLabel(spec)}`], {
      encoding: 'utf8',
      timeout: 5000,
    });
    const load = spawnSync('launchctl', ['bootstrap', `gui/${uid}`, target], {
      encoding: 'utf8',
      timeout: 10000,
    });
    if (load.status !== 0) {
      return {
        ok: false,
        message: `launchctl bootstrap failed: ${load.stderr || load.stdout || 'unknown error'}`,
        logPath: log,
      };
    }
    return { ok: true, message: `installed launchd unit ${target}`, logPath: log };
  }

  if (process.platform === 'linux') {
    const target = systemdUnitPath(spec);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, renderSystemdUnit(spec, node, cli, log, home), 'utf8');
    const reload = spawnSync('systemctl', ['--user', 'daemon-reload'], { encoding: 'utf8', timeout: 5000 });
    if (reload.status !== 0) {
      return {
        ok: false,
        message: `systemctl --user daemon-reload failed: ${reload.stderr || reload.stdout}`,
        logPath: log,
      };
    }
    const enable = spawnSync('systemctl', ['--user', 'enable', '--now', systemdUnitName(spec)], {
      encoding: 'utf8',
      timeout: 10000,
    });
    if (enable.status !== 0) {
      return {
        ok: false,
        message: `systemctl --user enable --now failed: ${enable.stderr || enable.stdout}`,
        logPath: log,
      };
    }
    return {
      ok: true,
      message:
        `installed systemd user unit ${target}  ` +
        '(run `loginctl enable-linger ' +
        userInfo().username +
        '` once so the service survives logout)',
      logPath: log,
    };
  }

  return {
    ok: false,
    message: `unsupported platform: ${process.platform} (only darwin + linux are wired up)`,
    logPath: log,
  };
}

export async function stopAndUninstallService(spec: ServiceSpec): Promise<{ ok: boolean; message: string }> {
  if (process.platform === 'darwin') {
    const target = plistPath(spec);
    if (!(await fileExists(target))) {
      return { ok: true, message: 'no launchd unit installed' };
    }
    const uid = userInfo().uid;
    spawnSync('launchctl', ['bootout', `gui/${uid}/${launchdLabel(spec)}`], { encoding: 'utf8', timeout: 5000 });
    await unlink(target).catch(() => undefined);
    return { ok: true, message: `removed ${target}` };
  }
  if (process.platform === 'linux') {
    const target = systemdUnitPath(spec);
    if (!(await fileExists(target))) {
      return { ok: true, message: 'no systemd unit installed' };
    }
    spawnSync('systemctl', ['--user', 'disable', '--now', systemdUnitName(spec)], {
      encoding: 'utf8',
      timeout: 10000,
    });
    await unlink(target).catch(() => undefined);
    spawnSync('systemctl', ['--user', 'daemon-reload'], { encoding: 'utf8', timeout: 5000 });
    return { ok: true, message: `removed ${target}` };
  }
  return { ok: false, message: `unsupported platform: ${process.platform}` };
}

/**
 * Send a start signal to an *already-installed* service.
 *
 * Distinct from `installAndStartService` so the `moxxy service start`
 * command doesn't accidentally re-install the unit file with potentially
 * different ExecStart paths (e.g. if the user moved the binary).
 */
export async function startInstalledService(spec: ServiceSpec): Promise<{ ok: boolean; message: string }> {
  if (process.platform === 'darwin') {
    if (!(await fileExists(plistPath(spec)))) {
      return { ok: false, message: 'service not installed — run `moxxy service install` first' };
    }
    const uid = userInfo().uid;
    const r = spawnSync('launchctl', ['kickstart', '-k', `gui/${uid}/${launchdLabel(spec)}`], {
      encoding: 'utf8',
      timeout: 10000,
    });
    if (r.status !== 0) {
      return { ok: false, message: `launchctl kickstart failed: ${r.stderr || r.stdout}` };
    }
    return { ok: true, message: 'started' };
  }
  if (process.platform === 'linux') {
    if (!(await fileExists(systemdUnitPath(spec)))) {
      return { ok: false, message: 'service not installed — run `moxxy service install` first' };
    }
    const r = spawnSync('systemctl', ['--user', 'start', systemdUnitName(spec)], {
      encoding: 'utf8',
      timeout: 10000,
    });
    if (r.status !== 0) return { ok: false, message: `systemctl start failed: ${r.stderr || r.stdout}` };
    return { ok: true, message: 'started' };
  }
  return { ok: false, message: `unsupported platform: ${process.platform}` };
}

/**
 * Stop a running service without uninstalling it. Re-start it later with
 * `moxxy service start` (the unit file remains in place).
 */
export async function stopRunningService(spec: ServiceSpec): Promise<{ ok: boolean; message: string }> {
  if (process.platform === 'darwin') {
    if (!(await fileExists(plistPath(spec)))) {
      return { ok: false, message: 'service not installed' };
    }
    const uid = userInfo().uid;
    // `bootout` stops AND unloads — we want to keep the plist but stop
    // the process, so `kill` works better here. SIGTERM gives the
    // process a chance to flush. KeepAlive=true would normally
    // restart it, so disable the unit briefly.
    spawnSync('launchctl', ['kill', 'SIGTERM', `gui/${uid}/${launchdLabel(spec)}`], {
      encoding: 'utf8',
      timeout: 5000,
    });
    return { ok: true, message: 'stop signal sent (KeepAlive may restart it — uninstall to stop permanently)' };
  }
  if (process.platform === 'linux') {
    if (!(await fileExists(systemdUnitPath(spec)))) {
      return { ok: false, message: 'service not installed' };
    }
    const r = spawnSync('systemctl', ['--user', 'stop', systemdUnitName(spec)], {
      encoding: 'utf8',
      timeout: 10000,
    });
    if (r.status !== 0) return { ok: false, message: `systemctl stop failed: ${r.stderr || r.stdout}` };
    return { ok: true, message: 'stopped' };
  }
  return { ok: false, message: `unsupported platform: ${process.platform}` };
}

/** Read the tail of the service log. Returns '' if the log doesn't exist yet. */
export async function readServiceLog(spec: { id: string }, lines: number): Promise<string> {
  const log = serviceLogPath(spec);
  try {
    const text = await readFile(log, 'utf8');
    const all = text.split('\n');
    const tail = all.slice(Math.max(0, all.length - lines));
    return tail.join('\n');
  } catch {
    return '';
  }
}
