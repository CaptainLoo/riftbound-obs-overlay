/**
 * Stream Deck process manager. The HID device is driven by a child process
 * (streamdeckWorker.js) that holds no database: the server pushes a model over
 * IPC and receives status updates back.
 */
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { getContentRoot, getInstallRoot } from "./paths.js";
import { logStartup } from "./startupLog.js";
import { buildStreamDeckModel } from "./streamdeck/model.js";
import { defaultStreamDeckStatus, isStreamDeckSupported } from "./streamdeck/status.js";
import { createTransport } from "./streamdeck/transport.js";

const SHUTDOWN_GRACE_MS = 1500;

let worker = null;
let transport = null;
let lastStatus = null;
let lastModelRev = null;
const statusListeners = new Set();

function idleStatus(error = null, extra = {}) {
  return { ...defaultStreamDeckStatus(), error, ...extra };
}

function setLastStatus(status) {
  lastStatus = status;
  for (const fn of statusListeners) {
    try {
      fn(status);
    } catch {
      /* ignore listener errors */
    }
  }
}

/** Subscribe to worker status updates (used by the hub to notify browsers). */
export function onStreamDeckStatus(fn) {
  statusListeners.add(fn);
  return () => statusListeners.delete(fn);
}

function workerScriptPath() {
  return join(getContentRoot(), "server", "streamdeckWorker.js");
}

function spawnWorker() {
  if (worker) return worker;
  if (!isStreamDeckSupported()) {
    logStartup("[streamdeck] disabled on this install");
    return null;
  }

  const contentRoot = getContentRoot();
  const script = workerScriptPath();
  if (!existsSync(script)) {
    logStartup("[streamdeck] worker script missing", script);
    setLastStatus(idleStatus("Stream Deck worker script missing. Reinstall Riftbound OBS.", { phase: "error" }));
    return null;
  }

  const child = spawn(process.execPath, [script], {
    cwd: contentRoot,
    env: {
      ...process.env,
      ELECTRON_RUN_AS_NODE: "1",
      RIFTBOUND_SD_WORKER: "1",
      RIFTBOUND_INSTALL_ROOT: getInstallRoot(),
      RIFTBOUND_CONTENT_ROOT: contentRoot,
    },
    stdio: ["ignore", "pipe", "pipe", "ipc"],
    windowsHide: true,
  });

  // The worker writes its own timestamped lines to startup.log; just mirror them to the console.
  child.stdout?.on("data", (chunk) => process.stdout.write(chunk));
  child.stderr?.on("data", (chunk) => process.stderr.write(chunk));

  const t = createTransport(child);
  t.onReady(() => {
    lastModelRev = null;
    pushStreamDeckModel(true);
  });
  t.onStatus(({ status }) => setLastStatus({ ...status, worker: true }));

  child.on("exit", (code, signal) => {
    logStartup(`[streamdeck] worker exited (code ${code ?? "?"}${signal ? `, ${signal}` : ""})`);
    const crashed = code !== 0 && code != null;
    const prev = lastStatus || idleStatus();
    setLastStatus({
      ...prev,
      worker: false,
      connected: false,
      phase: crashed ? "error" : "idle",
      error: crashed ? prev.error || "Stream Deck worker stopped unexpectedly. Click Reconnect." : prev.error,
    });
    if (worker === child) {
      worker = null;
      transport = null;
    }
  });

  worker = child;
  transport = t;
  setLastStatus(idleStatus(null, { worker: true, phase: "loading", hint: "Starting Stream Deck worker…" }));
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

/** Ask the worker to release the device and exit; force-kill after a grace period. */
export async function stopStreamDeckSafe({ quickClose = false } = {}) {
  const child = worker;
  if (!child) return;
  worker = null;
  const t = transport;
  transport = null;

  const exited = new Promise((resolve) => {
    if (child.exitCode !== null) return resolve(true);
    const timer = setTimeout(() => resolve(false), SHUTDOWN_GRACE_MS);
    child.once("exit", () => {
      clearTimeout(timer);
      resolve(true);
    });
  });

  const sent = t?.sendCommand("shutdown", { quick: quickClose });
  if (!sent || !(await exited)) {
    try {
      child.kill();
    } catch {
      /* ignore */
    }
  }
}

export async function waitForStreamDeckStatus(timeoutMs = 15000) {
  const deadline = Date.now() + timeoutMs;
  let last = null;
  while (Date.now() < deadline) {
    last = await getStreamDeckStatusSafe();
    if (last.connected) return last;
    if (last.phase === "error" && last.error) return last;
    if (!last.worker && last.phase !== "idle" && last.phase !== "loading") return last;
    await new Promise((r) => setTimeout(r, 250));
  }
  if (last?.phase === "drawing") {
    return { ...last, phase: "error", connected: false, error: "Drawing timed out — try reinstalling Riftbound OBS." };
  }
  return last || { ...idleStatus("Timed out waiting for Stream Deck worker."), phase: "error" };
}

export async function reconnectStreamDeckSafe() {
  await stopStreamDeckSafe({ quickClose: true });
  await new Promise((r) => setTimeout(r, 500));
  await startStreamDeckSafe();
  return waitForStreamDeckStatus(15000);
}

export async function getStreamDeckStatusSafe() {
  const base = idleStatus();
  if (!base.supported) return base;
  if (lastStatus) return { ...base, ...lastStatus, worker: Boolean(worker) || lastStatus.worker === true };
  if (worker) return { ...base, worker: true, phase: "loading", hint: "Starting Stream Deck worker…" };
  return { ...base, hint: "Connecting to Stream Deck…" };
}

export function queueStreamDeckRefreshImages(force = true) {
  if (!transport) return false;
  return transport.sendCommand("refresh-images", { force });
}

/**
 * Push the current model to the worker when its revision changed.
 * Called by stateService after each broadcast, and on worker start.
 */
export function pushStreamDeckModel(force = false) {
  if (!transport) return false;
  const model = buildStreamDeckModel();
  if (!force && model.rev === lastModelRev) return false;
  lastModelRev = model.rev;
  return transport.sendModel(model);
}
