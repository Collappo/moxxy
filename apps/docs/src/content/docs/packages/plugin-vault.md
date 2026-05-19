---
title: '@moxxy/plugin-vault'
description: AES-256-GCM encrypted secret store + `${vault:KEY}` placeholders.
---

`@moxxy/plugin-vault` stores secrets at `~/.moxxy/vault.json`, encrypted
with AES-256-GCM via a key derived from the user's passphrase. It also
resolves `${vault:NAME}` placeholders in `moxxy.config.ts` so configs
stay free of plaintext keys.

## Install

```sh
pnpm add @moxxy/plugin-vault
```

## Build

```ts
import { buildVaultPlugin } from '@moxxy/plugin-vault';

const { plugin, vault } = buildVaultPlugin({
  // filePath: '~/.moxxy/vault.json' (default)
  // envVar: 'MOXXY_VAULT_PASSPHRASE'
});
session.pluginHost.registerStatic(plugin);
```

## Tools

| Tool | Permission | Purpose |
|---|---|---|
| `vault_set` | prompt | Store a secret. Overwrites if name exists. |
| `vault_get` | prompt | Fetch plaintext by name. |
| `vault_list` | prompt | List names + metadata, never plaintext. |
| `vault_delete` | prompt | Delete by name. |
| `vault_status` | auto | Report which key source unlocked the vault. |

## Placeholder resolution

```ts
provider: {
  name: 'anthropic',
  config: { apiKey: '${vault:ANTHROPIC_API_KEY}' },
}
```

`resolveString(input, vault)` and `resolveValue(value, vault)` walk
arbitrary values and substitute every `${vault:NAME}` they find. The
CLI's setup runs this on the loaded config before handing it to plugins.

## Key sources

`createCombinedKeySource(...)` resolves the master key in priority:

1. `MOXXY_VAULT_PASSPHRASE` env var (derive each call, no persistence).
2. OS keychain via `keytar`.
3. On-disk cached key at `~/.moxxy/vault.key` (mode `0600`).
4. Interactive passphrase prompt.

The first successful prompt persists to both keytar (if available) and
disk so the next run doesn't re-prompt.

## Exports

- `VaultStore`, `VaultPassphraseError`
- `createCombinedKeySource`, `createStaticKeySource`
- `resolveString`, `resolveValue`, `containsPlaceholder`
- `deriveKey`, `encrypt`, `decrypt`, `generateSalt`, `randomCode`
- `defaultVaultPath()` → `~/.moxxy/vault.json`
