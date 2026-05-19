---
title: '@moxxy/testing'
description: FakeProvider, record/replay fixtures, session helpers.
---

`@moxxy/testing` is the test harness for moxxy itself and for plugin
authors. Three building blocks:

- **`FakeProvider`** — scripted replies, no network.
- **Record/replay fixtures** — wrap a real provider; record once, replay forever.
- **Session helpers** — pre-built sessions for tests that don't care about wiring.

## Install

```sh
pnpm add -D @moxxy/testing
```

## FakeProvider

```ts
import { FakeProvider, textReply, toolUseReply } from '@moxxy/testing';

const provider = new FakeProvider({
  replies: [
    toolUseReply([{ name: 'Read', input: { path: 'a.ts' } }]),
    textReply('done.'),
  ],
});

session.providers.register('fake', { models: [{ id: 'fake-1' }], createClient: () => provider });
session.providers.setActive('fake');
```

`streamingTextReply(chunks)` for testing chunk-level handling.

## Record / replay

```ts
import { RecordedProvider, fixtureMode } from '@moxxy/testing';

const provider = new RecordedProvider({
  delegate: realProvider,
  fixtureDir: './fixtures',
  mode: fixtureMode(process.env.MOXXY_FIXTURES), // 'record' | 'replay' | 'passthrough'
});
```

`MOXXY_FIXTURES=record` writes a deterministic JSON file per request
(keyed by `hashRequest`). `replay` reads from disk; `passthrough` is
the no-op identity.

## Session helpers

```ts
import { createFakeSession } from '@moxxy/testing';

const session = await createFakeSession({
  replies: [textReply('ok')],
  // tools: [...] // extra tools beyond builtin
});
```

Skips the vault, plugin discovery, and provider auth — useful when the
test only cares about the loop / hook / channel under test.

## Exports

- `FakeProvider`, `FakeProviderOptions`, `ScriptedReply`, `ScriptedReplies`
- `textReply`, `toolUseReply`, `streamingTextReply`
- `RecordedProvider`, `RecordedProviderOptions`, `fixtureMode`, `FixtureMode`
- `createFakeSession`, `FakeSessionOptions`
- `hashRequest(req)` — the fixture key function
