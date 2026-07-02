#!/usr/bin/env node
/**
 * Download update-manifest.json from GitHub Release and add installer SHA256/size.
 * Used by CI after building riftbound-setup-VERSION.exe.
 */
import { execSync } from "node:child_process";
import { existsSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { getUpdateRepo, ROOT, sha256File } from "./release-shared.mjs";

const tag = process.env.TAG;
const version = process.env.VERSION || tag?.replace(/^v/, "");
const repo = process.env.GITHUB_REPOSITORY || getUpdateRepo();

if (!tag || !version) {
  console.error("TAG and VERSION env vars are required.");
  process.exit(1);
}

const setupExe = join(ROOT, "dist", `riftbound-setup-${version}.exe`);
const manifestPath = join(ROOT, "dist", "update-manifest.json");

if (!existsSync(setupExe)) {
  console.error("Installer not found:", setupExe);
  process.exit(1);
}

if (process.env.GH_TOKEN || process.env.GITHUB_TOKEN) {
  execSync(
    `gh release download ${tag} --repo ${repo} --pattern update-manifest.json --dir dist`,
    { cwd: ROOT, stdio: "inherit" }
  );
}

if (!existsSync(manifestPath)) {
  console.error("update-manifest.json not found in dist/. Download from release or run generate-manifest first.");
  process.exit(1);
}

const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
manifest.installer = {
  file: `riftbound-setup-${version}.exe`,
  sha256: await sha256File(setupExe),
  size: statSync(setupExe).size,
};
manifest.releasedAt = new Date().toISOString();

writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
console.log(`Updated manifest with installer → ${manifestPath}`);
