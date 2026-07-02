#!/usr/bin/env node
/**
 * Bump version, build patch + full Windows release + installer, publish to GitHub Releases.
 */
import { execSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  ROOT,
  bumpVersion,
  getManifestNodeVersion,
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
if (process.platform === "win32") {
  execSync("npm run build:win", {
    cwd: ROOT,
    stdio: "inherit",
    env: { ...process.env, SKIP_STREAMDECK_BUILD: "1" },
  });
} else {
  console.log("Skipping full Windows Electron build on non-Windows host — CI builds after tag push.\n");
}

// Installer (.exe) and portable zip are built on GitHub Actions (Windows) when the release tag is pushed.

const patchZip = join(ROOT, "dist", `riftbound-obs-patch-${version}.zip`);
const fullZip = join(ROOT, "dist", "riftbound-obs-windows.zip");
const patchSha = await sha256File(patchZip);

const notesArg = args.find((a) => a.startsWith("--notes="));
const notes = notesArg ? notesArg.slice("--notes=".length) : `Release v${version}`;

const updateManifest = {
  version,
  channel: "stable",
  releasedAt: new Date().toISOString(),
  notes,
  nodeVersion: getManifestNodeVersion(),
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

const manifestPath = join(ROOT, "dist", "update-manifest.json");
writeFileSync(manifestPath, `${JSON.stringify(updateManifest, null, 2)}\n`, "utf8");

const tag = `v${version}`;
console.log(`\nCreating GitHub release ${tag} on ${repo}…`);

const assets = [`"${patchZip}"`, `"${manifestPath}"`];
if (existsSync(fullZip)) {
  assets.splice(1, 0, `"${fullZip}"`);
}

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

try {
  execSync(`git rev-parse ${tag}`, { cwd: ROOT, stdio: "ignore" });
  console.log(`Git tag ${tag} already exists.`);
} catch {
  execSync(`git tag ${tag}`, { cwd: ROOT, stdio: "inherit" });
  console.log(`Created git tag ${tag}.`);
}

try {
  execSync(`git push origin ${tag}`, { cwd: ROOT, stdio: "inherit" });
  console.log(`Pushed tag ${tag} — CI will build riftbound-setup-${version}.exe on Windows.\n`);
} catch (err) {
  console.warn(
    `\nCould not push tag ${tag}. Push it manually to trigger the installer build:\n  git push origin ${tag}\n`
  );
}

console.log(`\nPublished: https://github.com/${repo}/releases/tag/${tag}`);
console.log("Assets now: patch zip, update-manifest.json" + (existsSync(fullZip) ? ", portable zip" : ""));
console.log(`CI workflow "Release Installer" attaches riftbound-setup-${version}.exe and portable zip within a few minutes.\n`);
