import { existsSync } from "node:fs";
import { join } from "node:path";

const APP_EXE_NAME = "Riftbound OBS.exe";

/** Where patch files (server/, public/) should be applied. */
export function resolvePatchTargetRoot(installRoot) {
  const normalized = installRoot.replace(/[\\/]+$/, "");
  const electronContent = join(normalized, "resources", "riftbound");
  if (existsSync(join(electronContent, "server"))) return electronContent;
  return normalized;
}

export function findBootstrapScript(installRoot) {
  const normalized = installRoot.replace(/[\\/]+$/, "");
  const bootstrap = join(normalized, "resources", "updater", "bootstrap.js");
  if (existsSync(bootstrap)) return bootstrap;
  return null;
}

function findAppLauncher(installRoot) {
  const normalized = installRoot.replace(/[\\/]+$/, "");
  const exe = join(normalized, APP_EXE_NAME);
  if (existsSync(exe)) return { kind: "exe", path: exe };
  const bat = join(normalized, "Start Riftbound.bat");
  if (existsSync(bat)) return { kind: "bat", path: bat };
  return null;
}

export function spawnAppLauncher(installRoot, { spawnFn, cwd }) {
  const launcher = findAppLauncher(installRoot);
  if (!launcher) return false;
  if (launcher.kind === "exe") {
    spawnFn("cmd.exe", ["/c", "start", "Riftbound OBS", launcher.path], {
      detached: true,
      stdio: "ignore",
      cwd: cwd || installRoot,
      windowsHide: false,
    }).unref();
    return true;
  }
  spawnFn("cmd.exe", ["/c", "start", "Riftbound OBS", "/D", installRoot, launcher.path], {
    detached: true,
    stdio: "ignore",
    windowsHide: false,
  }).unref();
  return true;
}

/**
 * Spawn the stable updater bootstrap (Electron) or Update Riftbound.bat (portable).
 * Uses Node spawn with env — no fragile cmd.exe SET chains.
 */
export function spawnUpdateApply(installRoot, { spawnFn, isElectron = false, parentPid = null }) {
  const normalized = installRoot.replace(/[\\/]+$/, "");
  const exe = join(normalized, APP_EXE_NAME);

  if (isElectron) {
    const bootstrap = findBootstrapScript(normalized);
    if (!existsSync(exe)) {
      return { ok: false, error: `${APP_EXE_NAME} not found in ${normalized}` };
    }
    if (!bootstrap) {
      return {
        ok: false,
        error: "Updater bootstrap not found (resources/updater/bootstrap.js). Reinstall the app.",
      };
    }

    const env = {
      ...process.env,
      ELECTRON_RUN_AS_NODE: "1",
      RIFTBOUND_ELECTRON: "1",
      RIFTBOUND_INSTALL_ROOT: normalized,
    };
    if (parentPid) env.RIFTBOUND_UPDATE_PARENT_PID = String(parentPid);

    const child = spawnFn(exe, [bootstrap], {
      detached: true,
      stdio: "ignore",
      cwd: normalized,
      env,
      windowsHide: false,
    });
    child.unref();
    return { ok: true, pid: child.pid };
  }

  const updateBat = join(normalized, "Update Riftbound.bat");
  if (!existsSync(updateBat)) {
    return { ok: false, error: "Update Riftbound.bat not found in install folder." };
  }
  spawnFn("cmd.exe", ["/c", "start", "Riftbound Update", updateBat], {
    detached: true,
    stdio: "ignore",
    cwd: normalized,
    windowsHide: false,
  }).unref();
  return { ok: true };
}
