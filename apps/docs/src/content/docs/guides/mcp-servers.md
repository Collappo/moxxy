---
title: MCP servers
description: Add Model Context Protocol servers so their tools surface as mcp__server__tool calls.
---

`@moxxy/plugin-mcp` wires Model Context Protocol servers into moxxy.
Each server's tools surface in the agent's tool list as
`mcp__<server>__<tool>`, so the model sees them alongside built-ins.

## Add a server

The fastest path is to ask the agent — it calls `mcp_add_server` for
you, which tests the connection and caches the tool descriptors before
writing the entry to `~/.moxxy/mcp.json`:

> me: add the @modelcontextprotocol/server-filesystem MCP server
> at /tmp/scratch

The plugin's admin tools (`packages/plugin-mcp/src/admin/tools/`):

| Tool | Purpose |
|---|---|
| `mcp_list_servers` | List registered servers + their connection details. |
| `mcp_add_server` | Add + test a new server. Writes to `~/.moxxy/mcp.json`. |
| `mcp_test_server` | Re-probe an existing server, refresh tool cache. |
| `mcp_remove_server` | Drop from the catalog. |

## Manage from the CLI

```sh
moxxy mcp list
moxxy mcp enable <name>
moxxy mcp disable <name>     # keeps the entry; just skips it at boot
moxxy mcp remove <name>
moxxy mcp path
```

`moxxy mcp` is intentionally narrow — adding servers needs a
configuration dialog the model handles better, but enable / disable /
remove on existing entries is one-shot CLI work.

## Server kinds

The catalog file accepts three transports:

| Kind | Shape |
|---|---|
| `stdio` (default) | `{ command, args?, env? }` — spawns a process. |
| `sse` | `{ kind: 'sse', url }` — Server-Sent Events. |
| `streamable-http` | `{ kind: 'streamable-http', url }` — streaming HTTP. |

## Tool naming

The wrap layer prefixes every imported tool with `mcp__<server>__`
(see `defaultToolNamePrefix` in `packages/plugin-mcp/src/types.ts`).
This keeps names unique across servers and makes it obvious where a
tool comes from in permission prompts.

## Timeouts

Every MCP tool call is capped at 5 minutes
(`packages/plugin-mcp/src/wrap.ts:MCP_CALL_TIMEOUT_MS`). The cap is
hard — the MCP SDK's `callTool` doesn't accept an `AbortSignal`, so
without a timeout a hung server would freeze the agent's loop. Slow
operations (image gen, large queries) fit comfortably under the cap.

## Catalog file

```json
{
  "servers": [
    {
      "name": "filesystem",
      "kind": "stdio",
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-filesystem", "/tmp/scratch"],
      "cachedTools": [
        { "name": "read_file", "description": "..." }
      ]
    }
  ]
}
```

`cachedTools` is refreshed by `mcp_add_server` / `mcp_test_server` so
help screens and the TUI's `/tools` listing reflect the real surface
without round-tripping every server on startup.
