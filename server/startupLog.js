/**
 * Append startup / crash lines to %APPDATA%\RiftboundOBS\startup.log
 */
import { appendFileSync, mkdirSync } from "node:fs";
import { homedir, platform } from "node:os";
import { join } from "node:path";

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

export function startupLogPath() {
  return join(logDir(), "startup.log");
}

export function logStartup(message, err = null) {
  const line = `[${new Date().toISOString()}] ${message}${
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
