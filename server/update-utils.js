import { createHash, randomBytes } from "node:crypto";
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { createReadStream } from "node:fs";
import { join } from "node:path";
import { DATA_DIR } from "./paths.js";

const LOCK_STALE_MS = 10 * 60 * 1000;

let applyToken = null;

export function updatesDir() {
  return join(DATA_DIR, "updates");
}

export function pendingPath() {
  return join(updatesDir(), "pending.json");
}

export function lockPath() {
  return join(updatesDir(), "apply.lock");
}

export function progressPath() {
  return join(updatesDir(), "download-progress.json");
}

export function logPath() {
  return join(updatesDir(), "update.log");
}

export function log(message) {
  const line = `[${new Date().toISOString()}] ${message}`;
  console.log(line);
  try {
    mkdirSync(updatesDir(), { recursive: true });
    appendFileSync(logPath(), `${line}\n`, "utf8");
  } catch {
    /* ignore */
  }
}

export function mintApplyToken() {
  applyToken = randomBytes(16).toString("hex");
  return applyToken;
}

export function getApplyToken() {
  return applyToken;
}

export function verifyApplyToken(token) {
  return Boolean(applyToken && token && token === applyToken);
}

export function loadApplyTokenFromPending() {
  try {
    const data = JSON.parse(readFileSync(pendingPath(), "utf8"));
    if (data.applyToken) applyToken = data.applyToken;
  } catch {
    /* ignore */
  }
}

export function acquireLock(label) {
  mkdirSync(updatesDir(), { recursive: true });
  if (existsSync(lockPath())) {
    try {
      const data = JSON.parse(readFileSync(lockPath(), "utf8"));
      if (Date.now() - (data.at || 0) < LOCK_STALE_MS) {
        throw new Error("Update already in progress.");
      }
    } catch (err) {
      if (err.message === "Update already in progress.") throw err;
    }
    unlinkSync(lockPath());
  }
  writeFileSync(
    lockPath(),
    JSON.stringify({ pid: process.pid, label, at: Date.now() }, null, 2),
    "utf8"
  );
}

export function releaseLock() {
  try {
    if (existsSync(lockPath())) unlinkSync(lockPath());
  } catch {
    /* ignore */
  }
}

export function sha256File(filePath) {
  return new Promise((resolve, reject) => {
    const hash = createHash("sha256");
    createReadStream(filePath)
      .on("data", (chunk) => hash.update(chunk))
      .on("error", reject)
      .on("end", () => resolve(hash.digest("hex")));
  });
}

export function writeDownloadProgress(data) {
  mkdirSync(updatesDir(), { recursive: true });
  writeFileSync(progressPath(), JSON.stringify(data, null, 2), "utf8");
}

export function readDownloadProgress() {
  if (!existsSync(progressPath())) return null;
  try {
    return JSON.parse(readFileSync(progressPath(), "utf8"));
  } catch {
    return null;
  }
}

export function clearDownloadProgress() {
  try {
    if (existsSync(progressPath())) unlinkSync(progressPath());
  } catch {
    /* ignore */
  }
}

export function isLocalRequest(req) {
  const ip = String(req.ip || req.socket?.remoteAddress || "");
  return (
    ip === "127.0.0.1" ||
    ip === "::1" ||
    ip === "::ffff:127.0.0.1" ||
    ip.endsWith("127.0.0.1")
  );
}
