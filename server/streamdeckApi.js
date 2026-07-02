/**
 * Stream Deck process manager — HID runs in a child process, not in the Electron main/server process.
 */
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { platform } from "node:os";
import { join } from "node:path";
import { IS_ELECTRON, getContentRoot, getInstallRoot, DATA_DIR } from "./paths.js";
import { logStartup } from "./startupLog.js";

const STATUS_FILE = join(DATA_DIR, "streamdeck-status.json");
const QUICK_CLOSE_FLAG = join(DATA_DIR, "streamdeck-quick-close.flag");
const COMMAND_FILE = join(DATA_DIR, "streamdeck-command.json");

let worker = null;
let workerStarting = false;

function idleStatus(error = null) {
  return {
    supported: platform() === "win32" && IS_ELECTRON,
    connected: false,
    worker: false,
    phase: "idle",
    error,
    currentPage: 0,
    pageCount: 0,
    pageNames: [],
    devicesFound: [],
    drawProgress: null,
    imagesReady: false,
    imagesDegraded: false,
    imageUploadOk: null,
    imageUploadError: null,
    imagesDrawnCount: 0,
    imagesFailedCount: 0,
    cardPrefetch: null,
    cardsReady: 0,
    cardsTotal: 0,
    cardsMissing: [],
    refreshMode: null,
    uploadMode: null,
    panelRenderMs: null,
    panelEncodeMs: null,
    panelUploadMs: null,
    hint: null,
  };
}

function writeWorkerCrashStatus() {
  try {
    const fromFile = readStatusFile();
    if (!fromFile || fromFile.phase !== "drawing" || fromFile.error) return;
    mkdirSync(DATA_DIR, { recursive: true });
    writeFileSync(
      STATUS_FILE,
      `${JSON.stringify(
        {
          ...fromFile,
          phase: "error",
          connected: false,
          worker: false,
          error: "Stream Deck worker crashed during key draw. Reinstall Riftbound OBS.",
        },
        null,
        2
      )}\n`,
      "utf8"
    );
  } catch (err) {
    logStartup("[streamdeck] worker crash status write failed", err);
  }
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
    if (code !== 0 && code != null) {
      writeWorkerCrashStatus();
    }
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

export async function stopStreamDeckSafe({ quickClose = false } = {}) {
  if (!worker) return;
  if (quickClose) {
    try {
      mkdirSync(DATA_DIR, { recursive: true });
      writeFileSync(QUICK_CLOSE_FLAG, "1", "utf8");
    } catch (err) {
      logStartup("[streamdeck] quick-close flag failed", err);
    }
  }
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
    if (last.phase === "error" && last.error) return last;
    if (!last.worker && last.phase && last.phase !== "idle") return last;
    await new Promise((r) => setTimeout(r, 400));
  }

  if (last?.phase === "drawing") {
    return {
      ...last,
      phase: "error",
      connected: false,
      error: "Drawing timed out — try reinstalling Riftbound OBS.",
    };
  }

  return (
    last || {
      ...idleStatus("Timed out waiting for Stream Deck worker."),
      phase: "error",
    }
  );
}

export async function reconnectStreamDeckSafe() {
  await stopStreamDeckSafe({ quickClose: true });
  await new Promise((r) => setTimeout(r, 2000));
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
    return {
      ...base,
      worker: true,
      phase: "loading",
      error: null,
      hint: "Starting Stream Deck worker…",
    };
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

export function queueStreamDeckRefreshImages(force = true) {
  if (!worker) return false;
  try {
    mkdirSync(DATA_DIR, { recursive: true });
    writeFileSync(
      COMMAND_FILE,
      `${JSON.stringify({ cmd: "refresh-images", force, at: Date.now() })}\n`,
      "utf8"
    );
    return true;
  } catch (err) {
    logStartup("[streamdeck] refresh-images command failed", err);
    return false;
  }
}
