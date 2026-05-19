---
title: '@moxxy/plugin-browser'
description: web_fetch + a Playwright sidecar (`browser_session`) for JS-heavy pages.
---

`@moxxy/plugin-browser` adds two tiers of web access. The light tier is
a single HTTP GET with HTML-to-text post-processing; the heavy tier
spawns a Playwright sidecar that the agent can drive across multiple
interactions in one session.

## Install

```sh
pnpm add @moxxy/plugin-browser
```

The Chromium binary auto-installs on first use of `browser_session`.
Disk install lives in `~/.cache/ms-playwright/` (or `$PLAYWRIGHT_BROWSERS_PATH`).

## Tools

| Tool | Tier | Purpose |
|---|---|---|
| `web_fetch` | Light | Single HTTP GET/HEAD. Strips HTML to text/markdown, or returns raw. |
| `browser_session` | Heavy | Open a long-lived Playwright page; navigate, click, type, screenshot. |

`web_fetch` covers the "just read this page" case with zero new deps
(uses Node's built-in `fetch`). The web-research bundled skill picks
the tier — JS-heavy / interactive pages go to `browser_session`.

## Use

```ts
import { browserPlugin } from '@moxxy/plugin-browser';

session.pluginHost.registerStatic(browserPlugin);
```

Or build with custom sidecar options:

```ts
import { buildBrowserPlugin } from '@moxxy/plugin-browser';

session.pluginHost.registerStatic(buildBrowserPlugin({
  // BrowserSessionDeps — sidecar lifecycle hooks, headless flag, etc.
}));
```

## Exports

- `webFetchTool` — the light-tier tool.
- `buildBrowserSessionTool(deps)` — heavy tier.
- `closeBrowserSidecar()` — for cleanup outside the normal session lifecycle.
- `htmlToPlainText`, `htmlToMarkdown` — the post-processors.

## Notes

- `web_fetch` is hard-capped at 2 MB body, 5 redirects, 20 s timeout.
- The Playwright sidecar is a single process shared across the
  session — `closeBrowserSidecar` is wired to `onShutdown` so it dies
  with the session.
- For login flows that need OAuth, use `@moxxy/plugin-oauth` instead.
