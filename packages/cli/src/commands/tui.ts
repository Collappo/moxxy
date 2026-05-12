import {
  createInteractivePermissionResolver,
  InteractiveSession,
  loadPreferences,
} from '@moxxy/plugin-cli';
import { render } from 'ink';
import React from 'react';
import type { PendingToolCall, PermissionContext, PermissionDecision } from '@moxxy/sdk';
import { loadConfig } from '@moxxy/config';
import { setupSession } from '../setup.js';
import { argvToSetupOptions, stringFlag } from '../argv-helpers.js';
import type { ParsedArgv } from '../argv.js';
import { cliVersion } from '../version.js';
import { runInitCommand } from './init.js';

export async function runTuiCommand(argv: ParsedArgv): Promise<number> {
  // Auto-init when first-run conditions hit:
  //   (a) no config file anywhere — no moxxy.config.yaml in the project,
  //       no ~/.moxxy/config.yaml in the user dir
  //   (b) config exists but no provider could activate — e.g. the user
  //       deleted vault entries, the env keys aren't set, etc.
  //
  // Both cases used to bail with "no working provider key" which is
  // unfriendly on first run. We skip auto-init on non-TTY stdin so
  // headless invocations still hit the explicit env-var guidance.
  if (process.stdin.isTTY) {
    const { sources } = await loadConfig({
      cwd: process.cwd(),
      ...(stringFlag(argv, 'config') ? { explicitPath: stringFlag(argv, 'config')! } : {}),
    });
    let needsInit = sources.length === 0;
    if (!needsInit) {
      // Probe whether a provider would activate without actually
      // throwing. `tolerateNoProvider: true` makes setupSession return
      // a session even when activation failed, so we can inspect the
      // active state and re-run init if it's empty.
      try {
        const probe = await setupSession({
          ...argvToSetupOptions(argv),
          tolerateNoProvider: true,
          skipKeyPrompt: true,
        });
        if (!probe.providers.getActiveName()) needsInit = true;
      } catch {
        needsInit = true;
      }
    }
    if (needsInit) {
      const code = await runInitCommand(argv);
      if (code !== 0) return code;
      // Wizard wrote a config / saved a key (or the user quit). If they
      // quit without finishing, the subsequent setupSession will throw
      // with the usual guidance — we don't try to distinguish here.
    }
  }

  let promptHandler:
    | ((call: PendingToolCall, ctx: PermissionContext) => Promise<PermissionDecision>)
    | null = null;

  const resolver = createInteractivePermissionResolver({
    name: 'tui',
    prompt: async (call, ctx) => {
      if (!promptHandler) return { mode: 'deny', reason: 'TUI not ready' };
      return promptHandler(call, ctx);
    },
  });

  const session = await setupSession({
    ...argvToSetupOptions(argv),
    resolver,
  });

  // Make sure the vault is unlocked (passphrase prompt fires here, with
  // the visible banner from @moxxy/plugin-vault) BEFORE Ink mounts — the
  // readline prompt would otherwise deadlock against the TUI's stdin.
  // No-op when keytar is wired or MOXXY_VAULT_PASSPHRASE is set.
  // We don't reach the vault here directly; setupSession already touches
  // it during provider activation, so this is just a safety net for the
  // skipKeyPrompt path that bypasses activation.

  // CLI flag wins over persisted preference; only fall back to prefs when
  // the user didn't explicitly pass --model. The TUI itself writes back
  // to preferences as the user picks via /model.
  const cliModel = stringFlag(argv, 'model');
  const prefs = await loadPreferences();
  const effectiveModel = cliModel ?? prefs.model;
  const version = cliVersion();
  const { waitUntilExit } = render(
    React.createElement(InteractiveSession, {
      session,
      registerInteractiveResolver: (handler) => {
        promptHandler = handler;
      },
      ...(effectiveModel ? { model: effectiveModel } : {}),
      ...(version ? { version } : {}),
    }),
  );

  await waitUntilExit();
  return 0;
}
