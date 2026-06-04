#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const [command, ...args] = process.argv.slice(2);

if (!command || command === "-h" || command === "--help") {
  console.log(`Usage:
  codex-gui-proxy check
  codex-gui-proxy clean --dry-run
  codex-gui-proxy clean --apply
  codex-gui-proxy set --proxy 127.0.0.1:7890

Options:
  --proxy <host:port|url>   Proxy address. Default: 127.0.0.1:7890
  --no-proxy <list>         Hosts that should bypass proxy. Default: localhost,127.0.0.1,::1

Aliases:
  codex-gui-proxy-check
  codex-gui-proxy-clean
  codex-gui-proxy-set`);
  process.exit(0);
}

const script = command === "check"
  ? "codex-gui-proxy-check.js"
  : command === "clean"
    ? "codex-gui-proxy-clean.js"
  : command === "set"
    ? "codex-gui-proxy-set.js"
    : null;

if (!script) {
  console.error(`Unknown command: ${command}`);
  process.exit(1);
}

const result = spawnSync(process.execPath, [join(__dirname, script), ...args], { stdio: "inherit" });
process.exit(result.status ?? 1);
