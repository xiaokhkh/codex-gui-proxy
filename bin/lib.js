import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { homedir, platform } from "node:os";
import { dirname, join } from "node:path";

export const label = "com.local.codex-gui-proxy";
export const plistPath = join(homedir(), "Library", "LaunchAgents", `${label}.plist`);
export const defaultProxy = "http://127.0.0.1:7890";
export const defaultProxyInput = "127.0.0.1:7890";
export const defaultNoProxy = "localhost,127.0.0.1,::1";
const proxyEnvKeys = ["HTTP_PROXY", "HTTPS_PROXY", "ALL_PROXY", "http_proxy", "https_proxy", "all_proxy"];

export function assertMacOS() {
  if (platform() !== "darwin") {
    throw new Error("This tool only supports macOS launchctl environments.");
  }
}

export function run(command, args, options = {}) {
  return execFileSync(command, args, {
    encoding: "utf8",
    stdio: options.stdio ?? ["ignore", "pipe", "pipe"],
    ...options
  }).trim();
}

export function tryRun(command, args) {
  const result = spawnSync(command, args, { encoding: "utf8" });
  return {
    ok: result.status === 0,
    status: result.status,
    stdout: (result.stdout || "").trim(),
    stderr: (result.stderr || "").trim()
  };
}

export function launchctlGetenv(name) {
  const result = tryRun("/bin/launchctl", ["getenv", name]);
  return result.ok ? result.stdout : "";
}

export function findCodexAppServerPids() {
  const output = tryRun("/bin/ps", ["axo", "pid=,command="]).stdout;
  return output
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.includes("/Applications/Codex.app/Contents/Resources/codex app-server"))
    .map((line) => {
      const pid = line.split(/\s+/, 1)[0];
      return {
        pid,
        command: line.slice(pid.length).trim(),
        kind: line.includes("--analytics-default-enabled") ? "main" : "stdio"
      };
    })
    .filter(Boolean);
}

export function processEnvForPid(pid) {
  const output = tryRun("/bin/ps", ["eww", "-p", String(pid)]).stdout;
  const env = new Map();
  for (const part of output.split(/\s+/)) {
    const index = part.indexOf("=");
    if (index > 0) env.set(part.slice(0, index), part.slice(index + 1));
  }
  return env;
}

export function isProxyListening(proxyUrl) {
  let url;
  try {
    url = new URL(normalizeProxy(proxyUrl).primary);
  } catch {
    return false;
  }
  const host = url.hostname;
  const port = url.port;
  if (!host || !port) return false;
  const result = tryRun("/usr/sbin/lsof", ["-nP", `-iTCP@${host}:${port}`, "-sTCP:LISTEN"]);
  return result.ok && result.stdout.includes(`:${port}`) && result.stdout.includes("LISTEN");
}

export function parseArgs(argv) {
  const args = {
    proxy: defaultProxy,
    proxyMap: buildProxyMap(defaultProxyInput),
    noProxy: defaultNoProxy,
    proxyInput: defaultProxyInput
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--proxy" && argv[index + 1]) {
      args.proxyInput = argv[++index];
      args.proxyMap = buildProxyMap(args.proxyInput);
      args.proxy = args.proxyMap.primary;
    } else if (arg.startsWith("--proxy=")) {
      args.proxyInput = arg.slice("--proxy=".length);
      args.proxyMap = buildProxyMap(args.proxyInput);
      args.proxy = args.proxyMap.primary;
    } else if (arg === "--no-proxy" && argv[index + 1]) {
      args.noProxy = argv[++index];
    } else if (arg.startsWith("--no-proxy=")) {
      args.noProxy = arg.slice("--no-proxy=".length);
    } else if (arg === "-h" || arg === "--help") {
      args.help = true;
    }
  }
  return args;
}

export function normalizeProxy(value) {
  const raw = String(value || "").trim();
  if (!raw) return { explicit: false, primary: defaultProxy, values: defaultProxyValues(defaultProxyInput) };
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(raw)) {
    return { explicit: true, primary: raw, values: Object.fromEntries(proxyEnvKeys.map((key) => [key, raw])) };
  }
  return { explicit: false, primary: `http://${raw}`, values: defaultProxyValues(raw) };
}

export function buildProxyMap(value) {
  return normalizeProxy(value);
}

function defaultProxyValues(address) {
  return {
    HTTP_PROXY: `http://${address}`,
    HTTPS_PROXY: `http://${address}`,
    ALL_PROXY: `socks5://${address}`,
    http_proxy: `http://${address}`,
    https_proxy: `http://${address}`,
    all_proxy: `socks5://${address}`
  };
}

export function escapeXml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

export function buildLaunchAgentPlist(proxyMap, noProxy) {
  const command = [
    ...proxyEnvKeys.map((key) => [key, proxyMap.values[key]]),
    ["NO_PROXY", noProxy],
    ["no_proxy", noProxy]
  ]
    .map(([key, value]) => `/bin/launchctl setenv ${key} ${shellQuote(value)}`)
    .join("; ");

  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN"
  "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${label}</string>
  <key>ProgramArguments</key>
  <array>
    <string>/bin/zsh</string>
    <string>-lc</string>
    <string>${escapeXml(command)}</string>
  </array>
  <key>RunAtLoad</key>
  <true/>
</dict>
</plist>
`;
}

export function shellQuote(value) {
  return `'${String(value).replaceAll("'", "'\\''")}'`;
}

export function writeAndLoadLaunchAgent(proxyMap, noProxy) {
  mkdirSync(dirname(plistPath), { recursive: true });
  writeFileSync(plistPath, buildLaunchAgentPlist(proxyMap, noProxy), "utf8");
  run("/usr/bin/plutil", ["-lint", plistPath]);
  tryRun("/bin/launchctl", ["bootout", `gui/${process.getuid()}`, plistPath]);
  run("/bin/launchctl", ["bootstrap", `gui/${process.getuid()}`, plistPath]);
  run("/bin/launchctl", ["kickstart", "-k", `gui/${process.getuid()}/${label}`]);

  for (const key of proxyEnvKeys) {
    run("/bin/launchctl", ["setenv", key, proxyMap.values[key]]);
  }
  for (const key of ["NO_PROXY", "no_proxy"]) {
    run("/bin/launchctl", ["setenv", key, noProxy]);
  }
}

export function existingLaunchAgent() {
  return existsSync(plistPath);
}
