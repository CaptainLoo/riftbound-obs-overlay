#!/usr/bin/env node
/**
 * Stage patchable app resources for Electron extraResources.
 *   dist/electron-staging/riftbound/
 */
import { execSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { ROOT, copyAppFiles } from "./release-shared.mjs";

export const ELECTRON_STAGING = join(ROOT, "dist", "electron-staging", "riftbound");

export function prepareElectronResources({ skipStreamDeck = false } = {}) {
  rmSync(ELECTRON_STAGING, { recursive: true, force: true });
  mkdirSync(ELECTRON_STAGING, { recursive: true });

  if (!skipStreamDeck) {
    execSync("npm run build:streamdeck", { cwd: ROOT, stdio: "inherit" });
  }

  copyAppFiles(ELECTRON_STAGING);
  execSync("npm ci --omit=dev", { cwd: ELECTRON_STAGING, stdio: "inherit" });

  return ELECTRON_STAGING;
}

export function contentRootForInstall(installRoot) {
  const electronContent = join(installRoot, "resources", "riftbound");
  if (existsSync(join(electronContent, "server"))) return electronContent;
  return installRoot;
}

export const APP_EXE_NAME = "Riftbound OBS.exe";

export function findAppLauncher(installRoot) {
  const exe = join(installRoot, APP_EXE_NAME);
  if (existsSync(exe)) return exe;
  const bat = join(installRoot, "Start Riftbound.bat");
  if (existsSync(bat)) return bat;
  return null;
}
