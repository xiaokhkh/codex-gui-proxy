#!/usr/bin/env node
import {
  assertMacOS,
  readProcesses
} from "./lib.js";

function main() {
  assertMacOS();
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log(`Usage:
  codex-gui-proxy-clean --dry-run
  codex-gui-proxy-clean --apply

Options:
  --dry-run   Print cleanup candidates without killing them. Default.
  --apply     Kill cleanup candidates with SIGTERM, then SIGKILL if needed.`);
    return;
  }

  const processes = readProcesses();
  const processByPid = new Map(processes.map((processInfo) => [processInfo.pid, processInfo]));
  const activeCodexFrameworkVersions = findActiveCodexFrameworkVersions(processes);
  const candidates = findCleanupCandidates(processes, processByPid, activeCodexFrameworkVersions);

  console.log(`Mode: ${args.apply ? "apply" : "dry-run"}`);
  console.log(`Active Codex Framework versions: ${activeCodexFrameworkVersions.size > 0 ? [...activeCodexFrameworkVersions].join(", ") : "none"}`);

  if (candidates.length === 0) {
    console.log("Cleanup candidates: none");
    return;
  }

  console.log(`Cleanup candidates: ${candidates.length}`);
  for (const candidate of candidates) {
    console.log(`- pid ${candidate.pid}: ${candidate.reason}`);
    console.log(`  ${candidate.command}`);
  }

  if (!args.apply) {
    console.log("No processes were killed. Re-run with --apply to clean them.");
    return;
  }

  terminateCandidates(candidates);
}

function parseArgs(argv) {
  const args = { apply: false, help: false };
  for (const arg of argv) {
    if (arg === "--apply") args.apply = true;
    if (arg === "--dry-run") args.apply = false;
    if (arg === "-h" || arg === "--help") args.help = true;
  }
  return args;
}

function findActiveCodexFrameworkVersions(processes) {
  const versions = new Set();
  for (const processInfo of processes) {
    if (processInfo.ppid === "1") continue;
    const version = codexFrameworkVersion(processInfo.command);
    if (version) versions.add(version);
  }
  return versions;
}

function findCleanupCandidates(processes, processByPid, activeCodexFrameworkVersions) {
  const candidates = [];
  for (const processInfo of processes) {
    const reason = cleanupReason(processInfo, processByPid, activeCodexFrameworkVersions);
    if (!reason) continue;
    candidates.push({
      pid: processInfo.pid,
      command: processInfo.command,
      reason
    });
  }
  return candidates.sort((a, b) => Number(a.pid) - Number(b.pid));
}

function cleanupReason(processInfo, processByPid, activeCodexFrameworkVersions) {
  if (processInfo.ppid !== "1") return "";

  if (isOrphanHeadlessAutomationChrome(processInfo.command)) {
    return "orphan headless automation Chrome";
  }

  if (isCodexElectronCrashpad(processInfo.command)) {
    return "orphan old Codex Electron crashpad";
  }

  const frameworkVersion = codexFrameworkVersion(processInfo.command);
  if (frameworkVersion && isCodexBrowserCrashpad(processInfo.command)) {
    if (!activeCodexFrameworkVersions.has(frameworkVersion)) {
      return `orphan Codex crashpad for inactive Framework ${frameworkVersion}`;
    }
    if (!hasNearbyCurrentCodexProcess(processInfo, processByPid)) {
      return "";
    }
  }

  return "";
}

function isOrphanHeadlessAutomationChrome(command) {
  return command.includes("/Applications/Google Chrome.app/Contents/MacOS/Google Chrome")
    && command.includes("--headless")
    && command.includes("--enable-automation")
    && command.includes("/T/rod/user-data/");
}

function isCodexElectronCrashpad(command) {
  return command.includes("/Applications/Codex.app/Contents/Frameworks/Electron Framework.framework/")
    && command.includes("chrome_crashpad_handler");
}

function isCodexBrowserCrashpad(command) {
  return command.includes("/Applications/Codex.app/Contents/Frameworks/Codex Framework.framework/")
    && command.includes("browser_crashpad_handler");
}

function codexFrameworkVersion(command) {
  const match = command.match(/Codex Framework\.framework\/Versions\/([^/]+)/);
  return match?.[1] || "";
}

function hasNearbyCurrentCodexProcess(processInfo, processByPid) {
  return processByPid.has(processInfo.ppid);
}

function terminateCandidates(candidates) {
  const pids = candidates.map((candidate) => Number(candidate.pid));
  for (const pid of pids) {
    try {
      process.kill(pid, "SIGTERM");
    } catch {
      // Process may have already exited.
    }
  }

  waitForExit(pids, 1200);
  const stillRunning = pids.filter((pid) => isRunning(pid));
  if (stillRunning.length > 0) {
    for (const pid of stillRunning) {
      try {
        process.kill(pid, "SIGKILL");
      } catch {
        // Process may have already exited.
      }
    }
  }

  waitForExit(stillRunning, 1200);
  const survivors = pids.filter((pid) => isRunning(pid));
  if (survivors.length === 0) {
    console.log(`Killed ${pids.length} process${pids.length === 1 ? "" : "es"}.`);
    return;
  }

  console.log(`Killed ${pids.length - survivors.length} process${pids.length - survivors.length === 1 ? "" : "es"}. Survivors: ${survivors.join(", ")}`);
  process.exitCode = 1;
}

function isRunning(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function waitForExit(pids, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (pids.every((pid) => !isRunning(pid))) return;
    sleep(100);
  }
}

function sleep(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

try {
  main();
} catch (error) {
  console.error(`codex-gui-proxy-clean: ${error.message}`);
  process.exit(1);
}
