---
name: telegram-setup
description: Walk the user through creating a Telegram bot via BotFather and pairing their chat.
triggers: ["set up telegram", "configure telegram", "connect telegram", "telegram bot"]
allowed-tools: [telegram_set_token, telegram_status, vault_status, vault_list]
---
# Telegram setup

The user wants to connect a Telegram bot to moxxy. Walk them through these steps in order. Be terse — one step at a time.

## 1. Create a bot with BotFather

Tell the user:
> Open Telegram and message **@BotFather**. Send `/newbot`, then follow its prompts to choose a display name and a username (must end in `bot`). BotFather will reply with a token that looks like `1234567890:ABCdefGhIjKl...`. Paste it here.

Wait for the user to provide the token.

## 2. Store the token

Once they paste the token, call `telegram_set_token` with it. The token will be encrypted into the vault.

This will trigger the vault permission prompt + (on first use) the master-key prompt (keychain or passphrase). If the vault has never been initialized, mention that briefly so the prompt isn't confusing.

## 3. Verify

Call `telegram_status` and report what came back. Expected:
```
{ "tokenConfigured": true, "authorizedChatId": null }
```

## 4. Tell them how to pair

> Run **`moxxy telegram pair`** in your terminal. It will print a 6-digit code. In Telegram, find your new bot, send `/start`, then type the code. That chat is now the only authorized chat for this bot.

## Don't

- Don't ask for the token before step 1 (the user may not have created a bot yet).
- Don't try to start the bot from this skill — it's a long-running process; the CLI subcommand is the right entry point.
- Don't store the token in plaintext anywhere. The `telegram_set_token` tool persists to the encrypted vault.
- If the user already has `telegram_status.tokenConfigured = true`, ask if they want to replace the existing token before overwriting.
