import { existsSync } from "node:fs";
import { join } from "node:path";

export const APP_EXE_NAME = "Riftbound OBS.exe";

/** Where patch files (server/, public/) should be applied. */
export function resolvePatchTargetRoot(installRoot) {
  const normalized = installRoot.replace(/[\\/]+$/, "");
  const electronContent = join(normalized, "resources", "riftbound");
  if (existsSync(join(electronContent, "server"))) return electronContent;
  return normalized;
}

export function findAppLauncher(installRoot) {
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
