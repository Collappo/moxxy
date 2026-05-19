---
title: '@moxxy/tools-builtin'
description: Read / Write / Edit / Bash / Grep / Glob — the canonical filesystem + shell toolset.
---

`@moxxy/tools-builtin` ships the six tools every coding agent expects.
Core depends on this package directly (it's the only plugin-shaped
package core is allowed to import).

## Install

```sh
pnpm add @moxxy/tools-builtin
```

## Use

```ts
import { builtinToolsPlugin } from '@moxxy/tools-builtin';

session.pluginHost.registerStatic(builtinToolsPlugin);
```

## Tools

| Tool | Purpose |
|---|---|
| `Read` | Read a file (bytes / lines / pages for PDF). |
| `Write` | Create or overwrite a file. |
| `Edit` | In-place edit with old/new string matching. |
| `Bash` | Run a shell command. Cooperative aborts via `ctx.signal`. |
| `Grep` | ripgrep-style search across the workspace. |
| `Glob` | Glob-style file listing. |

Each tool is exported individually (`bashTool`, `editTool`, …) so a
custom plugin can re-bundle a subset.

## Why these six

They are the minimum surface a coding agent needs to do anything
useful in a repo. Everything else — running tests, opening URLs,
talking to APIs — is up to plugins.

`dispatch_agent` was moved out of this package into
`@moxxy/plugin-subagents` so subagent support is itself a swappable
block. Install that plugin if you want fan-out.
