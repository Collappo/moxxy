# moxxy

> Block-based, modular agentic loop framework for TypeScript.

Every block — provider, loop strategy, tool, compactor, channel — is swappable. Skills are prompt-only Markdown files the agent can author for itself. Memory is journal-based with vector recall. Plugins distribute as `@moxxy/*` npm packages with a fully typed SDK.

## What you get

| | |
|---|---|
| **Providers** | Anthropic ships first-party. Add OpenAI, local, anything that streams text + tool calls. |
| **Loop strategies** | `tool-use` (Claude Code-style) ships by default; `plan-execute` swaps in via config. |
| **Tools** | Read / Edit / Write / Bash / Grep / Glob built in. MCP servers register as a tool source. Author your own with `defineTool({inputSchema, handler})`. |
| **Skills** | Markdown + YAML frontmatter. The agent can author new skills for itself when no existing skill matches the user's intent. |
| **Channels** | `tui` (Ink) and `telegram` (grammy, TOFU + code-pairing) ship today. Same `Channel<T>` interface — drop in Slack / Discord / HTTP as a plugin. |
| **Vault** | AES-256-GCM encrypted secrets. OS keychain (keytar) with passphrase fallback. `${vault:NAME}` placeholders in config. |
| **Memory** | Long-term journal + STM event-log selectors. TF-IDF vector recall ships built-in; swap in OpenAI embeddings via `@moxxy/plugin-embeddings-openai`. |
| **Hot reload** | jiti-backed plugin loader. `pluginHost.reload()` rescans, swaps in / out without restart. |

## Quickstart

```sh
pnpm add -g @moxxy/cli                 # install the binary
ANTHROPIC_API_KEY=sk-... moxxy --help

# One-shot, headless:
moxxy -p "list TS files" --allow-tools Read,Glob

# Interactive TUI:
moxxy

# Telegram channel:
moxxy telegram pair    # show pairing code, run bot
moxxy telegram         # subsequent runs
```

Or embed it directly in your TypeScript app:

```ts
import { Session, runTurn, autoAllowResolver } from '@moxxy/core';
import { anthropicPlugin } from '@moxxy/plugin-provider-anthropic';
import { builtinToolsPlugin } from '@moxxy/tools-builtin';
import { toolUseLoopPlugin } from '@moxxy/loop-tool-use';

const session = new Session({ cwd: process.cwd(), permissionResolver: autoAllowResolver });
session.pluginHost.registerStatic(anthropicPlugin);
session.pluginHost.registerStatic(builtinToolsPlugin);
session.pluginHost.registerStatic(toolUseLoopPlugin);
session.providers.setActive('anthropic');

for await (const event of runTurn(session, 'list TS files in cwd')) {
  if (event.type === 'assistant_chunk') process.stdout.write(event.delta);
}
```

## Authoring a plugin

```ts
import { definePlugin, defineTool, z } from '@moxxy/sdk';

export default definePlugin({
  name: '@acme/moxxy-plugin-greet',
  tools: [
    defineTool({
      name: 'greet',
      description: 'Return a greeting for the given name.',
      inputSchema: z.object({ name: z.string() }),
      handler: ({ name }) => `Hello, ${name}!`,
    }),
  ],
});
```

Add `"moxxy": { "plugin": { "entry": "./dist/index.js", "kind": "tools" } }` to your `package.json`. moxxy auto-discovers it.

## Configuration

`moxxy.config.ts` at your project root:

```ts
import { defineConfig } from '@moxxy/config';

export default defineConfig({
  provider: {
    name: 'anthropic',
    model: 'claude-sonnet-4-6',
    config: { apiKey: '${vault:ANTHROPIC_API_KEY}' },   // resolved from encrypted vault
  },
  loop: 'tool-use',
  plugins: {
    '@moxxy/loop-plan-execute': { enabled: false },     // disable per-plugin
  },
});
```

`${vault:NAME}` placeholders are resolved on session start against the encrypted vault. The vault unlocks via OS keychain (keytar) with passphrase fallback (`MOXXY_VAULT_PASSPHRASE` for headless).

## Architecture

```
@moxxy/sdk             <— typed public surface (zero runtime deps)
@moxxy/core            <— runtime: event log, registries, plugin host, permissions, skills
@moxxy/tools-builtin   <— Read/Edit/Write/Bash/Grep/Glob
@moxxy/loop-tool-use   <— default loop strategy
@moxxy/loop-plan-execute   <— alternate plan-then-execute
@moxxy/plugin-provider-anthropic  <— LLM provider
@moxxy/plugin-mcp                 <— MCP servers as tool sources
@moxxy/plugin-vault    <— encrypted secrets
@moxxy/plugin-memory   <— journal LTM + vector recall + STM selectors
@moxxy/plugin-embeddings-openai   <— neural embeddings (optional)
@moxxy/plugin-cli      <— Ink TUI + TuiChannel
@moxxy/plugin-telegram <— TelegramChannel via grammy
@moxxy/compactor-summarize  <— default context-window compactor
@moxxy/cli             <— the `moxxy` binary
@moxxy/config          <— defineConfig + moxxy.config.ts loader
@moxxy/testing         <— FakeProvider, record/replay harness
```

The hard invariant: `@moxxy/sdk` has zero internal deps; `@moxxy/core` doesn't import any plugin. Enforced in CI via `pnpm check:deps`.

## Repo layout

```
packages/        publishable @moxxy/* packages
apps/            runnable examples (example-basic, example-cli, fixture-recorder, docs)
tooling/         shared tsconfig + eslint + vitest preset
.claude/agents/  AI-agent author guides (skill, plugin, tool, channel, provider, …)
AGENTS.md        the index for AI agents working in this repo
```

## Docs

Full docs at [moxxy.dev](https://moxxy.dev) (or build locally: `pnpm --filter docs dev`).

## Development

```sh
pnpm install
pnpm -r build
pnpm -r typecheck
pnpm -r test           # 250+ tests across 17 suites
pnpm check:deps        # architectural invariant check
```

CI runs all of the above on every push + PR. See [`.github/workflows/ci.yml`](.github/workflows/ci.yml).

## License

TBD.
