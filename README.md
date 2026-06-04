# codex-gui-proxy

Detect and configure proxy environment variables for the macOS Codex GUI app server, and report stale Codex CLI sessions separately.

## Why this exists

Codex CLI and Codex GUI do not start from the same environment.

- Codex CLI is launched from your shell, so it usually inherits `HTTP_PROXY`, `HTTPS_PROXY`, and `ALL_PROXY` from `.zshrc`, `.zprofile`, or the current terminal.
- Codex GUI is launched by Finder, Dock, or LaunchServices. It inherits the macOS GUI `launchd` environment, not your shell startup files.
- The Codex desktop app has a web UI process and a separate local Rust `codex app-server` process. Chromium may use macOS system proxy settings, while the Rust app-server relies on process environment variables for HTTP clients.

When the GUI app-server starts without proxy env vars, it can repeatedly time out while connecting to `chatgpt.com` remote-control or response endpoints. The visible symptom is Codex GUI staying in a reconnecting loop even though Codex CLI works.

## Usage

```bash
npx codex-gui-proxy check
npx codex-gui-proxy clean --dry-run
npx codex-gui-proxy set --proxy 127.0.0.1:7890
```

Equivalent bin aliases:

```bash
npx codex-gui-proxy-check
npx codex-gui-proxy-clean --dry-run
npx codex-gui-proxy-set --proxy 127.0.0.1:7890
```

`set` creates or updates `~/Library/LaunchAgents/com.local.codex-gui-proxy.plist`, loads it into the current GUI session, and immediately sets the same variables with `launchctl setenv`. It does not depend on any pre-existing LaunchAgent on the target machine.

Pass only the proxy address, such as `127.0.0.1:7890`. The CLI expands it to protocol-specific defaults internally:

```bash
HTTP_PROXY=http://127.0.0.1:7890
HTTPS_PROXY=http://127.0.0.1:7890
ALL_PROXY=socks5://127.0.0.1:7890
```

If you pass an explicit URL such as `http://127.0.0.1:7890` or `socks5://127.0.0.1:7890`, the CLI respects that protocol for all proxy variables.

Restart Codex after running `set`; already-running GUI `codex app-server` processes do not inherit new environment variables.

Already-running Codex CLI sessions are different. They inherit proxy variables from the shell that launched them, not from the macOS GUI `launchd` environment. `check` reports active CLI processes and CLI-owned stdio helpers so you can tell whether a slow CLI session is using old shell env instead of blaming the GUI proxy setup.

`check` works without arguments. Pass `--proxy` only when your expected proxy is not `127.0.0.1:7890`.

If `check` reports old `--listen stdio://` app-server processes without proxy variables, that does not necessarily mean the reconnecting path is broken. The main GUI reconnecting path is the `--analytics-default-enabled` app-server. Stdio helper processes are now grouped by parent chain:

- `Codex GUI stdio helpers` belong to the desktop app and clear after restarting Codex.
- `Codex CLI stdio helpers` belong to terminal CLI sessions and clear after restarting those CLI sessions.
- `Codex other stdio helpers` are reported as informational when the parent chain is not recognizable.

## Cleanup

`clean` removes only process classes that are safe to prove stale:

- orphan headless automation Chrome processes using temporary `rod` user data
- orphan Codex crashpad handlers for inactive Codex Framework versions
- orphan old Codex Electron crashpad handlers

It does not kill the current Codex GUI, current Codex CLI sessions, visible Chrome windows, or stdio helper transports that belong to active parent processes.

Run dry-run first:

```bash
npx codex-gui-proxy clean --dry-run
```

Then apply:

```bash
npx codex-gui-proxy clean --apply
```
