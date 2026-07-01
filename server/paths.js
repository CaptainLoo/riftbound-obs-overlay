import { existsSync } from "node:fs";
import { homedir, platform } from "node:os";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/** True when running inside a pkg binary. */
export const IS_PKG = Boolean(process.pkg);
/** True when launched via the portable Windows `Start Riftbound.bat`. */
export const IS_PORTABLE = process.env.RIFTBOUND_PORTABLE === "1";
/** Packaged exe or portable folder (not dev `npm start`). */
export const IS_RELEASE = IS_PKG || IS_PORTABLE;

const DEV_ROOT = join(__dirname, "..");

function userDataDir() {
  if (platform() === "win32") {
    const appData = process.env.APPDATA || join(homedir(), "AppData", "Roaming");
    return join(appData, "RiftboundOBS");
  }
  if (platform() === "darwin") {
    return join(homedir(), "Library", "Application Support", "RiftboundOBS");
  }
  return join(homedir(), ".config", "riftbound-obs");
}

function releaseRoot() {
  if (IS_PKG) return dirname(process.execPath);
  return process.cwd();
}

function resolvePublicDir(root) {
  if (IS_PKG) {
    const external = join(dirname(process.execPath), "public");
    if (existsSync(external)) return external;
    return join(__dirname, "..", "public");
  }
  return join(root, "public");
}

export const ROOT_DIR = IS_RELEASE ? releaseRoot() : DEV_ROOT;
export const PUBLIC_DIR = resolvePublicDir(ROOT_DIR);
export const DATA_DIR = IS_RELEASE ? userDataDir() : join(DEV_ROOT, "data");
export const CARDS_DIR = join(DATA_DIR, "cards");
export const DB_FILE = join(DATA_DIR, "db.json");
