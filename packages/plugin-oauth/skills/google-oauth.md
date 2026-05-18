---
name: google-oauth
description: Set up Google OAuth (Gmail, Calendar, Drive, Docs, Sheets) and stash a refresh-capable token for Google Workspace MCP / direct API access.
triggers:
  - "google workspace"
  - "google oauth"
  - "google api"
  - "gmail"
  - "google calendar"
  - "google drive"
  - "google docs"
  - "google sheets"
  - "google contacts"
  - "google workspace mcp"
  - "enable gmail"
  - "connect gmail"
  - "connect google"
  - "sign in to google"
allowed-tools:
  - oauth_authorize
  - oauth_get_token
  - oauth_clear_token
  - install_plugin
  - mcp_add_server
---

# Google OAuth (for Workspace + direct API access)

Google requires extra ceremony vs other providers: a registered OAuth
client in Google Cloud Console, an exact-match redirect URI, and the
`access_type=offline` + `prompt=consent` params to actually receive a
refresh_token. This skill walks through both halves.

**Before doing anything else**, you MUST walk the user through the
Cloud Console setup. Send the Step 1 script BEFORE calling any tool —
the user can't authorize without a client_id, and a half-finished
attempt wastes everyone's time. Wait for them to paste back the
client_id + client_secret, then proceed to Step 2.

## Step 1 — hands-on Google Cloud Console setup

Tell the user **exactly this script** (adapt phrasing, keep the
links + values verbatim). Pause after each block and confirm the
user reached the expected screen before moving to the next.

> **One-time Google Cloud setup — ~5 minutes**
>
> You'll register moxxy as an OAuth "Desktop app" in your Google
> Cloud project. Free, no review needed for personal use.
>
> ---
>
> **1) Pick or create a project**
>
> Open https://console.cloud.google.com/projectcreate
>
> Give it any name (e.g. `moxxy-oauth`) — leave Location as is and
> click **Create**. Wait a few seconds, then make sure the project
> dropdown at the top of the page shows your new project (if not,
> click the dropdown and pick it).
>
> Already have a project you want to reuse? Open
> https://console.cloud.google.com/ and switch to it from the top
> dropdown — that's fine too.
>
> ---
>
> **2) Enable the APIs you'll actually use**
>
> Open https://console.cloud.google.com/apis/library and search for
> each API below, click it, then click the blue **Enable** button.
> Do this once per API:
>
> - **Gmail API** (only if you want mail) — https://console.cloud.google.com/apis/library/gmail.googleapis.com
> - **Google Calendar API** — https://console.cloud.google.com/apis/library/calendar-json.googleapis.com
> - **Google Drive API** — https://console.cloud.google.com/apis/library/drive.googleapis.com
> - **Google Docs API** — https://console.cloud.google.com/apis/library/docs.googleapis.com
> - **Google Sheets API** — https://console.cloud.google.com/apis/library/sheets.googleapis.com
> - **People API** (contacts) — https://console.cloud.google.com/apis/library/people.googleapis.com
>
> If you skip an API here, calls to it later will return `403 -
> SERVICE_DISABLED` — you can always come back and enable more.
>
> ---
>
> **3) Configure the OAuth consent screen**
>
> Open https://console.cloud.google.com/apis/credentials/consent
>
> - **User type**: pick **External**, click Create.
> - **App name**: anything (e.g. `moxxy`).
> - **User support email** / **Developer contact email**: your own
>   email is fine for both.
> - Leave the App logo / domain fields blank.
> - Click **Save and Continue**.
> - On the **Scopes** step, just click **Save and Continue** —
>   don't add anything here; moxxy requests scopes at runtime.
> - On the **Test users** step, click **+ Add Users** and add your
>   own Google account's email. Click **Save and Continue**.
> - Review and click **Back to Dashboard**.
>
> Your app's status will say "Testing" — that's correct, leave it
> there. You don't need to "Publish" or submit for verification for
> personal use.
>
> ---
>
> **4) Create the OAuth client ID**
>
> Open https://console.cloud.google.com/apis/credentials
>
> - Click **+ Create Credentials** → **OAuth client ID**.
> - **Application type**: pick **Desktop app**.
> - **Name**: `moxxy` (or anything).
> - Click **Create**.
>
> A popup appears with your **Client ID** and **Client Secret**.
> Click **Download JSON** to save a backup, then copy both values.
>
> ---
>
> **5) Paste them back here**
>
> Send me both values in the next message (they're not real secrets
> in the credential-theft sense for a Desktop app — but treat them
> like passwords; they go straight into the moxxy vault):
>
> ```
> client_id:     <paste here>
> client_secret: <paste here>
> ```
>
> (Note: Desktop-app clients don't need a redirect URI registered —
> Google accepts any `http://localhost:*/...` callback for this app
> type. moxxy will use `http://localhost:8765/callback`.)

