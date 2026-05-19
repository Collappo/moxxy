---
title: Running as a service
description: Install Telegram, the HTTP channel, and the scheduler as launchd / systemd --user units.
---

`moxxy service` installs the channels that need to run 24/7 as
background OS units. The same subcommand surface works on macOS
(launchd) and Linux (systemd `--user`).

## Catalog

| Service id | Wraps | Why you'd install it |
|---|---|---|
| `telegram` | `moxxy telegram --no-wizard` | Keep the paired bot online across logout / restart. |
| `http` | `moxxy channels http` | Always-on HTTP API for remote callers. |
| `scheduler` | `moxxy schedule daemon` | Fire cron + one-shot prompts even when no terminal is open. |

Configure the channel interactively first (e.g. `moxxy channels telegram pair`),
then promote it to a service.

## Subcommands

| Command | Effect |
|---|---|
| `moxxy service list` | Show every catalog entry and whether it's installed / running. |
| `moxxy service install <name>` | Write the unit file + start the unit. |
| `moxxy service uninstall <name>` | Stop + delete the unit. |
| `moxxy service start <name>` | Start an already-installed unit. |
| `moxxy service stop <name>` | Stop without uninstalling. |
| `moxxy service restart <name>` | Stop then start. |
| `moxxy service status [<name>]` | Single service or full list. |
| `moxxy service logs <name> [--lines N]` | Tail `~/.moxxy/services/<id>.log` (default 40 lines). |
| `moxxy service path <name>` | Print the unit file path. |

## Where the units land

| Platform | Unit path | Notes |
|---|---|---|
| macOS | `~/Library/LaunchAgents/com.moxxy.<id>.plist` | Loaded with `launchctl bootstrap gui/$UID`. |
| Linux | `~/.config/systemd/user/moxxy-<id>.service` | Run `loginctl enable-linger $USER` once if you want it to survive logout. |

Logs go to `~/.moxxy/services/<id>.log` on both platforms. Override
`~/.moxxy` with `$MOXXY_HOME`.

## Typical Telegram flow

```sh
moxxy init                              # store provider key + Telegram token in the vault
moxxy channels telegram pair            # bot DMs a code; paste it
moxxy service install telegram          # promote to a background unit
moxxy service status telegram
moxxy service logs telegram --lines 100
```

Now the bot answers messages whether or not your terminal is open. Stop
it any time with `moxxy service stop telegram`; uninstall removes the
unit file.

## Typical scheduler flow

```sh
moxxy schedule add nightly-summary \
  --cron "0 9 * * *" \
  --prompt "Summarize unread emails from the last 24 hours and DM me."
moxxy service install scheduler
```

The poller wakes on its interval, runs each due `ScheduleEntry` in an
isolated session, and (with channel hints like `--channel telegram`)
delivers results via the configured channel's send tool. See
[Scheduler](./scheduler).

## HTTP

```sh
export MOXXY_HTTP_TOKEN=$(openssl rand -hex 32)
moxxy service install http
curl -H "Authorization: Bearer $MOXXY_HTTP_TOKEN" http://localhost:3737/v1/health
```

See [HTTP channel](./http-channel) for the endpoint shape.

## Caveats

- macOS / Linux only. Windows isn't wired up (`moxxy service` reports
  `unsupported platform`).
- Unit files reference `process.execPath` (Node) and `process.argv[1]`
  (the resolved CLI entry). If you reinstall moxxy at a new path you
  need to `moxxy service uninstall <name>` then `install <name>` again.
- The service runs *your* user; vault unlock follows the keychain /
  `MOXXY_VAULT_PASSPHRASE` rules. Configure passphrase access for
  headless boots.
