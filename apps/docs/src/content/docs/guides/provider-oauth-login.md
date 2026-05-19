---
title: Provider OAuth login
description: moxxy login openai-codex — and how the generic OAuth plugin powers it.
---

Most providers use API keys. The Codex provider
(`@moxxy/plugin-provider-openai-codex`) uses ChatGPT Pro/Plus OAuth
instead, and the generic `@moxxy/plugin-oauth` plugin handles the dance
for any future provider that wires the same hook.

## Log in

```sh
moxxy login openai-codex
# Opens your browser, listens on http://localhost:8765/callback,
# exchanges the code for tokens, stores them in the vault.
```

`moxxy login` is generic: it walks the provider registry and any
`ProviderDef` with `auth: { kind: 'oauth' }` becomes loggable. There's
no provider-specific code in the CLI — the plugin owns the flow.

| Command | Effect |
|---|---|
| `moxxy login <provider>` | Run the login flow. |
| `moxxy login status [<provider>]` | Show stored creds (no secrets printed). |
| `moxxy login logout <provider>` | Remove stored creds. |
| `moxxy login --no-browser` | Force the headless device-code flow. |

The `--no-browser` flag (or a non-TTY stdin) triggers RFC 8628 device-code
flow — useful when you're SSH'd into a box without a local browser. You
complete the flow on your laptop's browser; the daemon polls for the
token.

## How the Codex provider wires it

```ts
export const openaiCodexProviderDef = defineProvider({
  name: 'openai-codex',
  models: [...codexModels],
  createClient: (config) => new CodexProvider(config),
  auth: {
    kind: 'oauth',
    serviceName: 'ChatGPT Pro/Plus',
    login: codexLogin,
    logout: codexLogout,
    status: codexStatus,
  },
});
```

`codexLogin` (see `packages/plugin-provider-openai-codex/src/login.ts`)
uses helpers from `@moxxy/plugin-oauth` — PKCE generation, code
exchange, device-flow polling — and stores the resulting bundle in
the vault under `oauth/openai-codex/*`.

Refresh tokens rotate on every refresh (single-use), so the provider's
`onTokensRefreshed` callback writes the new bundle back to the vault
before the next API call goes out. Lose that and you get one 401 then
permanent failure.

## Using OAuth in your own plugin

The `@moxxy/plugin-oauth` plugin contributes three tools:

| Tool | Purpose |
|---|---|
| `oauth_authorize` | Run the loopback or device-code flow for a configured provider. |
| `oauth_get_token` | Fetch / refresh the current access token. |
| `oauth_clear_token` | Drop stored creds. |

…and exports the same helpers (`runAuthorizationCodeFlow`,
`runDeviceCodeFlow`, `refreshAccessToken`, `computeCodeChallenge`,
`generateCodeVerifier`, `generateState`) so a provider plugin can call
them directly without going through the model.

Tokens persist under `oauth/<provider>/*` in the vault, so subsequent
sessions inherit them. The plugin's bundled skills explain the
provider-side setup (e.g. Google Cloud Console for Workspace OAuth).
