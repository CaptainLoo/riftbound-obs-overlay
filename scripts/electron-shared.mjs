#!/usr/bin/env node
/**
 * Stage patchable app resources for Electron extraResources.
 *   dist/electron-staging/riftbound/
 */
import { execSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { ROOT, copyAppFiles } from "./release-shared.mjs";

export const ELECTRON_STAGING = join(ROOT, "dist", "electron-staging", "riftbound");

export function prepareElectronResources() {
  rmSync(ELECTRON_STAGING, { recursive: true, force: true });
  mkdirSync(ELECTRON_STAGING, { recursive: true });

  copyAppFiles(ELECTRON_STAGING);
  execSync("npm ci --omit=dev", { cwd: ELECTRON_STAGING, stdio: "inherit" });

  const electronVer = JSON.parse(
    readFileSync(join(ROOT, "node_modules", "electron", "package.json"), "utf8")
  ).version;
  execSync(
    `npx electron-rebuild --project "${ELECTRON_STAGING}" --force --only sharp,node-hid --version ${electronVer}`,
    { cwd: ROOT, stdio: "inherit" }
  );

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
