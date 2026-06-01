# codex-gui-proxy

Detect and configure proxy environment variables for the macOS Codex GUI app server.

## Usage

```bash
npx codex-gui-proxy check
npx codex-gui-proxy set --proxy 127.0.0.1:7890
```

Equivalent bin aliases:

```bash
npx codex-gui-proxy-check
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

Restart Codex after running `set`; already-running `codex app-server` processes do not inherit new environment variables.

`check` works without arguments. Pass `--proxy` only when your expected proxy is not `127.0.0.1:7890`.
