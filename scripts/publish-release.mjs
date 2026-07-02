#!/usr/bin/env node
/**
 * Bump version, build patch + full Windows release + installer, publish to GitHub Releases.
 */
import { execSync } from "node:child_process";
import { existsSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  ROOT,
  bumpVersion,
  getUpdateRepo,
  getVersion,
  NODE_VERSION,
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
    'Configure package.json → riftbound.updateRepo (e.g. "yourname/riftbound-obs-overlay") before publishing.'
  );
  process.exit(1);
}

console.log("Building Stream Deck plugin…");
execSync("npm run build:streamdeck", { cwd: ROOT, stdio: "inherit" });

console.log("\nBuilding patch…");
execSync("npm run build:patch", {
  cwd: ROOT,
  stdio: "inherit",
  env: { ...process.env, SKIP_STREAMDECK_BUILD: "1" },
});

console.log("\nBuilding full Windows release…");
execSync("npm run build:win", {
  cwd: ROOT,
  stdio: "inherit",
  env: { ...process.env, SKIP_STREAMDECK_BUILD: "1" },
});

console.log("\nBuilding Windows installer…");
let hasInstaller = false;
try {
  execSync("npm run build:installer", { cwd: ROOT, stdio: "inherit" });
  hasInstaller = existsSync(join(ROOT, "dist", `riftbound-setup-${version}.exe`));
} catch {
  console.warn("\nInstaller build skipped or failed (iscc not available). Continuing without setup.exe.\n");
}

const patchZip = join(ROOT, "dist", `riftbound-obs-patch-${version}.zip`);
const fullZip = join(ROOT, "dist", "riftbound-obs-windows.zip");
const setupExe = join(ROOT, "dist", `riftbound-setup-${version}.exe`);
const patchSha = await sha256File(patchZip);

const notesArg = args.find((a) => a.startsWith("--notes="));
const notes = notesArg ? notesArg.slice("--notes=".length) : `Release v${version}`;

const updateManifest = {
  version,
  channel: "stable",
  releasedAt: new Date().toISOString(),
  notes,
  nodeVersion: NODE_VERSION,
  forceFull: false,
  minPatchFrom: "0.1.0",
  patch: {
    file: `riftbound-obs-patch-${version}.zip`,
    sha256: patchSha,
  },
  full: {
    file: "riftbound-obs-windows.zip",
  },
};

if (hasInstaller) {
  const setupSha = await sha256File(setupExe);
  updateManifest.installer = {
    file: `riftbound-setup-${version}.exe`,
    sha256: setupSha,
    size: statSync(setupExe).size,
  };
}

const manifestPath = join(ROOT, "dist", "update-manifest.json");
writeFileSync(manifestPath, `${JSON.stringify(updateManifest, null, 2)}\n`, "utf8");

const tag = `v${version}`;
console.log(`\nCreating GitHub release ${tag} on ${repo}…`);

const assets = [`"${patchZip}"`, `"${fullZip}"`];
if (hasInstaller) assets.push(`"${setupExe}"`);
assets.push(`"${manifestPath}"`);

try {
  execSync(`gh release view ${tag} --repo ${repo}`, { stdio: "ignore" });
  console.log("Release exists — uploading assets…");
  execSync(`gh release upload ${tag} ${assets.join(" ")} --repo ${repo} --clobber`, {
    stdio: "inherit",
  });
} catch {
  execSync(
    `gh release create ${tag} ${assets.join(" ")} --repo ${repo} --title "Riftbound OBS v${version}" --notes "${notes.replace(/"/g, '\\"')}"`,
    { stdio: "inherit" }
  );
}

console.log(`\nPublished: https://github.com/${repo}/releases/tag/${tag}`);
console.log("Windows users will see the update in the control panel.\n");
