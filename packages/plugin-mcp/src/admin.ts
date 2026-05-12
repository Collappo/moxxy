import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { defineTool, definePlugin, z, type Plugin, type ToolDef } from '@moxxy/sdk';
import type { McpClientLike, McpServerConfig, McpToolDescriptor } from './types.js';
import { wrapMcpServerTools, wrapMcpServerToolsLazy } from './wrap.js';

/**
 * Live runtime: live MCP clients keyed by server name plus the set of
 * tool names each one registered into the session. Lets us close +
 * unregister on `mcp_remove_server` and on shutdown without
 * rediscovering anything. Module-scoped so the admin plugin and the
 * shutdown hook share the same state; each Session that loads the
 * plugin gets its own map via the closure in `buildMcpAdminPlugin`.
 */
export interface McpRuntimeHandle {
  readonly client: McpClientLike;
  readonly toolNames: ReadonlyArray<string>;
}

/**
 * Tool-registry surface the admin plugin uses to hot-attach / detach
 * MCP tools. Matches the `ToolRegistry` in @moxxy/core but typed loosely
 * so we don't add an internal-dep on core from this plugin.
 */
export interface AdminToolRegistryLike {
  has(name: string): boolean;
  register(tool: ToolDef): void;
  unregister(name: string): void;
}

/**
 * User-level MCP server catalog persisted at ~/.moxxy/mcp.json. Mutated
 * by the admin tools below; read at boot by @moxxy/cli setup to spin up
 * connection plugins. JSON (not yaml) for trivial parse/write — these
 * entries are programmatically managed, the user doesn't normally edit
 * them by hand.
 */
/**
 * On-disk catalog entry: connection config PLUS a cache of the tool
 * descriptors the server last advertised. The cache lets us register
 * lazy stubs at boot without paying the connection cost, then transparently
 * connect on the first tool call.
 *
 * Defined as an intersection (not `extends`) so the McpServerConfig
 * discriminated union is preserved — `extends` would collapse it.
 */
export type McpStoredServer = McpServerConfig & {
  readonly cachedTools?: ReadonlyArray<McpToolDescriptor>;
};

export interface McpStoredConfig {
  readonly servers: ReadonlyArray<McpStoredServer>;
}

export function mcpConfigPath(): string {
  return path.join(os.homedir(), '.moxxy', 'mcp.json');
}

export async function readMcpConfig(): Promise<McpStoredConfig> {
  try {
    const raw = await fs.readFile(mcpConfigPath(), 'utf8');
    const parsed = JSON.parse(raw) as unknown;
    if (parsed && typeof parsed === 'object' && Array.isArray((parsed as McpStoredConfig).servers)) {
      return parsed as McpStoredConfig;
    }
  } catch {
    // missing or malformed — treat as empty
  }
  return { servers: [] };
}

