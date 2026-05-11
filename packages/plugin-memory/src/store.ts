import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { z } from 'zod';
import { parseMdFile, renderFrontmatter } from './parse.js';

export const memoryTypeSchema = z.enum(['fact', 'preference', 'project', 'reference']);
export type MemoryType = z.infer<typeof memoryTypeSchema>;

export const memoryFrontmatterSchema = z.object({
  name: z.string().min(1).max(120).regex(/^[a-z0-9][a-z0-9-]*$/, 'name must be slug-like'),
  type: memoryTypeSchema,
  description: z.string().min(1).max(280),
  tags: z.array(z.string().min(1)).optional(),
  createdAt: z.string().optional(),
  updatedAt: z.string().optional(),
});

export type MemoryFrontmatter = z.infer<typeof memoryFrontmatterSchema>;

export interface MemoryEntry {
  readonly frontmatter: MemoryFrontmatter;
  readonly body: string;
  readonly path: string;
}

export interface MemoryStoreOptions {
  readonly dir?: string;
}

export function defaultMemoryDir(): string {
  return path.join(os.homedir(), '.moxxy', 'memory');
}

export class MemoryStore {
  readonly dir: string;
  constructor(opts: MemoryStoreOptions = {}) {
    this.dir = opts.dir ?? defaultMemoryDir();
  }

  async list(filterType?: MemoryType): Promise<ReadonlyArray<MemoryEntry>> {
    const entries: MemoryEntry[] = [];
    let names: import('node:fs').Dirent[];
    try {
      names = await fs.readdir(this.dir, { withFileTypes: true });
    } catch (err) {
      if (isEnoent(err)) return [];
      throw err;
    }
    for (const dirent of names) {
      if (!dirent.isFile()) continue;
      if (!dirent.name.endsWith('.md')) continue;
      if (dirent.name === 'MEMORY.md') continue;
      const filePath = path.join(this.dir, dirent.name);
      const raw = await fs.readFile(filePath, 'utf8');
      const parsed = parseMdFile(raw);
      const result = memoryFrontmatterSchema.safeParse(parsed.frontmatter);
      if (!result.success) continue;
      if (filterType && result.data.type !== filterType) continue;
      entries.push({
        frontmatter: result.data,
        body: parsed.body.trim(),
        path: filePath,
      });
    }
    return entries;
  }

  async get(name: string): Promise<MemoryEntry | null> {
    const filePath = this.fileFor(name);
    try {
      const raw = await fs.readFile(filePath, 'utf8');
      const parsed = parseMdFile(raw);
      const result = memoryFrontmatterSchema.safeParse(parsed.frontmatter);
      if (!result.success) return null;
      return {
        frontmatter: result.data,
        body: parsed.body.trim(),
        path: filePath,
      };
    } catch (err) {
      if (isEnoent(err)) return null;
      throw err;
    }
  }

  async save(
    input: Omit<MemoryFrontmatter, 'createdAt' | 'updatedAt'> & { body: string },
  ): Promise<MemoryEntry> {
    await fs.mkdir(this.dir, { recursive: true });
    const filePath = this.fileFor(input.name);
    const existing = await safeRead(filePath);
    const now = new Date().toISOString();
    const createdAt = existing?.frontmatter.createdAt ?? now;
    const frontmatter = memoryFrontmatterSchema.parse({
      name: input.name,
      type: input.type,
      description: input.description,
      ...(input.tags !== undefined ? { tags: input.tags } : {}),
      createdAt,
      updatedAt: now,
    });
    const content = `${renderFrontmatter(frontmatter)}\n\n${input.body.trimEnd()}\n`;
    await fs.writeFile(filePath, content, 'utf8');
    await this.rebuildIndex();
    return { frontmatter, body: input.body.trimEnd(), path: filePath };
  }

  async update(
    name: string,
    patch: { body?: string; description?: string; tags?: ReadonlyArray<string> },
  ): Promise<MemoryEntry | null> {
    const existing = await this.get(name);
    if (!existing) return null;
    const mergedTags = patch.tags ?? existing.frontmatter.tags;
    return this.save({
      name: existing.frontmatter.name,
      type: existing.frontmatter.type,
      description: patch.description ?? existing.frontmatter.description,
      ...(mergedTags ? { tags: [...mergedTags] } : {}),
      body: patch.body ?? existing.body,
    });
  }

  async forget(name: string): Promise<boolean> {
    const filePath = this.fileFor(name);
    try {
      await fs.unlink(filePath);
      await this.rebuildIndex();
      return true;
    } catch (err) {
      if (isEnoent(err)) return false;
      throw err;
    }
  }

  async recall(query: string, opts: { limit?: number; type?: MemoryType } = {}): Promise<ReadonlyArray<RankedMemory>> {
    const limit = opts.limit ?? 5;
    const all = await this.list(opts.type);
    const tokens = tokenize(query);
    const ranked: RankedMemory[] = all
      .map((entry) => ({ entry, score: scoreEntry(entry, tokens) }))
      .filter((r) => r.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);
    return ranked;
  }

  private fileFor(name: string): string {
    return path.join(this.dir, `${name}.md`);
  }

  private async rebuildIndex(): Promise<void> {
    const entries = await this.list();
    const lines = ['# Memory index', ''];
    const byType = new Map<MemoryType, MemoryEntry[]>();
    for (const e of entries) {
      const list = byType.get(e.frontmatter.type) ?? [];
      list.push(e);
      byType.set(e.frontmatter.type, list);
    }
    for (const t of ['fact', 'preference', 'project', 'reference'] as const) {
      const items = byType.get(t);
      if (!items || items.length === 0) continue;
      lines.push(`## ${t}`);
      for (const item of items) {
        lines.push(`- [${item.frontmatter.name}](${path.basename(item.path)}) — ${item.frontmatter.description}`);
      }
      lines.push('');
    }
    await fs.writeFile(path.join(this.dir, 'MEMORY.md'), lines.join('\n'), 'utf8');
  }
}

export interface RankedMemory {
  readonly entry: MemoryEntry;
  readonly score: number;
}

function scoreEntry(entry: MemoryEntry, tokens: ReadonlyArray<string>): number {
  if (tokens.length === 0) return 1;
  const haystack = (
    entry.frontmatter.name +
    ' ' +
    entry.frontmatter.description +
    ' ' +
    (entry.frontmatter.tags ?? []).join(' ') +
    ' ' +
    entry.body
  ).toLowerCase();
  let score = 0;
  for (const t of tokens) {
    if (!t) continue;
    const matches = haystack.split(t).length - 1;
    if (matches > 0) {
      score += matches;
      if (entry.frontmatter.name.toLowerCase().includes(t)) score += 3;
      if (entry.frontmatter.description.toLowerCase().includes(t)) score += 2;
    }
  }
  return score;
}

function tokenize(s: string): string[] {
  return s
    .toLowerCase()
    .split(/[^a-z0-9_-]+/)
    .filter((t) => t.length >= 2);
}

async function safeRead(filePath: string): Promise<{ frontmatter: MemoryFrontmatter; body: string } | null> {
  try {
    const raw = await fs.readFile(filePath, 'utf8');
    const parsed = parseMdFile(raw);
    const result = memoryFrontmatterSchema.safeParse(parsed.frontmatter);
    if (!result.success) return null;
    return { frontmatter: result.data, body: parsed.body };
  } catch {
    return null;
  }
}

function isEnoent(err: unknown): boolean {
  return err instanceof Error && 'code' in err && (err as NodeJS.ErrnoException).code === 'ENOENT';
}