Wait for the user to come back with both values. Don't proceed to
Step 2 until both `client_id` and `client_secret` are in hand.

If the user pastes something that doesn't look like a Google client
id (the id looks like `123-abc.apps.googleusercontent.com`, the
secret like `GOCSPX-...`), re-ask — silently authorizing with wrong
values gives a confusing `invalid_client` error.

## Step 2 — run the OAuth flow

Pick scopes for what the user actually wants. Common combos:

| Use case               | Scopes                                                                              |
|------------------------|-------------------------------------------------------------------------------------|
| Gmail read+send        | `openid email profile https://www.googleapis.com/auth/gmail.modify`                 |
| Calendar full          | `openid email profile https://www.googleapis.com/auth/calendar`                     |
| Drive (read)           | `openid email profile https://www.googleapis.com/auth/drive.readonly`               |
| Drive (full)           | `openid email profile https://www.googleapis.com/auth/drive`                        |
| Docs + Sheets          | `https://www.googleapis.com/auth/documents https://www.googleapis.com/auth/spreadsheets` |
| Workspace MCP (broad)  | `openid email profile https://mail.google.com/ https://www.googleapis.com/auth/calendar https://www.googleapis.com/auth/drive https://www.googleapis.com/auth/documents https://www.googleapis.com/auth/spreadsheets` |

Then:

```
oauth_authorize({
  provider: "google",
  authUrl: "https://accounts.google.com/o/oauth2/v2/auth",
  tokenUrl: "https://oauth2.googleapis.com/token",
  clientId: "<from step 1>",
  clientSecret: "<from step 1>",
  scopes: [
    "openid",
    "email",
    "profile",
    "https://www.googleapis.com/auth/calendar",
    // ...whatever the user asked for
  ],
  extraAuthParams: {
    access_type: "offline",       // REQUIRED to receive refresh_token
    prompt: "consent",            // forces consent screen so refresh_token is reissued
    include_granted_scopes: "true" // optional: stacks new scopes onto existing grants
  },
})
```

The browser opens, the user picks their Google account, approves the
scopes, the local callback fires, and the tool returns with the
token summary. Tokens land in `oauth/google/*` in the vault.

## Step 3 — use it

For ad-hoc API calls:

```
oauth_get_token({ provider: "google" })
// → { accessToken, tokenType: "Bearer", expiresAt, scope }
```

For Google Workspace MCP (the most common follow-on):

```
# 1. Install the Workspace MCP server (if not already)
install_plugin({ packageName: "@moxxy/plugin-mcp" })   # if needed

# 2. Add the MCP server with the Google token
mcp_add_server({
  name: "google-workspace",
  command: "npx",
  args: ["-y", "@taylorwilsdon/google_workspace_mcp", "--transport", "stdio"],
  env: {
    GOOGLE_OAUTH_CLIENT_ID: "<from step 1>",
    GOOGLE_OAUTH_CLIENT_SECRET: "<from step 1>",
    // Most Workspace MCP servers accept a refresh_token directly.
    // Get it via: oauth_get_token({ provider: "google", includeRefresh: true })
    GOOGLE_OAUTH_REFRESH_TOKEN: "<refresh_token from oauth_get_token>"
  }
})
```

