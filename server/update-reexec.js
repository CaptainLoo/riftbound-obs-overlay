/**
 * Re-run the updater from %APPDATA% so Electron does not lock files under resources/riftbound/server.
 */
import { spawn } from "node:child_process";
import { cpSync, existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { homedir, platform } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const UPDATE_SCRIPTS = [
  "update-router.js",
  "update-reexec.js",
  "update-apply.js",
  "update-installer.js",
  "update-utils.js",
  "launcher.js",
  "paths.js",
  "version.js",
];

function runnerDir() {
  const appData = process.env.APPDATA || join(homedir(), "AppData", "Roaming");
  return join(appData, "RiftboundOBS", "updates", "runner");
}

function isElectronContentServerDir(dir) {
  return dir.replace(/\\/g, "/").toLowerCase().includes("/resources/riftbound/server");
}

export function reexecUpdateFromRunnerIfNeeded() {
  if (process.env.RIFTBOUND_UPDATE_RUNNER === "1") return Promise.resolve(false);
  if (process.env.RIFTBOUND_ELECTRON !== "1") return Promise.resolve(false);
  if (platform() !== "win32") return Promise.resolve(false);

  const serverDir = dirname(fileURLToPath(import.meta.url));
  if (!isElectronContentServerDir(serverDir)) return Promise.resolve(false);

  const installRoot = (process.env.RIFTBOUND_INSTALL_ROOT || dirname(process.execPath)).replace(
    /[\\/]+$/,
    ""
  );
  const outDir = runnerDir();
  rmSync(outDir, { recursive: true, force: true });
  mkdirSync(outDir, { recursive: true });
  writeFileSync(join(outDir, "package.json"), '{"type":"module"}\n', "utf8");

  for (const name of UPDATE_SCRIPTS) {
    const src = join(serverDir, name);
    if (!existsSync(src)) {
      console.error(`Missing update script: ${src}`);
      process.exit(1);
    }
    cpSync(src, join(outDir, name));
  }

  const router = join(outDir, "update-router.js");
  const child = spawn(process.execPath, [router], {
    detached: true,
    stdio: "ignore",
    cwd: installRoot,
    env: {
      ...process.env,
      ELECTRON_RUN_AS_NODE: "1",
      RIFTBOUND_ELECTRON: "1",
      RIFTBOUND_INSTALL_ROOT: installRoot,
      RIFTBOUND_UPDATE_RUNNER: "1",
    },
    windowsHide: false,
  });
  child.unref();
  return Promise.resolve(true);
}
