---
title: '@moxxy/loop-bmad'
description: BMAD — Analysis → Planning → Solutioning → Implementation, multi-persona.
---

`@moxxy/loop-bmad` implements the BMAD method (Breakthrough Method for
Agile AI-Driven Development). A single user request flows through four
sequential phases, each owned by a different persona, with the
artifact from each phase becoming the input for the next.

## Phases

1. **Analysis** — Analyst → one-page PRD-style brief.
2. **Planning** — Product Manager → numbered stories with acceptance criteria.
3. **Solutioning** — Architect → short design + change list.
4. **Implementation** — Developer → tool-use sub-loop per story.

Between phases, an optional approval gate lets the user approve /
redraft / cancel. Without a resolver (headless / non-TTY) the loop
proceeds end to end.

Inspired by [bmad-code-org/BMAD-METHOD](https://github.com/bmad-code-org/BMAD-METHOD).

## Install

```sh
pnpm add @moxxy/loop-bmad
```

## Use

```ts
import { bmadLoopPlugin } from '@moxxy/loop-bmad';

session.pluginHost.registerStatic(bmadLoopPlugin);
session.loops.setActive('bmad');
```

Switch interactively with `/loop bmad`.

## Exports

- `bmadLoop`, `bmadLoopPlugin`
- `BMAD_LOOP_NAME` — `'bmad'`
- `parseStories(text)` — story parser used by the planning phase.

## When to pick bmad

Pick `bmad` when `plan-execute` under-specifies — multi-stakeholder
requests where UX, API design, data model, and implementation all need
distinct treatment. For everything else, `tool-use` is faster.

## See also

- [Loop strategies guide](../guides/loop-strategies) — comparison + switching.
- [Sub-agents](../guides/subagents) — `dispatch_agent({ loopStrategy: 'bmad' })`.
