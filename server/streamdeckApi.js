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
    devicesFound: [],
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

  const contentRoot = getContentRoot();
  const script = workerScriptPath();
  if (!existsSync(script)) {
    logStartup("[streamdeck] worker script missing", script);
    return null;
  }

  workerStarting = true;
  const installRoot = getInstallRoot();
  const child = spawn(process.execPath, [script], {
    cwd: contentRoot,
    env: {
      ...process.env,
      ELECTRON_RUN_AS_NODE: "1",
      RIFTBOUND_ELECTRON: "1",
      RIFTBOUND_INSTALL_ROOT: installRoot,
      RIFTBOUND_CONTENT_ROOT: contentRoot,
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
  logStartup(`[streamdeck] worker spawned (pid ${child.pid}, cwd ${contentRoot})`);
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

export async function waitForStreamDeckStatus(timeoutMs = 15000) {
  const deadline = Date.now() + timeoutMs;
  let last = null;

  while (Date.now() < deadline) {
    last = await getStreamDeckStatusSafe();
    if (last.connected) return last;
    if (last.error && last.worker) return last;
    if (last.worker && last.lastScanAt) return last;
    await new Promise((r) => setTimeout(r, 400));
  }

  return last || idleStatus("Timed out waiting for Stream Deck worker.");
}

export async function reconnectStreamDeckSafe() {
  await stopStreamDeckSafe();
  await new Promise((r) => setTimeout(r, 800));
  await startStreamDeckSafe();
  return waitForStreamDeckStatus(15000);
}

export async function getStreamDeckStatusSafe() {
  const base = idleStatus();
  if (!base.supported) return base;

  const fromFile = readStatusFile();
  const workerAlive = Boolean(worker);

  if (fromFile) {
    return {
      ...base,
      ...fromFile,
      worker: workerAlive || fromFile.worker === true,
    };
  }

  if (workerAlive) {
    return { ...base, worker: true, error: "Stream Deck worker starting…" };
  }

  return {
    ...base,
    error: null,
    hint: "Connecting to Stream Deck…",
  };
}

export function refreshStreamDeckIfConnectedSafe() {
  if (!worker) return;
  /* Worker listens to WebSocket state broadcasts and refreshes keys itself. */
}
