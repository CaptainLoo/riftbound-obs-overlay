#!/usr/bin/env node
/**
 * Build Windows installer (.exe) from dist/win using Inno Setup.
 *   dist/riftbound-setup-VERSION.exe
 */
import { execSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import {
  ROOT,
  getVersion,
  INNO_APP_NAME,
  writeWindowsBats,
} from "./release-shared.mjs";

const version = getVersion();
const winDir = join(ROOT, "dist", "win");
const stagingDir = join(ROOT, "dist", "installer-staging");
const issPath = join(ROOT, "installer", "riftbound.iss");
const outExe = join(ROOT, "dist", `riftbound-setup-${version}.exe`);

if (!existsSync(winDir)) {
  console.error("dist/win not found. Run npm run build:win first.");
  process.exit(1);
}

console.log(`Building installer v${version}…\n`);

rmSync(stagingDir, { recursive: true, force: true });
mkdirSync(stagingDir, { recursive: true });
cpSync(winDir, stagingDir, { recursive: true });
writeWindowsBats(stagingDir, { installMode: "installer" });

const sourceDir = stagingDir.replace(/\\/g, "\\\\");
const cmd = `iscc "${issPath}" /DMyAppVersion=${version} /DSourceDir="${sourceDir}"`;

try {
  execSync(cmd, { cwd: ROOT, stdio: "inherit" });
} catch (err) {
  console.error(
    `\nInno Setup compiler (iscc) not found or build failed.\n` +
      `Install Inno Setup 6+ and ensure iscc is on PATH.\n` +
      `  https://jrsoftware.org/isinfo.php\n`
  );
  process.exit(err.status || 1);
}

if (!existsSync(outExe)) {
  console.error(`Expected output not found: ${outExe}`);
  process.exit(1);
}

console.log(`\nInstaller: ${outExe}`);
console.log(`${INNO_APP_NAME} setup ready.\n`);
