---
title: '@moxxy/plugin-embeddings-openai'
description: OpenAI text-embedding-3-small/large as an EmbeddingProvider.
---

`@moxxy/plugin-embeddings-openai` wraps OpenAI's embedding API as an
`EmbeddingProvider`. Pair with `@moxxy/plugin-memory` to enable
vector-based recall.

## Install

```sh
pnpm add @moxxy/plugin-embeddings-openai
```

## Use

```ts
import { createOpenAIEmbedder } from '@moxxy/plugin-embeddings-openai';
import { buildMemoryPlugin } from '@moxxy/plugin-memory';
import { CachedEmbeddingProvider } from '@moxxy/sdk';

const embedder = new CachedEmbeddingProvider({
  inner: createOpenAIEmbedder({
    apiKey: process.env.OPENAI_API_KEY!,
    model: 'text-embedding-3-small', // or 'text-embedding-3-large'
  }),
  cacheDir: '~/.moxxy/memory/.embeddings',
});

const { plugin } = buildMemoryPlugin({ embedder });
session.pluginHost.registerStatic(plugin);
```

`memory_recall(mode: 'auto'|'vector')` now produces embeddings via OpenAI.

## Exports

- `OpenAIEmbedder`, `createOpenAIEmbedder`
- `OpenAIEmbedderOptions`, `OpenAIEmbeddingModel`
- `CachedEmbeddingProvider` — re-exported from `@moxxy/sdk` for back-compat; new code should import directly from the SDK.

## Caching

`CachedEmbeddingProvider` writes one file per text-hash; the next call
for the same input is a disk hit. Drop the cache dir to force regen.
