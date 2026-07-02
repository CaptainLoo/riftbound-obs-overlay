/**
 * Stream Deck process manager — HID runs in a child process, not in the Electron main/server process.
 */
import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { platform } from "node:os";
import { join } from "node:path";
import { IS_ELECTRON, getContentRoot, getInstallRoot, DATA_DIR } from "./paths.js";
import { logStartup } from "./startupLog.js";

const STATUS_FILE = join(DATA_DIR, "streamdeck-status.json");

let worker = null;
let workerStarting = false;

function idleStatus(error = null) {
  return {
    supported: platform() === "win32" && IS_ELECTRON,
    connected: false,
    worker: false,
    error,
    currentPage: 0,
    pageCount: 0,
    pageNames: [],
  };
}

function readStatusFile() {
  if (!existsSync(STATUS_FILE)) return null;
  try {
    return JSON.parse(readFileSync(STATUS_FILE, "utf8"));
  } catch {
    return null;
  }
}

function workerScriptPath() {
  return join(getContentRoot(), "server", "streamdeckWorker.js");
}

function spawnWorker() {
  if (process.env.RIFTBOUND_NO_STREAMDECK === "1") {
    logStartup("[streamdeck] disabled (RIFTBOUND_NO_STREAMDECK=1)");
    return null;
  }
  if (worker || workerStarting) return worker;
  if (platform() !== "win32" || !IS_ELECTRON) return null;

  const script = workerScriptPath();
  if (!existsSync(script)) {
    logStartup("[streamdeck] worker script missing", script);
    return null;
  }

  workerStarting = true;
  const installRoot = getInstallRoot();
  const child = spawn(process.execPath, [script], {
    cwd: installRoot,
    env: {
      ...process.env,
      ELECTRON_RUN_AS_NODE: "1",
      RIFTBOUND_ELECTRON: "1",
      RIFTBOUND_INSTALL_ROOT: installRoot,
    },
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });

  child.stdout?.on("data", (chunk) => logStartup(String(chunk).trim()));
  child.stderr?.on("data", (chunk) => logStartup(String(chunk).trim()));

  child.on("exit", (code) => {
    logStartup(`[streamdeck] worker exited (code ${code ?? "?"})`);
    worker = null;
    workerStarting = false;
  });

  worker = child;
  workerStarting = false;
  logStartup(`[streamdeck] worker spawned (pid ${child.pid})`);
  return child;
}

export async function startStreamDeckSafe() {
  try {
    spawnWorker();
  } catch (err) {
    logStartup("[streamdeck] worker spawn failed", err);
  }
}

export async function stopStreamDeckSafe() {
  if (!worker) return;
  try {
    worker.kill("SIGTERM");
  } catch {
    /* ignore */
  }
  worker = null;
  workerStarting = false;
}

export async function getStreamDeckStatusSafe() {
  const base = idleStatus();
  if (!base.supported) return base;

  const fromFile = readStatusFile();
  if (fromFile) {
    return { ...base, ...fromFile, worker: Boolean(worker) };
  }

  if (worker) {
    return { ...base, worker: true, error: "Stream Deck worker starting…" };
  }

  return {
    ...base,
    error: null,
    hint: "Click Reconnect on the Stream Deck tab to connect your device.",
  };
}

export function refreshStreamDeckIfConnectedSafe() {
  if (!worker) return;
  /* Worker listens to WebSocket state broadcasts and refreshes keys itself. */
}
