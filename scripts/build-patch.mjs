#!/usr/bin/env node
/**
 * Build a lightweight patch zip for in-app updates (~1 MB).
 *   dist/riftbound-obs-patch-VERSION.zip
 *   dist/patch-manifest.json
 */
import { execSync } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  ROOT,
  copyAppFiles,
  getVersion,
  sha256File,
  writeWindowsBats,
} from "./release-shared.mjs";

const version = getVersion();
const staging = join(ROOT, "dist", "patch-staging");
const zipName = `riftbound-obs-patch-${version}.zip`;
const zipPath = join(ROOT, "dist", zipName);

console.log(`Building patch v${version}…\n`);

rmSync(staging, { recursive: true, force: true });
mkdirSync(staging, { recursive: true });

execSync("npm run build:streamdeck", { cwd: ROOT, stdio: "inherit" });
copyAppFiles(staging);
writeWindowsBats(staging);

rmSync(zipPath, { force: true });
execSync(`cd "${staging}" && zip -r -q "${zipPath}" .`, { stdio: "inherit" });

const sha256 = await sha256File(zipPath);
const manifest = {
  version,
  releasedAt: new Date().toISOString(),
  patch: {
    file: zipName,
    sha256,
  },
};

writeFileSync(join(ROOT, "dist", "patch-manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");

console.log(`\nPatch: ${zipPath}`);
console.log(`SHA256: ${sha256}`);
console.log(`Manifest: ${join(ROOT, "dist", "patch-manifest.json")}\n`);
