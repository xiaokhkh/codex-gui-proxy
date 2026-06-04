#!/usr/bin/env node
import {
  assertMacOS,
  defaultNoProxy,
  defaultProxy,
  envMatchesProxy,
  existingLaunchAgent,
  findCodexAppServerPids,
  findCodexCliPids,
  launchctlGetenv,
  listWithLabel,
  parseArgs,
  plistPath,
  processEnvForPid,
  proxyListenerStatus,
  summarizeProxyEnv
} from "./lib.js";

function main() {
  assertMacOS();
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log(`Usage:
  codex-gui-proxy-check

Options:
  --proxy <host:port|url>   Expected proxy address. Default: 127.0.0.1:7890`);
    return;
  }

  const proxy = args.proxy || defaultProxy;
  const proxyMap = args.proxyMap;
  const noProxy = args.noProxy || defaultNoProxy;
  const requiredProxyKeys = ["HTTP_PROXY", "HTTPS_PROXY"];
  const fallbackProxyKeys = ["ALL_PROXY"];
  const requiredNoProxyKeys = ["NO_PROXY"];
  const launchctlValues = new Map([...requiredProxyKeys, ...fallbackProxyKeys, ...requiredNoProxyKeys].map((key) => [key, launchctlGetenv(key)]));
  const servers = findCodexAppServerPids();
  const mainServers = servers.filter((server) => server.source === "gui-main");
  const guiHelperServers = servers.filter((server) => server.source === "gui-helper");
  const cliHelperServers = servers.filter((server) => server.source === "cli-helper");
  const otherStdioServers = servers.filter((server) => server.source === "stdio-helper");
  const cliProcesses = findCodexCliPids();
  const listener = proxyListenerStatus(proxy);

  console.log(`Proxy target: ${proxy}`);
  console.log(`Proxy mode: ${proxyMap.explicit ? "explicit protocol" : "default protocol map"}`);
  console.log(`Proxy listener: ${listener.listening ? "ok" : "missing"} (${listener.detail})`);
  console.log(`LaunchAgent: ${existingLaunchAgent() ? plistPath : "missing"}`);
  for (const key of requiredProxyKeys) {
    console.log(`launchctl ${key}: ${launchctlValues.get(key) || "(empty)"}`);
  }
  for (const key of fallbackProxyKeys) {
    console.log(`launchctl ${key}: ${launchctlValues.get(key) || "(empty)"}`);
  }
  console.log(`launchctl NO_PROXY: ${launchctlValues.get("NO_PROXY") || "(empty)"}`);

  if (mainServers.length === 0) {
    console.log("Codex main app-server: not running");
  } else {
    for (const server of mainServers) {
      const env = processEnvForPid(server.pid);
      const values = summarizeProxyEnv(env, [...requiredProxyKeys, ...fallbackProxyKeys]);
      console.log(`Codex main app-server pid ${server.pid}: ${values}`);
    }
  }

  printAppServerGroup("Codex GUI stdio helpers", guiHelperServers, [...requiredProxyKeys, ...fallbackProxyKeys]);
  printAppServerGroup("Codex CLI stdio helpers", cliHelperServers, [...requiredProxyKeys, ...fallbackProxyKeys]);
  printAppServerGroup("Codex other stdio helpers", otherStdioServers, [...requiredProxyKeys, ...fallbackProxyKeys]);

  if (cliProcesses.length === 0) {
    console.log("Codex CLI processes: not running");
  } else {
    console.log(`Codex CLI processes: ${cliProcesses.length} running (${listWithLabel(cliProcesses.map((processInfo) => processInfo.pid))})`);
    for (const processInfo of cliProcesses) {
      const env = processEnvForPid(processInfo.pid);
      console.log(`Codex CLI ${processInfo.kind} pid ${processInfo.pid}: ${summarizeProxyEnv(env, [...requiredProxyKeys, ...fallbackProxyKeys])}`);
    }
  }

  const launchctlOk = requiredProxyKeys.every((key) => launchctlValues.get(key) === proxyMap.values[key])
    && requiredNoProxyKeys.every((key) => launchctlValues.get(key) === noProxy);
  const fallbackProxyOk = fallbackProxyKeys.every((key) => launchctlValues.get(key) === proxyMap.values[key]);
  const runningGuiOk = mainServers.length === 0 || mainServers.every((server) => {
    const env = processEnvForPid(server.pid);
    return envMatchesProxy(env, requiredProxyKeys, proxyMap);
  });
  const runningCliOk = cliProcesses.length === 0 || cliProcesses.every((processInfo) => {
    const env = processEnvForPid(processInfo.pid);
    return envMatchesProxy(env, requiredProxyKeys, proxyMap);
  });

  if (listener.listening && launchctlOk && runningGuiOk && runningCliOk) {
    if (!fallbackProxyOk) {
      console.log("Warning: ALL_PROXY differs from the expected fallback value, but HTTP_PROXY/HTTPS_PROXY are correct for Codex GUI reconnecting.");
    }
    console.log("Status: ok");
    return;
  }

  console.log("Status: needs attention");
  if (!listener.listening) console.log("- Start your proxy client or change --proxy.");
  if (!launchctlOk) console.log("- Run: codex-gui-proxy-set --proxy " + proxy);
  if (!runningGuiOk) console.log("- Restart Codex so the GUI app-server inherits the new launchd environment.");
  if (!runningCliOk) console.log("- Restart the affected Codex CLI sessions from a shell that has matching HTTP_PROXY/HTTPS_PROXY.");
  process.exitCode = 1;
}

function printAppServerGroup(label, servers, proxyKeys) {
  if (servers.length === 0) {
    console.log(`${label}: none`);
    return;
  }
  console.log(`${label}: ${servers.length} running (${listWithLabel(servers.map((server) => server.pid))})`);
  for (const server of servers) {
    const env = processEnvForPid(server.pid);
    console.log(`${label.slice(0, -1)} pid ${server.pid}: ${summarizeProxyEnv(env, proxyKeys)}`);
  }
}

try {
  main();
} catch (error) {
  console.error(`codex-gui-proxy-check: ${error.message}`);
  process.exit(1);
}
