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
const codexAppServerFragment = "/Applications/Codex.app/Contents/Resources/codex app-server";

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

export function readProcesses() {
  const output = tryRun("/bin/ps", ["axo", "pid=,ppid=,command="]).stdout;
  const processes = [];
  for (const line of output.split("\n")) {
    const match = line.trim().match(/^(\d+)\s+(\d+)\s+(.+)$/);
    if (!match) continue;
    processes.push({
      pid: match[1],
      ppid: match[2],
      command: match[3]
    });
  }
  return processes;
}

export function findCodexAppServerPids() {
  const processes = readProcesses();
  const processByPid = new Map(processes.map((processInfo) => [processInfo.pid, processInfo]));
  return processes
    .filter((processInfo) => processInfo.command.includes(codexAppServerFragment))
    .map((processInfo) => {
      const parentChain = buildParentChain(processInfo, processByPid);
      const kind = processInfo.command.includes("--analytics-default-enabled") ? "main" : "stdio";
      return {
        pid: processInfo.pid,
        ppid: processInfo.ppid,
        command: processInfo.command,
        kind,
        source: classifyAppServerSource(kind, parentChain),
        parentCommand: parentChain[0]?.command || ""
      };
    });
}

export function findCodexCliPids() {
  return readProcesses()
    .filter((processInfo) => isCodexCliProcess(processInfo.command))
    .map((processInfo) => ({
      pid: processInfo.pid,
      ppid: processInfo.ppid,
      command: processInfo.command,
      kind: processInfo.command.includes("node ") ? "node-wrapper" : "native"
    }));
}

function buildParentChain(processInfo, processByPid) {
  const chain = [];
  let current = processInfo;
  for (let depth = 0; depth < 8; depth += 1) {
    const parent = processByPid.get(current.ppid);
    if (!parent) break;
    chain.push(parent);
    current = parent;
  }
  return chain;
}

function classifyAppServerSource(kind, parentChain) {
  if (kind === "main") return "gui-main";
  if (parentChain.some((processInfo) => processInfo.command.includes(`${codexAppServerFragment} --analytics-default-enabled`))) {
    return "gui-helper";
  }
  if (parentChain.some((processInfo) => isCodexCliProcess(processInfo.command))) {
    return "cli-helper";
  }
  return "stdio-helper";
}

function isCodexCliProcess(command) {
  if (command.includes(codexAppServerFragment)) return false;
  return /(?:^|\s)node\s+.*\/bin\/codex(?:\s|$)/.test(command)
    || command.includes("/node_modules/@openai/codex")
    || command.includes("/vendor/aarch64-apple-darwin/bin/codex");
}

export function summarizeProxyEnv(env, keys) {
  return keys.map((key) => `${key}=${env.get(key) || "(empty)"}`).join(" ");
}

export function envMatchesProxy(env, keys, proxyMap) {
  return keys.every((key) => env.get(key) === proxyMap.values[key]);
}

export function listWithLabel(items) {
  return items.length === 0 ? "none" : items.join(", ");
}

export function proxyListenerStatus(proxyUrl) {
  let url;
  try {
    url = new URL(normalizeProxy(proxyUrl).primary);
  } catch {
    return { listening: false, detail: "invalid proxy URL" };
  }
  const host = normalizeListenerHost(url.hostname);
  const port = url.port;
  if (!host || !port) return { listening: false, detail: "missing host or port" };

  const exactResult = tryRun("/usr/sbin/lsof", ["-nP", `-iTCP@${host}:${port}`, "-sTCP:LISTEN"]);
  const exactLines = listenerLines(exactResult.stdout, port);
  if (exactResult.ok && exactLines.length > 0) {
    return { listening: true, detail: exactLines[0] };
  }

  const portResult = tryRun("/usr/sbin/lsof", ["-nP", `-iTCP:${port}`, "-sTCP:LISTEN"]);
  const portLines = listenerLines(portResult.stdout, port);
  const matchingLine = portLines.find((line) => listenerLineMatchesHost(line, host, port));
  if (portResult.ok && matchingLine) {
    return { listening: true, detail: matchingLine };
  }

  if (portResult.ok && portLines.length > 0) {
    return { listening: false, detail: `port ${port} is listening on a different address` };
  }
  return { listening: false, detail: `no listener on ${host}:${port}` };
}

function listenerLines(output, port) {
  return output
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.includes(`:${port}`) && line.includes("LISTEN"));
}

function listenerLineMatchesHost(line, host, port) {
  if (line.includes(`*:${port}`)) return true;
  const hostCandidates = listenerHostCandidates(host);
  return hostCandidates.some((candidate) => line.includes(`${candidate}:${port}`));
}

function listenerHostCandidates(host) {
  if (host === "localhost") return ["localhost", "127.0.0.1", "::1", "[::1]"];
  if (host === "127.0.0.1") return ["127.0.0.1", "localhost"];
  if (host === "::1" || host === "[::1]") return ["::1", "[::1]", "localhost"];
  return [host];
}

function normalizeListenerHost(host) {
  return String(host || "").replace(/^\[(.*)\]$/, "$1");
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
  return proxyListenerStatus(proxyUrl).listening;
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
