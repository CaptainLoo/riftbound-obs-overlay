#!/usr/bin/env node
/**
 * Bump version, build patch + full Windows release, publish to GitHub Releases.
 *
 * Prerequisites:
 *   gh auth login
 *   Set package.json → riftbound.updateRepo to "owner/repo"
 *
 * Usage:
 *   npm run publish              # patch bump
 *   npm run publish -- minor     # minor bump
 *   npm run publish -- --no-bump # use current version
 */
import { execSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  ROOT,
  bumpVersion,
  getUpdateRepo,
  getVersion,
  sha256File,
} from "./release-shared.mjs";

const args = process.argv.slice(2);
const noBump = args.includes("--no-bump");
const bumpPart = args.find((a) => ["major", "minor", "patch"].includes(a)) || "patch";

if (!noBump) {
  const next = bumpVersion(bumpPart);
  console.log(`Version bumped → ${next}\n`);
}

const version = getVersion();
const repo = getUpdateRepo();
if (!repo || repo.includes("REPLACE")) {
  console.error(
    "Configure package.json → riftbound.updateRepo (e.g. \"yourname/riftbound-obs-overlay\") before publishing."
  );
  process.exit(1);
}

console.log("Building patch…");
execSync("npm run build:patch", { cwd: ROOT, stdio: "inherit" });

console.log("\nBuilding full Windows release…");
execSync("npm run build:win", { cwd: ROOT, stdio: "inherit" });

const patchZip = join(ROOT, "dist", `riftbound-obs-patch-${version}.zip`);
const fullZip = join(ROOT, "dist", "riftbound-obs-windows.zip");
const patchSha = await sha256File(patchZip);

const notesArg = args.find((a) => a.startsWith("--notes="));
const notes = notesArg ? notesArg.slice("--notes=".length) : `Release v${version}`;

const updateManifest = {
  version,
  releasedAt: new Date().toISOString(),
  notes,
  patch: {
    file: `riftbound-obs-patch-${version}.zip`,
    sha256: patchSha,
  },
  full: {
    file: "riftbound-obs-windows.zip",
  },
};

const manifestPath = join(ROOT, "dist", "update-manifest.json");
writeFileSync(manifestPath, `${JSON.stringify(updateManifest, null, 2)}\n`, "utf8");

const tag = `v${version}`;
console.log(`\nCreating GitHub release ${tag} on ${repo}…`);

try {
  execSync(`gh release view ${tag} --repo ${repo}`, { stdio: "ignore" });
  console.log("Release exists — uploading assets…");
  execSync(
    `gh release upload ${tag} "${patchZip}" "${fullZip}" "${manifestPath}" --repo ${repo} --clobber`,
    { stdio: "inherit" }
  );
} catch {
  execSync(
    `gh release create ${tag} "${patchZip}" "${fullZip}" "${manifestPath}" --repo ${repo} --title "Riftbound OBS v${version}" --notes "${notes.replace(/"/g, '\\"')}"`,
    { stdio: "inherit" }
  );
}

console.log(`\nPublished: https://github.com/${repo}/releases/tag/${tag}`);
console.log("Windows users will see the update in the control panel.\n");
