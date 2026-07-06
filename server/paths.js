import { existsSync, mkdirSync } from "node:fs";
import { homedir, platform } from "node:os";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/** True when running inside a pkg binary. */
export const IS_PKG = Boolean(process.pkg);
/** True when launched via the portable Windows `Start Riftbound.bat`. */
export const IS_PORTABLE = process.env.RIFTBOUND_PORTABLE === "1";
/** True when launched via the Inno Setup installer shortcut. */
export const IS_INSTALLER = process.env.RIFTBOUND_INSTALLER === "1";
/** True when launched via the Electron desktop shell. */
export const IS_ELECTRON = process.env.RIFTBOUND_ELECTRON === "1";
/** Packaged exe or portable folder (not dev `npm start`). */
export const IS_RELEASE = IS_PKG || IS_PORTABLE || IS_INSTALLER || IS_ELECTRON;

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

/** Install folder (exe dir on Electron, cwd for portable). */
export function getInstallRoot() {
  if (IS_ELECTRON && process.env.RIFTBOUND_INSTALL_ROOT) {
    return process.env.RIFTBOUND_INSTALL_ROOT.replace(/[\\/]+$/, "");
  }
  if (IS_ELECTRON && process.env.RIFTBOUND_DEV === "1") {
    return DEV_ROOT;
  }
  if (IS_ELECTRON) {
    return dirname(process.execPath);
  }
  if (IS_PKG) return dirname(process.execPath);
  if (IS_RELEASE) return process.cwd();
  return DEV_ROOT;
}

/** Patchable app content (server, public, package.json). */
export function getContentRoot() {
  if (process.env.RIFTBOUND_CONTENT_ROOT) {
    const explicit = process.env.RIFTBOUND_CONTENT_ROOT.replace(/[\\/]+$/, "");
    if (existsSync(join(explicit, "server"))) return explicit;
  }
  if (IS_ELECTRON && process.env.RIFTBOUND_DEV === "1") {
    return DEV_ROOT;
  }
  if (IS_ELECTRON) {
    const bundled = join(process.resourcesPath, "riftbound");
    if (existsSync(join(bundled, "server"))) return bundled;
  }
  if (IS_PKG) {
    const external = join(dirname(process.execPath), "server");
    if (existsSync(external)) return dirname(process.execPath);
    return join(__dirname, "..");
  }
  if (IS_RELEASE) return process.cwd();
  return DEV_ROOT;
}

function resolvePublicDir(root) {
  return join(root, "public");
}

export const ROOT_DIR = getContentRoot();
export const PUBLIC_DIR = resolvePublicDir(ROOT_DIR);
export const DATA_DIR = IS_RELEASE ? userDataDir() : join(DEV_ROOT, "data");
/** @deprecated Prefer getCardsDir(gameId) for per-game card storage. */
export const CARDS_DIR = join(DATA_DIR, "cards");
export const DB_FILE = join(DATA_DIR, "db.json");

export function ensureCardsRoot() {
  mkdirSync(join(DATA_DIR, "cards"), { recursive: true });
}

/** Per-game card image directory (e.g. data/cards/riftbound). */
export function getCardsDir(gameId = "riftbound") {
  return join(DATA_DIR, "cards", gameId);
}
