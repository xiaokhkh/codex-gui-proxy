#!/usr/bin/env node
import {
  assertMacOS,
  defaultNoProxy,
  defaultProxy,
  findCodexAppServerPids,
  isProxyListening,
  parseArgs,
  plistPath,
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
  const mainPids = servers.filter((server) => server.kind === "main").map((server) => server.pid);
  if (mainPids.length > 0) {
    console.log(`Codex main app-server is already running (${mainPids.join(", ")}). Restart Codex to inherit the new environment.`);
  }
}

try {
  main();
} catch (error) {
  console.error(`codex-gui-proxy-set: ${error.message}`);
  process.exit(1);
}
