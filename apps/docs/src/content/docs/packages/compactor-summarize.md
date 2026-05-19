---
title: '@moxxy/compactor-summarize'
description: Threshold-driven compactor that summarizes old turns when the token budget tightens.
---

`@moxxy/compactor-summarize` is the default compactor. It watches the
session's estimated token use; once usage crosses a threshold ratio of
the active model's context window, it replaces a prefix of old turns
with a single summary event — freeing space without losing the gist.

## Install

```sh
pnpm add @moxxy/compactor-summarize
```

## Use

```ts
import { summarizeCompactorPlugin } from '@moxxy/compactor-summarize';

session.pluginHost.registerStatic(summarizeCompactorPlugin);
```

Or build with custom options:

```ts
import { createSummarizeCompactor } from '@moxxy/compactor-summarize';

const compactor = createSummarizeCompactor({
  thresholdRatio: 0.75,      // compact when > 75% of the context window
  keepRecentTurns: 3,        // always keep the last 3 turns verbatim
  summary: async (text) => await myLlmSummarize(text), // optional async summarizer
});
```

## How it works

1. `shouldCompact(log, budget)` returns true once `estimatedTokens >
   thresholdRatio * contextWindow`.
2. `compact(events)` skips anything already covered by a previous
   `CompactionEvent.replacedRange` (high-water mark), drops the last
   `keepRecentTurns` turns from consideration, summarizes the remainder,
   and emits a `compaction` event covering the replaced range.
3. The session projects that event in place of the original turns next
   time the message history is folded.

This makes compaction idempotent — re-running it never double-summarizes.

## Exports

- `summarizeCompactorPlugin`, `createSummarizeCompactor`
- `SummarizeOptions`

## Default summary

If you don't pass a `summary` function, the bundled fallback truncates
to the first 5 lines + a "(N more lines)" marker. Replace it for any
real workload — a one-line LLM summary is dramatically better.
