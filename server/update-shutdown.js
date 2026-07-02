/**
 * Graceful shutdown before applying an update + PID file for updater coordination.
 */
import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { updatesDir } from "./update-utils.js";

let shutdownForUpdateFn = null;

export function appPidPath() {
  return join(updatesDir(), "app.pid");
}

export function registerShutdownForUpdate(fn) {
  shutdownForUpdateFn = fn;
}

export function writeAppPid() {
  try {
    mkdirSync(updatesDir(), { recursive: true });
    writeFileSync(appPidPath(), `${process.pid}\n`, "utf8");
  } catch {
    /* ignore */
  }
}

export function clearAppPid() {
  try {
    if (existsSync(appPidPath())) unlinkSync(appPidPath());
  } catch {
    /* ignore */
  }
}

export function readAppPid() {
  try {
    if (!existsSync(appPidPath())) return null;
    const pid = parseInt(String(readFileSync(appPidPath(), "utf8")).trim(), 10);
    return Number.isFinite(pid) && pid > 0 ? pid : null;
  } catch {
    return null;
  }
}

export async function shutdownForUpdate() {
  if (shutdownForUpdateFn) {
    await shutdownForUpdateFn();
    return;
  }
  clearAppPid();
}

export function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function isProcessAlive(pid) {
  if (!pid || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

export async function waitForProcessExit(pid, timeoutMs = 60000) {
  if (!pid) return true;
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (!isProcessAlive(pid)) return true;
    await sleep(500);
  }
  return !isProcessAlive(pid);
}
