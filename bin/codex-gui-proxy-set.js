#!/usr/bin/env node
import {
  assertMacOS,
  defaultNoProxy,
  defaultProxy,
  envMatchesProxy,
  findCodexAppServerPids,
  findCodexCliPids,
  isProxyListening,
  parseArgs,
  plistPath,
  processEnvForPid,
  writeAndLoadLaunchAgent
} from "./lib.js";

function main() {
  assertMacOS();
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log(`Usage:
  codex-gui-proxy-set --proxy 127.0.0.1:7890

Options:
  --proxy <host:port|url>   Proxy address. Default: 127.0.0.1:7890
  --no-proxy <list>         Hosts that should bypass proxy. Default: localhost,127.0.0.1,::1`);
    return;
  }

  const proxy = args.proxy || defaultProxy;
  const proxyMap = args.proxyMap;
  const noProxy = args.noProxy || defaultNoProxy;
  writeAndLoadLaunchAgent(proxyMap, noProxy);

  console.log(`Wrote ${plistPath}`);
  console.log(`Proxy mode: ${proxyMap.explicit ? "explicit protocol" : "default protocol map"}`);
  console.log(`Set HTTP_PROXY to ${proxyMap.values.HTTP_PROXY}`);
  console.log(`Set HTTPS_PROXY to ${proxyMap.values.HTTPS_PROXY}`);
  console.log(`Set ALL_PROXY to ${proxyMap.values.ALL_PROXY}`);
  console.log(`Set NO_PROXY to ${noProxy}`);
  console.log(`Proxy listener: ${isProxyListening(proxy) ? "ok" : "missing"}`);

  const servers = findCodexAppServerPids();
  const mainPids = servers.filter((server) => server.source === "gui-main").map((server) => server.pid);
  if (mainPids.length > 0) {
    console.log(`Codex main app-server is already running (${mainPids.join(", ")}). Restart Codex to inherit the new environment.`);
  }

  const cliProcesses = findCodexCliPids();
  const staleCliProcesses = cliProcesses.filter((processInfo) => {
    const env = processEnvForPid(processInfo.pid);
    return !envMatchesProxy(env, ["HTTP_PROXY", "HTTPS_PROXY"], proxyMap);
  });
  if (staleCliProcesses.length > 0) {
    console.log(`Codex CLI sessions already running (${staleCliProcesses.map((processInfo) => processInfo.pid).join(", ")}) still have old shell env. Restart those CLI sessions from a shell with matching proxy vars.`);
  }
}

try {
  main();
} catch (error) {
  console.error(`codex-gui-proxy-set: ${error.message}`);
  process.exit(1);
}
