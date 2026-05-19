---
title: '@moxxy/plugin-embeddings-transformers'
description: Local CPU embeddings via @huggingface/transformers.
---

`@moxxy/plugin-embeddings-transformers` is the local embedding option.
It runs `@huggingface/transformers` on the CPU — no API call, no key,
no network — useful when you want vector recall without sending your
memory contents to OpenAI.

## Install

```sh
pnpm add @moxxy/plugin-embeddings-transformers @huggingface/transformers
```

The model weights download on first use (cached under
`~/.cache/huggingface/`).

## Use

```ts
import { createTransformersEmbedder } from '@moxxy/plugin-embeddings-transformers';
import { buildMemoryPlugin } from '@moxxy/plugin-memory';
import { CachedEmbeddingProvider } from '@moxxy/sdk';

const embedder = new CachedEmbeddingProvider({
  inner: createTransformersEmbedder({
    model: 'Xenova/all-MiniLM-L6-v2', // default
  }),
  cacheDir: '~/.moxxy/memory/.embeddings',
});

const { plugin } = buildMemoryPlugin({ embedder });
session.pluginHost.registerStatic(plugin);
```

## Exports

- `TransformersEmbedder`, `createTransformersEmbedder`
- `TransformersEmbedderOptions`
- `PipelineFactory` — escape hatch for tests / custom model loaders.

## Trade-offs

- Pros: no API key, no network, no per-call cost, no data leaves your machine.
- Cons: first call is slow (downloads weights, warms a worker); embedding
  quality on the default MiniLM is below `text-embedding-3-large`.

For memory of ~hundreds of entries, MiniLM is fine. For thousands +
nuanced semantic recall, OpenAI's models do better.
