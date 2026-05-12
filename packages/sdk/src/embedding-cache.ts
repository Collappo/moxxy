import { createHash } from 'node:crypto';
import type { EmbeddingProvider } from './embedding.js';

/**
 * Wraps any `EmbeddingProvider` with an in-memory content-hash cache.
 * Useful when the same text gets re-embedded across calls (e.g., a memory
 * body that doesn't change between recall invocations).
 *
 * Provider-agnostic — composes with the OpenAI plugin, the Transformers
 * plugin, or anyone else implementing `EmbeddingProvider`.
 *
 * For cross-process persistence, use `serialize` + `hydrate`.
 */
export class CachedEmbeddingProvider implements EmbeddingProvider {
  readonly name: string;
  private cache = new Map<string, ReadonlyArray<number>>();

  constructor(private readonly upstream: EmbeddingProvider) {
    this.name = `${upstream.name}+cache`;
  }

  get dim(): number | 'dynamic' {
    return this.upstream.dim;
  }

  async embed(texts: ReadonlyArray<string>): Promise<ReadonlyArray<ReadonlyArray<number>>> {
    const hashes = texts.map(hash);
    const misses: string[] = [];
    const missIndices: number[] = [];
    for (let i = 0; i < texts.length; i++) {
      if (!this.cache.has(hashes[i]!)) {
        misses.push(texts[i]!);
        missIndices.push(i);
      }
    }
    if (misses.length > 0) {
      const fresh = await this.upstream.embed(misses);
      for (let j = 0; j < missIndices.length; j++) {
        this.cache.set(hashes[missIndices[j]!]!, fresh[j]!);
      }
    }
    return hashes.map((h) => this.cache.get(h)!);
  }

  serialize(): Record<string, ReadonlyArray<number>> {
    return Object.fromEntries(this.cache);
  }

  hydrate(entries: Record<string, ReadonlyArray<number>>): void {
    for (const [k, v] of Object.entries(entries)) this.cache.set(k, v);
  }

  clear(): void {
    this.cache.clear();
  }

  get size(): number {
    return this.cache.size;
  }
}

function hash(text: string): string {
  return createHash('sha256').update(text).digest('hex').slice(0, 16);
}
