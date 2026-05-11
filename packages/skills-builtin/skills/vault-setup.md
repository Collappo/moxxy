---
name: vault-setup
description: Help the user initialize the encrypted vault and store their first secret.
triggers: ["set up vault", "initialize vault", "store a secret", "save api key"]
allowed-tools: [vault_set, vault_status, vault_list]
---
# Vault setup

The user wants to store secrets in moxxy's encrypted vault. Brief them:

1. **Where things live.** `~/.moxxy/vault.json` — AES-256-GCM ciphertext per entry. The master key is the OS keychain (macOS Keychain / libsecret / Windows Credential Manager) if available, falling back to a passphrase prompt. On headless systems set `MOXXY_VAULT_PASSPHRASE`.

2. **First use.** The first `vault_set` or `vault_get` will trigger the unlock. If the keychain is available you'll see no prompt; otherwise type a passphrase. moxxy will offer to remember it in the keychain so subsequent sessions don't prompt.

3. **Store the secret.** Ask the user for:
   - A **name** (slug-style, e.g. `ANTHROPIC_API_KEY`, `slack_webhook_url`)
   - The **value**
   - Optional **tags** (e.g. `["provider", "anthropic"]`)
   Then call `vault_set` with those fields.

4. **Use the secret.** Two paths:
   - In `moxxy.config.ts`: reference it with `${vault:ANTHROPIC_API_KEY}` anywhere a string is expected. The CLI will resolve it on session start.
   - From other tools: call `vault_get` with the name.

5. **Verify.** Call `vault_list` and confirm the new entry is present. Never echo the plaintext value back to the user.

## Don't

- Don't ever print the plaintext of an existing secret in chat. If the user wants to verify, suggest they run `vault_get` themselves.
- Don't use the same name for two different secrets — `vault_set` overwrites silently.
