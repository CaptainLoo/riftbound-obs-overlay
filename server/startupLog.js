/**
 * Append startup / crash lines to <userData>/RiftboundOBS/startup.log.
 *
 * Every line carries the process role and the milliseconds elapsed since the
 * process started, so one log file reads as a boot timeline across the
 * Electron main process, the server and the Stream Deck worker.
 */
import { appendFileSync, mkdirSync } from "node:fs";
import { homedir, platform } from "node:os";
import { join } from "node:path";

const ROLE =
  process.env.RIFTBOUND_LOG_ROLE ||
  (process.env.RIFTBOUND_SD_WORKER === "1" ? "sd-worker" : "server");

function logDir() {
  if (platform() === "win32") {
    const appData = process.env.APPDATA || join(homedir(), "AppData", "Roaming");
    return join(appData, "RiftboundOBS");
  }
  if (platform() === "darwin") {
    return join(homedir(), "Library", "Application Support", "RiftboundOBS");
  }
  return join(homedir(), ".config", "riftbound-obs");
}

function startupLogPath() {
  return join(logDir(), "startup.log");
}

function uptimeMs() {
  return Math.round(process.uptime() * 1000);
}

export function logStartup(message, err = null) {
  const line = `[${new Date().toISOString()}] [${ROLE} +${uptimeMs()}ms] ${message}${
    err ? ` — ${err.stack || err.message || err}` : ""
  }`;
  try {
    mkdirSync(logDir(), { recursive: true });
    appendFileSync(startupLogPath(), `${line}\n`, "utf8");
  } catch {
    /* ignore */
  }
  console.error(line);
}
