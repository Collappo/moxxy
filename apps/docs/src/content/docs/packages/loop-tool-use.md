---
title: '@moxxy/loop-tool-use'
description: Default Claude-Code-style loop — call provider, run tools, repeat until done.
---

`@moxxy/loop-tool-use` is the default loop strategy. The model calls
tools; the loop runs them and feeds results back; the model emits a
final `assistant_message` to stop. Best for everything well-scoped.

## Install

```sh
pnpm add @moxxy/loop-tool-use
```

## Use

```ts
import { toolUseLoopPlugin } from '@moxxy/loop-tool-use';

session.pluginHost.registerStatic(toolUseLoopPlugin);
session.loops.setActive('tool-use');
```

## Exports

- `toolUseLoop` — the `LoopStrategyDef`.
- `toolUseLoopPlugin` — the `Plugin` you register.
- `TOOL_USE_LOOP_NAME` — the registered name (`'tool-use'`).
- `CollectedToolUse` — internal type re-exported for advanced wrappers.

## See also

- [Loop strategies guide](../guides/loop-strategies) — comparison with `plan-execute` and `bmad`.