export async function writeMcpConfig(cfg: McpStoredConfig): Promise<void> {
  const target = mcpConfigPath();
  await fs.mkdir(path.dirname(target), { recursive: true });
  // Atomic-ish write: temp file + rename so a crash mid-write can't
  // leave a half-flushed JSON blob that fails to parse next boot.
  const tmp = `${target}.${process.pid}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(cfg, null, 2) + '\n', 'utf8');
  await fs.rename(tmp, target);
}

const serverNameSchema = z
  .string()
  .min(1)
  .max(60)
  .regex(/^[a-z0-9][a-z0-9-]*$/, 'name must be slug-like (lowercase letters, digits, hyphens)');

// Flat schema (no discriminated union) so OpenAI's function-calling
// validator accepts it. OpenAI rejects top-level oneOf/anyOf with
// "object schema missing properties"; the model now sees a single
// object with `kind` + every transport-specific field optional, plus
// a runtime guard in the handler that enforces the per-kind required
// set with a readable error.
const addServerInput = z.object({
  kind: z.enum(['stdio', 'http', 'sse']).describe(
    'Transport kind. "stdio" runs a local executable; "http" and "sse" connect to a remote URL.',
  ),
  name: serverNameSchema,
  // stdio-only fields
  command: z
    .string()
    .min(1)
    .optional()
    .describe('Required when kind="stdio". Executable to spawn (e.g. "npx", "uv", "python").'),
  args: z
    .array(z.string())
    .optional()
    .describe('Optional when kind="stdio". CLI arguments for the executable.'),
  env: z
    .record(z.string())
    .optional()
    .describe('Optional when kind="stdio". Environment variables for the spawned process.'),
  cwd: z
    .string()
    .optional()
    .describe('Optional when kind="stdio". Working directory for the spawned process.'),
  // http/sse-only fields
  url: z
    .string()
    .url()
    .optional()
    .describe('Required when kind="http" or "sse". Server URL.'),
  headers: z
    .record(z.string())
    .optional()
    .describe('Optional when kind="http" or "sse". HTTP headers (auth, etc).'),
});

type AddServerInput = z.infer<typeof addServerInput>;

function validateAddServerInput(input: AddServerInput): McpServerConfig {
  if (input.kind === 'stdio') {
    if (!input.command) {
      throw new Error(
        'mcp_add_server: kind="stdio" requires a `command` field (e.g. "npx", "uv", "python").',
      );
    }
    const out: McpServerConfig = {
      kind: 'stdio',
      name: input.name,
      command: input.command,
      ...(input.args ? { args: input.args } : {}),
      ...(input.env ? { env: input.env } : {}),
      ...(input.cwd ? { cwd: input.cwd } : {}),
    };
    return out;
  }
  if (!input.url) {
    throw new Error(
      `mcp_add_server: kind="${input.kind}" requires a \`url\` field (the remote MCP endpoint).`,
    );
  }
  return {
    kind: input.kind,
    name: input.name,
    url: input.url,
    ...(input.headers ? { headers: input.headers } : {}),
  };
}

export interface BuildMcpAdminPluginOptions {
  /**
   * Live tool registry. When provided, `mcp_add_server` connects + wraps
   * the server immediately and registers its tools into this registry —
   * no restart needed. `mcp_remove_server` closes the client and
   * unregisters. Pass `null` for pure-config behavior (write-only).
   */
  readonly toolRegistry: AdminToolRegistryLike | null;
}

/**
 * Build the MCP admin plugin: tools that let the agent register and
 * manage MCP servers at runtime. When wired to a live tool registry,
 * adds hot-attach so newly-registered servers are callable in the same
 * session without a restart.
 */
