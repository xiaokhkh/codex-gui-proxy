#!/usr/bin/env node
import {
  assertMacOS,
  defaultNoProxy,
  defaultProxy,
  existingLaunchAgent,
  findCodexAppServerPids,
  isProxyListening,
  launchctlGetenv,
  parseArgs,
  plistPath,
  processEnvForPid
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
  const mainServers = servers.filter((server) => server.kind === "main");
  const stdioServers = servers.filter((server) => server.kind === "stdio");
  const proxyListening = isProxyListening(proxy);

  console.log(`Proxy target: ${proxy}`);
  console.log(`Proxy mode: ${proxyMap.explicit ? "explicit protocol" : "default protocol map"}`);
  console.log(`Proxy listener: ${proxyListening ? "ok" : "missing"}`);
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
      const values = [...requiredProxyKeys, ...fallbackProxyKeys].map((key) => `${key}=${env.get(key) || "(empty)"}`).join(" ");
      console.log(`Codex main app-server pid ${server.pid}: ${values}`);
    }
  }

  if (stdioServers.length > 0) {
    console.log(`Codex stdio app-server processes: ${stdioServers.length} running`);
    for (const server of stdioServers) {
      const env = processEnvForPid(server.pid);
      const values = [...requiredProxyKeys, ...fallbackProxyKeys].map((key) => `${key}=${env.get(key) || "(empty)"}`).join(" ");
      console.log(`Codex stdio app-server pid ${server.pid}: ${values}`);
    }
    console.log("Note: stdio app-server processes are local helper transports. They may keep old env vars until their parent tools restart.");
  }

  const launchctlOk = requiredProxyKeys.every((key) => launchctlValues.get(key) === proxyMap.values[key])
    && requiredNoProxyKeys.every((key) => launchctlValues.get(key) === noProxy);
  const fallbackProxyOk = fallbackProxyKeys.every((key) => launchctlValues.get(key) === proxyMap.values[key]);
  const runningCodexOk = mainServers.length === 0 || mainServers.every((server) => {
    const env = processEnvForPid(server.pid);
    return requiredProxyKeys.every((key) => env.get(key) === proxyMap.values[key]);
  });

  if (proxyListening && launchctlOk && runningCodexOk) {
    if (!fallbackProxyOk) {
      console.log("Warning: ALL_PROXY differs from the expected fallback value, but HTTP_PROXY/HTTPS_PROXY are correct for Codex GUI reconnecting.");
    }
    console.log("Status: ok");
    return;
  }

  console.log("Status: needs attention");
  if (!proxyListening) console.log("- Start your proxy client or change --proxy.");
  if (!launchctlOk) console.log("- Run: codex-gui-proxy-set --proxy " + proxy);
  if (!runningCodexOk) console.log("- Restart Codex so app-server inherits the new GUI environment.");
  process.exitCode = 1;
}

try {
  main();
} catch (error) {
  console.error(`codex-gui-proxy-check: ${error.message}`);
  process.exit(1);
}
