#!/usr/bin/env node
/**
 * Build Windows Electron app (portable folder + NSIS installer).
 */
import { execSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { ROOT, getVersion, writeWindowsBats } from "./release-shared.mjs";
import { APP_EXE_NAME, ELECTRON_STAGING, prepareElectronResources } from "./electron-shared.mjs";

const version = getVersion();

console.log(`Building Electron Windows release v${version}…\n`);

if (!process.env.SKIP_STREAMDECK_BUILD) {
  prepareElectronResources();
} else {
  prepareElectronResources({ skipStreamDeck: true });
}

const winUnpacked = join(ROOT, "dist", "electron", "win-unpacked");
mkdirSync(join(ROOT, "dist", "electron"), { recursive: true });

execSync("npx electron-builder --win --publish never", {
  cwd: ROOT,
  stdio: "inherit",
  env: { ...process.env, npm_config_electron_builder_bin: "electron-builder" },
});

if (!existsSync(join(winUnpacked, APP_EXE_NAME))) {
  console.error(`Expected ${APP_EXE_NAME} not found in ${winUnpacked}`);
  process.exit(1);
}

writeWindowsBats(winUnpacked, { installMode: "electron" });
cpSync(
  join(ROOT, "electron", "icon.png"),
  join(winUnpacked, "resources", "icon.png"),
  { force: true }
);

const legacyWin = join(ROOT, "dist", "win");
rmSync(legacyWin, { recursive: true, force: true });
cpSync(winUnpacked, legacyWin, { recursive: true });

const setupInElectron = join(ROOT, "dist", "electron", `riftbound-setup-${version}.exe`);
const setupOut = join(ROOT, "dist", `riftbound-setup-${version}.exe`);
if (existsSync(setupInElectron)) {
  cpSync(setupInElectron, setupOut, { force: true });
  console.log(`\nInstaller copied → ${setupOut}`);
}

const zipOut = join(ROOT, "dist", "riftbound-obs-windows.zip");
try {
  rmSync(zipOut, { force: true });
  if (process.platform === "win32") {
    const winDir = join(ROOT, "dist", "win");
    execSync(
      `powershell -NoProfile -Command "Compress-Archive -LiteralPath '${winDir.replace(/'/g, "''")}' -DestinationPath '${zipOut.replace(/'/g, "''")}' -Force"`,
      { stdio: "inherit" }
    );
  } else {
    execSync(`cd "${join(ROOT, "dist")}" && zip -r -q riftbound-obs-windows.zip win`, {
      stdio: "inherit",
    });
  }
  console.log(`\nZip: ${zipOut}`);
} catch (err) {
  console.log(`\n(zip skipped — ${err.message || "compress manually"})`);
}

console.log(`\nPortable: ${winUnpacked}`);
console.log(`Installer: ${existsSync(setupOut) ? setupOut : setupInElectron}`);
console.log(`Legacy alias: ${legacyWin}\n`);