export function buildMcpAdminPlugin(opts: BuildMcpAdminPluginOptions = { toolRegistry: null }): Plugin {
  const registry = opts.toolRegistry;
  // Track hot-attached runtimes keyed by server name. We need to know
  // which tools each server contributed so `mcp_remove_server` can
  // unregister them cleanly, and which client to close on shutdown.
  const runtimes = new Map<string, McpRuntimeHandle>();

  /**
   * Eager attach used by `mcp_add_server`: connect, list tools, register
   * them. Returns the discovered descriptors so the caller can cache
   * them into mcp.json for lazy boots next time.
   */
  const attachServer = async (
    server: McpServerConfig,
  ): Promise<{ toolNames: ReadonlyArray<string>; descriptors: ReadonlyArray<McpToolDescriptor> }> => {
    const { defaultClientFactory } = await import('./index.js');
    const client = await defaultClientFactory(server);
    const list = await client.listTools();
    const descriptors = list.tools;
    const wrapped = await wrapMcpServerTools({ server, client });
    if (!registry) {
      await client.close();
      return { toolNames: wrapped.map((t) => t.name), descriptors };
    }
    const collisions = wrapped.filter((t) => registry.has(t.name)).map((t) => t.name);
    if (collisions.length > 0) {
      await client.close();
      throw new Error(
        `mcp_add_server: tool name collision — already registered: ${collisions.join(', ')}. ` +
          'Pick a different server name (the server name becomes a prefix on each tool).',
      );
    }
    for (const tool of wrapped) registry.register(tool);
    runtimes.set(server.name, { client, toolNames: wrapped.map((t) => t.name) });
    return { toolNames: wrapped.map((t) => t.name), descriptors };
  };

  /**
   * Lazy attach used at boot: register stub tools using cached
   * descriptors WITHOUT connecting. The first call to any of these
   * tools triggers a single shared connection via `getOrConnect`;
   * subsequent calls reuse it. Failed connections reset so the next
   * call can retry.
   */
  const attachServerLazy = (
    server: McpStoredServer,
  ): { toolNames: ReadonlyArray<string> } => {
    if (!registry) return { toolNames: [] };
    if (runtimes.has(server.name)) return { toolNames: runtimes.get(server.name)!.toolNames };
    const descriptors = server.cachedTools ?? [];
    if (descriptors.length === 0) {
      // No cache yet — nothing to expose lazily. Caller can fall back
      // to attachServer to populate the cache, or wait for the user to
      // run mcp_add_server again.
      return { toolNames: [] };
    }

    let connectPromise: Promise<McpClientLike> | null = null;
    const getOrConnect = async (): Promise<McpClientLike> => {
      if (!connectPromise) {
        connectPromise = (async () => {
          const { defaultClientFactory } = await import('./index.js');
          const client = await defaultClientFactory(server);
          // Stash the live client on the runtime entry so shutdown can
          // close it. The entry was created with a sentinel; replace it.
          const runtime = runtimes.get(server.name);
          if (runtime) {
            runtimes.set(server.name, { client, toolNames: runtime.toolNames });
          }
          return client;
        })().catch((err) => {
          // Reset so a future call can retry instead of being stuck on
          // a rejected promise.
          connectPromise = null;
          throw err;
        });
      }
      return connectPromise;
    };

    const wrapped = wrapMcpServerToolsLazy({ server, descriptors, getClient: getOrConnect });
    const collisions = wrapped.filter((t) => registry.has(t.name)).map((t) => t.name);
    if (collisions.length > 0) {
      throw new Error(
        `lazy attach: tool name collision for "${server.name}": ${collisions.join(', ')}. ` +
          'A different server (or a previously-attached version) already owns these names.',
      );
    }
    for (const tool of wrapped) registry.register(tool);
    // Sentinel client gets swapped for the real one inside getOrConnect.
    // Until first call, close() is a no-op via the LazyClient sentinel.
    const lazyClient: McpClientLike = {
      listTools: async () => ({ tools: descriptors }),
      callTool: async (args) => (await getOrConnect()).callTool(args),
      close: async () => {
        if (connectPromise) {
          const client = await connectPromise.catch(() => null);
          if (client) await client.close();
        }
      },
    };
    runtimes.set(server.name, { client: lazyClient, toolNames: wrapped.map((t) => t.name) });
    return { toolNames: wrapped.map((t) => t.name) };
  };

  const detachServer = async (name: string): Promise<boolean> => {
    const runtime = runtimes.get(name);
    if (!runtime) return false;
    runtimes.delete(name);
    if (registry) {
      for (const toolName of runtime.toolNames) registry.unregister(toolName);
    }
    try {
      await runtime.client.close();
    } catch {
      // ignore — best-effort close
    }
    return true;
  };

  return definePlugin({
    name: '@moxxy/plugin-mcp-admin',
    version: '0.0.0',
    tools: [
      defineTool({
        name: 'mcp_list_servers',
        description:
          'List every MCP server currently registered in ~/.moxxy/mcp.json. Returns name + transport kind + connection details (command/url) for each.',
        inputSchema: z.object({}),
        handler: async () => {
          const cfg = await readMcpConfig();
          return cfg.servers.map((s) =>
            s.kind === undefined || s.kind === 'stdio'
              ? { name: s.name, kind: 'stdio' as const, command: (s as { command: string }).command }
              : { name: s.name, kind: s.kind, url: (s as { url: string }).url },
          );
        },
      }),
      defineTool({
        name: 'mcp_add_server',
        description:
          'Register a new MCP server in ~/.moxxy/mcp.json. Pick "stdio" for local commands ' +
          '(npm/uv packages, scripts); pick "http" or "sse" for remote HTTP servers. The new ' +
          'server\'s tools become available after the next moxxy restart. Call mcp_test_server ' +
          'first if you want to verify connectivity before persisting.',
        inputSchema: addServerInput,
        permission: { action: 'prompt' },
        handler: async (input) => {
          const server = validateAddServerInput(input);
          const cfg = await readMcpConfig();
          if (cfg.servers.some((s) => s.name === server.name)) {
            throw new Error(
              `mcp_add_server: an MCP server named "${server.name}" already exists. ` +
                `Use mcp_remove_server first, or pick a different name.`,
            );
          }
          // Hot-attach: connect + register tools BEFORE persisting. If
          // attach fails (bad URL, missing command, schema mismatch),
          // we never write a broken entry to disk.
          const { toolNames, descriptors } = await attachServer(server);
          // Cache descriptors so next boot can register lazy stubs
          // without paying the connection cost up-front.
          const stored: McpStoredServer = { ...server, cachedTools: descriptors };
          const next: McpStoredConfig = { servers: [...cfg.servers, stored] };
          await writeMcpConfig(next);
          return {
            ok: true,
            name: server.name,
            path: mcpConfigPath(),
            attached: registry !== null,
            tools: toolNames,
            note: registry
              ? `Live in this session — ${toolNames.length} tool${toolNames.length === 1 ? '' : 's'} now callable. Also persisted; survives restart.`
              : 'Saved to config. Restart moxxy to load the tools (no live registry was wired into the admin plugin).',
          };
        },
      }),
      defineTool({
        name: 'mcp_remove_server',
        description:
          'Remove an MCP server from ~/.moxxy/mcp.json and detach its tools from the live session. ' +
          'The tools become uncallable immediately and the entry is gone on next restart.',
        inputSchema: z.object({ name: serverNameSchema }),
        permission: { action: 'prompt' },
        handler: async ({ name }) => {
          const cfg = await readMcpConfig();
          const before = cfg.servers.length;
          const next: McpStoredConfig = {
            servers: cfg.servers.filter((s) => s.name !== name),
          };
          const persisted = next.servers.length !== before;
          const detached = await detachServer(name);
          if (persisted) await writeMcpConfig(next);
          if (!persisted && !detached) {
            return { removed: false, name, note: `No MCP server named "${name}" was registered.` };
          }
          return {
            removed: true,
            name,
            persistedChange: persisted,
            detachedFromSession: detached,
          };
        },
      }),
      defineTool({
        name: 'mcp_test_server',
        description:
          'Connect to an MCP server WITHOUT saving it to config. Returns the list of tools the ' +
          'server exposes if the connection succeeds, or a connection-error message. Useful for ' +
          'sanity-checking before calling mcp_add_server.',
        inputSchema: addServerInput,
        handler: async (input) => {
          const server = validateAddServerInput(input);
          // Local import: keep the @modelcontextprotocol/sdk dependency
          // lazy so admin tools don't pay the import cost when the
          // session never tests anything.
          const { defaultClientFactory } = await import('./index.js');
          let client: Awaited<ReturnType<typeof defaultClientFactory>> | null = null;
          try {
            client = await defaultClientFactory(server);
            const wrapped = await wrapMcpServerTools({ server, client });
            return {
              ok: true,
              name: server.name,
              tools: wrapped.map((t) => ({ name: t.name, description: t.description })),
            };
          } catch (err) {
            return {
              ok: false,
              name: server.name,
              error: err instanceof Error ? err.message : String(err),
            };
          } finally {
            if (client) {
              try {
                await client.close();
              } catch {
                /* ignore */
              }
            }
          }
        },
      }),
    ],
    hooks: {
      // On session init, register lazy stubs for every server that has
      // a tool-descriptor cache. Boot stays instant — the stubs don't
      // connect; the connection only happens on the first call to one
      // of the server's tools. Servers with no cache yet are skipped;
      // the user re-runs mcp_add_server (or calls mcp_test_server) to
      // populate the cache.
      onInit: async () => {
        if (!registry) return;
        let cfg: McpStoredConfig;
        try {
          cfg = await readMcpConfig();
        } catch {
          return;
        }
        for (const server of cfg.servers) {
          try {
            attachServerLazy(server);
          } catch {
            // Collision or other registration error — swallow so one
            // bad cache entry doesn't block the rest.
          }
        }
      },
      // Close every attached MCP client (lazy or eager) on session
      // shutdown so stdio child processes don't get orphaned and HTTP
      // sockets don't leak.
      onShutdown: async () => {
        for (const [, runtime] of runtimes) {
          try {
            await runtime.client.close();
          } catch {
            /* ignore */
          }
        }
        runtimes.clear();
      },
    },
  });
}
