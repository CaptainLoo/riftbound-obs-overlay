#!/usr/bin/env node
/**
 * Shared helpers for Windows release / patch builds.
 */
import { createHash } from "node:crypto";
import { createReadStream, cpSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { getVersion, readPackageJson } from "../server/version.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

export { ROOT, getVersion, readPackageJson };

export function getUpdateRepo() {
  const pkg = readPackageJson();
  if (process.env.RIFTBOUND_UPDATE_REPO?.trim()) {
    return process.env.RIFTBOUND_UPDATE_REPO.trim();
  }
  if (pkg.riftbound?.updateRepo && !String(pkg.riftbound.updateRepo).includes("REPLACE")) {
    return pkg.riftbound.updateRepo;
  }
  const url = pkg.repository?.url || "";
  const m = url.match(/github\.com[/:]([^/]+\/[^/.]+)/i);
  if (m) return m[1].replace(/\.git$/, "");
  return null;
}

export function copyAppFiles(outDir) {
  cpSync(join(ROOT, "server"), join(outDir, "server"), { recursive: true });
  cpSync(join(ROOT, "public"), join(outDir, "public"), { recursive: true });
  cpSync(join(ROOT, "package.json"), join(outDir, "package.json"));
  cpSync(join(ROOT, "package-lock.json"), join(outDir, "package-lock.json"));
  cpSync(
    join(ROOT, "streamdeck", "com.riftbound.obs.sdPlugin"),
    join(outDir, "streamdeck-plugin", "com.riftbound.obs.sdPlugin"),
    { recursive: true }
  );
}

export function writeWindowsBats(outDir) {
  writeFileSync(
    join(outDir, "Start Riftbound.bat"),
    `@echo off
title Riftbound OBS Overlay
cd /d "%~dp0"
set RIFTBOUND_PORTABLE=1
echo Starting Riftbound OBS Overlay...
echo Control panel: http://localhost:7474/control
echo Overlay URL:   http://localhost:7474/overlay
echo.
echo Keep this window open while streaming. Close it to stop the server.
echo.
node\\node.exe server\\index.js
if errorlevel 1 pause
`,
    "utf8"
  );

  writeFileSync(
    join(outDir, "Update Riftbound.bat"),
    `@echo off
title Riftbound OBS — Update
cd /d "%~dp0"
echo Applying update...
node\\node.exe server\\update-apply.js
if errorlevel 1 (
  echo Update failed.
  pause
  exit /b 1
)
`,
    "utf8"
  );

  writeFileSync(
    join(outDir, "Install Stream Deck plugin.bat"),
    `@echo off
title Install Riftbound Stream Deck plugin
set DEST=%APPDATA%\\Elgato\\StreamDeck\\Plugins\\com.riftbound.obs.sdPlugin
echo Installing to %DEST%
if exist "%DEST%" rmdir /S /Q "%DEST%"
xcopy /E /I /Y "%~dp0streamdeck-plugin\\com.riftbound.obs.sdPlugin" "%DEST%\\"
if not exist "%DEST%\\manifest.json" (
  echo.
  echo ERROR: Plugin install failed.
  pause
  exit /b 1
)
echo.
echo OK! Now QUIT Stream Deck completely ^(tray icon - Quit^), then reopen it.
pause
`,
    "utf8"
  );

  writeFileSync(
    join(outDir, "Import Stream Deck profile.bat"),
    `@echo off
title Import Riftbound Stream Deck profile
if not "%~1"=="" (set "PROFILE=%~1") else (set "PROFILE=%~dp0Riftbound-OBS.streamDeckProfile")
if not exist "%PROFILE%" (
  echo Put Riftbound-OBS.streamDeckProfile in this folder, or drag it onto this script.
  pause
  exit /b 1
)
echo Quit Stream Deck first ^(tray - Quit^). Press any key...
pause >nul
if exist "%APPDATA%\\Elgato\\StreamDeck\\ProfilesV3\\" (set "DEST=%APPDATA%\\Elgato\\StreamDeck\\ProfilesV3") else (set "DEST=%APPDATA%\\Elgato\\StreamDeck\\ProfilesV2")
set "TMP=%TEMP%\\riftbound-sd-import"
if exist "%TMP%" rmdir /S /Q "%TMP%"
mkdir "%TMP%"
copy /Y "%PROFILE%" "%TMP%\\profile.zip" >nul
powershell -NoProfile -Command "Expand-Archive -LiteralPath '%TMP%\\profile.zip' -DestinationPath '%TMP%\\extract' -Force"
xcopy /E /I /Y "%TMP%\\extract\\*" "%DEST%\\"
rmdir /S /Q "%TMP%"
echo Done. Restart Stream Deck, select device on the left, profile "Riftbound OBS" at top.
pause
`,
    "utf8"
  );
}

export function sha256File(filePath) {
  return new Promise((resolve, reject) => {
    const hash = createHash("sha256");
    const stream = createReadStream(filePath);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("error", reject);
    stream.on("end", () => resolve(hash.digest("hex")));
  });
}

export function compareSemver(a, b) {
  const pa = String(a).split(".").map((n) => parseInt(n, 10) || 0);
  const pb = String(b).split(".").map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < 3; i++) {
    const da = pa[i] || 0;
    const db = pb[i] || 0;
    if (da > db) return 1;
    if (da < db) return -1;
  }
  return 0;
}

export function bumpVersion(part = "patch") {
  const pkg = readPackageJson();
  const [major, minor, patch] = pkg.version.split(".").map((n) => parseInt(n, 10) || 0);
  let next;
  if (part === "major") next = `${major + 1}.0.0`;
  else if (part === "minor") next = `${major}.${minor + 1}.0`;
  else next = `${major}.${minor}.${patch + 1}`;
  pkg.version = next;
  writeFileSync(join(ROOT, "package.json"), `${JSON.stringify(pkg, null, 2)}\n`, "utf8");
  return next;
}
