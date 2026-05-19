---
title: HTTP channel
description: POST /v1/turn + SSE streaming, bearer-token auth, allow-list permissions.
---

`@moxxy/plugin-channel-http` exposes a moxxy `Session` over HTTP. There
is no human in the loop, so the operator declares trust up-front via a
tool allow-list and a bearer token.

## Endpoints

| Method | Path | Body | Response |
|---|---|---|---|
| `GET` | `/v1/health` | — | `{ "status": "ok" }` |
| `POST` | `/v1/turn` | `{ prompt, model?, systemPrompt? }` | `{ events: MoxxyEvent[], assistant: string }` |
| `POST` | `/v1/turn/stream` | same | SSE: one `data:` line per `MoxxyEvent`, terminating with `data: [DONE]` |

The request body schema is exported as `turnRequestSchema` from
`@moxxy/plugin-channel-http`.

## Auth

Every protected route requires `Authorization: Bearer <token>`. Configure
via env or config:

```sh
export MOXXY_HTTP_TOKEN=$(openssl rand -hex 32)
moxxy channels http
```

```ts
// moxxy.config.ts
import { defineConfig } from '@moxxy/config';

export default defineConfig({
  channels: {
    http: {
      port: 3737,                // default
      host: '127.0.0.1',         // default — bind to localhost
      authToken: '${vault:MOXXY_HTTP_TOKEN}',
      allowedTools: ['Read', 'Glob', 'Grep', 'web_fetch'],
    },
  },
});
```

`channels.http.allowedTools` is **required** — `isAvailable` refuses to
start without it. The HTTP channel uses `createAllowListResolver` from
`@moxxy/core`; any tool not in the list is denied. Set `allowedTools: []`
disables all tools.

## SSE stream

```sh
curl -N http://localhost:3737/v1/turn/stream \
  -H "Authorization: Bearer $MOXXY_HTTP_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"prompt":"list TS files"}'
```

Each event is one of the discriminated `MoxxyEvent` variants exported
from `@moxxy/sdk`. For a chat UI, pull `assistant_chunk` events and append
their `delta` field; for tool activity, watch `tool_call_requested` →
`tool_result`.

## Run as a service

```sh
moxxy service install http
moxxy service status http
moxxy service logs http --lines 100
```

See [Running as a service](./running-as-a-service) for launchd / systemd
details.

## Notes

- Errors short-circuit the SSE stream with `event: error\ndata: {...}`.
- Request bodies are capped at 64 KB.
- Bind to `127.0.0.1` unless you fronted the port with a reverse proxy
  that terminates TLS and re-checks auth.
- For more interactive flows where humans approve tools per-call, use
  the TUI or Telegram channel instead.
