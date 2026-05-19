---
title: '@moxxy/plugin-cli'
description: The Ink-based TUI channel and shared TUI components.
---

`@moxxy/plugin-cli` ships the default `tui` channel — Ink (React for
terminals) rendering the chat view, permission dialog, prompt input,
and setup wizards — plus a handful of components and helpers reused by
other CLI surfaces.

## Install

```sh
pnpm add @moxxy/plugin-cli
```

The `@moxxy/cli` binary depends on this for its TUI; the package itself
is also useful when embedding a TUI elsewhere.

## Channel

```ts
import { tuiChannelDef, cliPlugin } from '@moxxy/plugin-cli';

session.pluginHost.registerStatic(cliPlugin);
session.channels.setActive('tui');
```

`isAvailable` refuses to boot when stdin isn't a TTY (use
`moxxy -p ...` for headless instead).

## Components

| Export | Purpose |
|---|---|
| `InteractiveSession` | Top-level Ink component: boot steps + chat. |
| `ChatView` | Streamed assistant + tool activity renderer. |
| `PromptInput` | Multi-line input with command + slash-command autocomplete. |
| `PermissionDialog` | "allow once / allow always / deny once / deny always" picker. |
| `PermissionEditor` | Standalone Ink editor for `~/.moxxy/permissions.json` (`moxxy perms` mounts this). |
| `Logo`, `LOGO_LINES`, `SLOGANS`, `pickSlogan` | Branding helpers. |

## Resolver

`createInteractivePermissionResolver({ onPrompt })` returns a
`PermissionResolver` that funnels every check into the user-supplied
`onPrompt` callback (typically wiring the Ink dialog).

## Setup YAML

`renderYaml(selections)` and `SetupChoice`/`SetupSelections` types
back the post-wizard "here's the YAML that would be written"
preview. The wizard itself lives in `packages/cli/src/wizard/`.

## Preferences

Re-exports `loadPreferences` / `savePreferences` / `preferencesPath`
from `@moxxy/core` for TUI components that need to read user prefs
(theme, default loop, etc.) without re-implementing the file format.