**Full chain (what the agent actually runs)**:

```
# After the user pastes client_id + client_secret from Step 1:
oauth_authorize({ provider: "google", clientId, clientSecret, ... })
   → user approves in browser → tokens land in vault

# Grab the refresh_token (opt-in)
const tokens = oauth_get_token({
  provider: "google",
  includeRefresh: true
})

# Hand it to the MCP server
mcp_add_server({
  name: "google-workspace",
  command: "...", args: [...],
  env: {
    GOOGLE_OAUTH_CLIENT_ID:     <user-pasted from Step 1>,
    GOOGLE_OAUTH_CLIENT_SECRET: <user-pasted from Step 1>,
    GOOGLE_OAUTH_REFRESH_TOKEN: tokens.refreshToken
  }
})
```

The MCP server now mints its own access tokens via the refresh_token,
so the chain is one-time setup. Future sessions just call
`oauth_get_token` if they need a direct token (the MCP server is
autonomous).

Then the model can call `mcp__google-workspace__*` tools directly.

## Headless variant

Google supports the device flow at
`https://oauth2.googleapis.com/device/code`. If the user is on SSH
or a headless host:

```
oauth_authorize({
  provider: "google",
  deviceUrl: "https://oauth2.googleapis.com/device/code",
  tokenUrl: "https://oauth2.googleapis.com/token",
  clientId: "...",
  clientSecret: "...",
  scopes: [...],
  mode: "device",
  extraAuthParams: { access_type: "offline" },
})
```

Print the user_code + verification_uri the tool surfaces; tell the
user to open it on their phone / laptop.

## Common failures

- **"invalid_client"** — the `client_id` or `client_secret` is wrong
  or from a different project. Re-check the values the user pasted
  (or re-download the JSON from
  https://console.cloud.google.com/apis/credentials).
- **"redirect_uri_mismatch"** — only happens if the user picked
  *Web application* instead of *Desktop app* in Step 1.4. Desktop
  app clients accept any `http://localhost:*/...` redirect without
  registration. Fix: delete the client and recreate as Desktop app.
- **"access_denied"** — the user clicked Cancel on the consent
  screen, OR their Google account isn't in the test-users list of
  the unverified app. Send them to
  https://console.cloud.google.com/apis/credentials/consent → *Test
  users* → **+ Add Users**.
- **"App is being verified"** / "Google hasn't verified this app"
  warning — expected for unverified apps in test mode. The user
  clicks **Advanced** → **Go to <appname> (unsafe)** to proceed.
  Reassure them this is normal for personal-use apps.
- **No `refresh_token` in the response** — happens when the user has
  already authorized the same scopes for this client; Google
  silently skips reissuing it. Fix: pass `prompt: "consent"` (which
  this skill always does) to force a fresh issuance.
- **403 `SERVICE_DISABLED` on first API call** — the specific Google
  API (Gmail / Calendar / etc.) isn't enabled in the project. Send
  the user back to https://console.cloud.google.com/apis/library to
  enable it for their project.
- **`Token has been expired or revoked`** in long-running sessions —
  Google's test-mode refresh_tokens expire after 7 days of
  non-use. Re-run `oauth_authorize` to get a fresh one. (Publishing
  the app to "Production" removes this limit but requires a
  verification process you don't want for personal use.)

## Don't

- Don't request scopes the user didn't ask for. Each extra scope is
  one more thing on the consent screen and one more thing the user
  has to trust the local moxxy install with.
- Don't suggest the user manually paste tokens into env vars or
  config files. Vault is the durable store; `oauth_get_token`
  always reads from there.
- Don't recommend "external + production" on the consent screen for
  personal use — that puts the user on Google's review queue. Test
  mode (External + test users) is fine for single-user setups.
