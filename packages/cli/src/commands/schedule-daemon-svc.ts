import {
  getServiceStatus,
  installAndStartService,
  stopAndUninstallService,
  type ServiceSpec,
  type ServiceStatus,
} from './service-manager.js';

/**
 * Back-compat shim — the scheduler daemon now rides on the generic
 * `ServiceManager` so it shares unit-rendering, log paths, and
 * launchd/systemd plumbing with the other channel services that
 * `moxxy service` can install. The `schedule` command keeps its
 * existing public functions; they just forward into the manager with
 * the scheduler's ServiceSpec.
 */

export const SCHEDULER_SERVICE: ServiceSpec = {
  id: 'scheduler',
  description: 'moxxy scheduler — fires time-driven prompts',
  execArgs: ['schedule', 'daemon'],
};

export interface DaemonServiceStatus {
  readonly platform: ServiceStatus['platform'];
  readonly installed: boolean;
  readonly running: boolean;
  readonly unitPath: string | null;
  readonly logPath: string | null;
}

export async function getDaemonStatus(): Promise<DaemonServiceStatus> {
  const s = await getServiceStatus(SCHEDULER_SERVICE);
  return {
    platform: s.platform,
    installed: s.installed,
    running: s.running,
    unitPath: s.unitPath,
    logPath: s.platform === 'unsupported' ? null : s.logPath,
  };
}

export async function installAndStartDaemon(): Promise<{ ok: boolean; message: string; logPath: string }> {
  return await installAndStartService(SCHEDULER_SERVICE);
}

export async function stopAndUninstallDaemon(): Promise<{ ok: boolean; message: string }> {
  return await stopAndUninstallService(SCHEDULER_SERVICE);
}
