#!/usr/bin/env node
/**
 * Shared helpers for Windows release / patch builds.
 */
import { createHash } from "node:crypto";
import { createReadStream, cpSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { getVersion, readPackageJson } from "../server/version.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

export { ROOT, getVersion, readPackageJson };

export const NODE_VERSION = "20.18.0";
export const INNO_APP_ID = "A1B2C3D4-E5F6-7890-ABCD-EF1234567890";
export const INNO_APP_NAME = "Riftbound OBS";

/** Node version bundled with Electron (for update manifest). */
export function getManifestNodeVersion() {
  const versionFile = join(ROOT, "node_modules", "electron", "dist", "version");
  if (existsSync(versionFile)) {
    try {
      const info = JSON.parse(readFileSync(versionFile, "utf8"));
      if (info.node) return String(info.node).replace(/^v/, "");
    } catch {
      /* fall through */
    }
  }
  return NODE_VERSION;
}

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
}

export function writeWindowsBats(outDir, { installMode = "portable" } = {}) {
  if (installMode === "electron") {
    writeFileSync(
      join(outDir, "Start Riftbound.bat"),
      `@echo off
title Riftbound OBS (debug launcher)
cd /d "%~dp0"
start "" "%~dp0Riftbound OBS.exe"
`,
      "utf8"
    );

    writeFileSync(
      join(outDir, "Start Riftbound (debug).bat"),
      `@echo off
title Riftbound OBS — debug
cd /d "%~dp0"
echo Log file: %APPDATA%\\RiftboundOBS\\startup.log
echo.
set ELECTRON_ENABLE_LOGGING=1
"%~dp0Riftbound OBS.exe" --enable-logging
echo.
echo Exit code: %ERRORLEVEL%
echo See log: %APPDATA%\\RiftboundOBS\\startup.log
pause
`,
      "utf8"
    );

    writeFileSync(
      join(outDir, "Update Riftbound.bat"),
      `@echo off
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
`,
      "utf8"
    );
    return;
  }

  const envFlag =
    installMode === "installer" ? "set RIFTBOUND_INSTALLER=1" : "set RIFTBOUND_PORTABLE=1";
  writeFileSync(
    join(outDir, "Start Riftbound.bat"),
    `@echo off
title Riftbound OBS Overlay
cd /d "%~dp0"
${envFlag}
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
echo Waiting for server to stop...
timeout /t 3 /nobreak >nul
echo Applying update...
node\\node.exe server\\update-router.js
if errorlevel 1 (
  echo.
  echo Update failed. Log: %APPDATA%\\RiftboundOBS\\updates\\update.log
  pause
  exit /b 1
)
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
