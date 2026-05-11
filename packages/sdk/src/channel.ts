import type { PermissionResolver } from './permission.js';

/**
 * A Channel is a bidirectional surface that drives a Session: it feeds user
 * prompts in, renders assistant chunks + tool activity out, and implements a
 * PermissionResolver so it can interrupt tool execution to ask the user.
 *
 * The TUI (Ink) and Telegram are both Channels. Future Slack / Discord / HTTP
 * channels implement this same interface so the moxxy CLI binary (or any
 * embedded consumer) can dispatch to them uniformly.
 *
 * The generic `TStartOpts` is the concrete options shape a given channel
 * accepts.
 */
export interface Channel<TStartOpts = unknown> {
  /** Stable name (lowercase, single word). Used by dispatchers to look up by string. */
  readonly name: string;

  /** The PermissionResolver this channel installs on the session. */
  readonly permissionResolver: PermissionResolver;

  /**
   * Begin running the channel. Returns a handle whose `running` promise
   * resolves when the channel exits gracefully.
   */
  start(opts: TStartOpts): Promise<ChannelHandle>;
}

export interface ChannelHandle {
  /**
   * Resolves when the channel exits cleanly (user quit, SIGINT caught,
   * upstream disconnected). Rejects on fatal error.
   */
  readonly running: Promise<void>;

  /** Request graceful shutdown. Implementations should abort any in-flight work. */
  stop(reason?: string): Promise<void>;
}

/** Common base shape for channel start options. */
export interface ChannelStartOptsBase {
  readonly model?: string;
  readonly systemPrompt?: string;
}

/**
 * Standard dependencies that a channel factory receives. Channels pick what
 * they need from this bag. Production CLI populates all of these; tests may
 * pass only a subset.
 */
export interface ChannelFactoryDeps {
  /** Working directory for the channel (matches the Session's cwd). */
  readonly cwd: string;
  /** Optional encrypted-secret store (typed loosely — plugins import the concrete VaultStore type when needed). */
  readonly vault?: unknown;
  /** Optional structured logger. */
  readonly logger?: {
    debug?(msg: string, meta?: Record<string, unknown>): void;
    info?(msg: string, meta?: Record<string, unknown>): void;
    warn?(msg: string, meta?: Record<string, unknown>): void;
    error?(msg: string, meta?: Record<string, unknown>): void;
  };
  /** Free-form per-channel overrides forwarded from the CLI invocation. */
  readonly options?: Record<string, unknown>;
}

/**
 * A registered, named factory for a Channel. Plugins contribute these via
 * `definePlugin({ channels: [defineChannel(...)] })`. The CLI looks up by name
 * and dispatches: `moxxy <name>` calls `def.create(deps).start({session,...})`.
 */
export interface ChannelDef<TStartOpts = unknown> {
  readonly name: string;
  readonly description: string;
  create(deps: ChannelFactoryDeps): Channel<TStartOpts>;
}

/**
 * Read-only registry of channels available in a Session. Implementation lives
 * in @moxxy/core.
 */
export interface ChannelRegistry {
  list(): ReadonlyArray<ChannelDef>;
  get(name: string): ChannelDef | undefined;
  has(name: string): boolean;
}
