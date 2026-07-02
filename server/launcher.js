import { existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export const APP_EXE_NAME = "Riftbound OBS.exe";

const ELECTRON_UPDATE_BAT = `@echo off
title Riftbound OBS — Update
cd /d "%~dp0"
echo Waiting for server to stop...
timeout /t 8 /nobreak >nul
set ELECTRON_RUN_AS_NODE=1
set RIFTBOUND_ELECTRON=1
set RIFTBOUND_INSTALL_ROOT=%~dp0
if exist "%~dp0resources\\updater\\bootstrap.js" (
  "%~dp0Riftbound OBS.exe" "%~dp0resources\\updater\\bootstrap.js"
) else (
  "%~dp0Riftbound OBS.exe" "%~dp0resources\\riftbound\\server\\update-router.js"
)
if errorlevel 1 (
  echo.
  echo Update failed. Log: %APPDATA%\\RiftboundOBS\\updates\\update.log
  pause
  exit /b 1
)
`;

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

/** Ensure Update Riftbound.bat exists next to the Electron exe (NSIS installs omit it). */
export function ensureElectronUpdateBat(installRoot) {
  const normalized = installRoot.replace(/[\\/]+$/, "");
  const batPath = join(normalized, "Update Riftbound.bat");
  if (existsSync(batPath)) return batPath;
  const exe = join(normalized, APP_EXE_NAME);
  if (!existsSync(exe)) return null;
  writeFileSync(batPath, ELECTRON_UPDATE_BAT, "utf8");
  return batPath;
}

export function spawnPatchUpdate(installRoot, { spawnFn, isElectron = false }) {
  const normalized = installRoot.replace(/[\\/]+$/, "");
  const updateBat = isElectron
    ? ensureElectronUpdateBat(normalized)
    : join(normalized, "Update Riftbound.bat");
  if (!updateBat || !existsSync(updateBat)) {
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
