#!/usr/bin/env node
/**
 * Bump version, build patch + full Windows release + installer, publish to GitHub Releases.
 */
import { execSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  ROOT,
  bumpBetaVersion,
  bumpVersion,
  getManifestNodeVersion,
  getUpdateRepo,
  getVersion,
  sha256File,
} from "./release-shared.mjs";

const args = process.argv.slice(2);
const noBump = args.includes("--no-bump");
const forceFull = args.includes("--force-full");
const isBeta = args.includes("--beta");
const bumpPart = args.find((a) => ["major", "minor", "patch"].includes(a)) || "patch";

const NATIVE_PACKAGES = [
  "sharp",
  "node-hid",
  "@elgato-stream-deck/node",
  "@julusian/jpeg-turbo",
];

function readJsonFromGit(path, ref) {
  try {
    const raw = execSync(`git show ${ref}:${path}`, { cwd: ROOT, encoding: "utf8" });
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function lockVersionForPackage(lockContent, pkgName) {
  if (!lockContent) return null;
  const escaped = pkgName.replace("/", "\\/");
  const re = new RegExp(`"node_modules/${escaped}"[^}]*"version":\\s*"([^"]+)"`);
  return lockContent.match(re)?.[1] || null;
}

function detectNativeReleaseChanges() {
  let prevTag = null;
  try {
    prevTag = execSync("git describe --tags --abbrev=0 HEAD~1 2>/dev/null", {
      cwd: ROOT,
      encoding: "utf8",
    }).trim();
  } catch {
    return { electronChanged: false, nativeChanged: [], prevTag: null };
  }
  if (!prevTag) return { electronChanged: false, nativeChanged: [], prevTag: null };

  const currentPkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"));
  const prevPkg = readJsonFromGit("package.json", prevTag) || {};
  const electronKey = (pkg) => pkg.devDependencies?.electron || pkg.dependencies?.electron;
  const electronChanged = electronKey(currentPkg) !== electronKey(prevPkg);

  const currentLock = readFileSync(join(ROOT, "package-lock.json"), "utf8");
  let prevLock = "";
  try {
    prevLock = execSync(`git show ${prevTag}:package-lock.json`, { cwd: ROOT, encoding: "utf8" });
  } catch {
    prevLock = "";
  }

  const nativeChanged = NATIVE_PACKAGES.filter((pkg) => {
    const cur = lockVersionForPackage(currentLock, pkg);
    const prev = lockVersionForPackage(prevLock, pkg);
    return cur && prev && cur !== prev;
  });

  return { electronChanged, nativeChanged, prevTag };
}

if (!noBump) {
  const next = isBeta ? bumpBetaVersion() : bumpVersion(bumpPart);
  console.log(`Version bumped → ${next}${isBeta ? " (beta)" : ""}\n`);
}

const version = getVersion();
const repo = getUpdateRepo();
if (!repo || repo.includes("REPLACE")) {
  console.error(
    'Configure package.json → riftbound.updateRepo (e.g. "yourname/riftbound-obs-overlay") before publishing.'
  );
  process.exit(1);
}

const nativeChanges = detectNativeReleaseChanges();
const shouldForceFull = forceFull;

if (nativeChanges.electronChanged || nativeChanges.nativeChanged.length) {
  console.log(
    `\nNative/Electron changes since ${nativeChanges.prevTag || "previous tag"}:` +
      `${nativeChanges.electronChanged ? " electron" : ""}` +
      `${nativeChanges.nativeChanged.length ? ` ${nativeChanges.nativeChanged.join(", ")}` : ""}`
  );
}

if (!forceFull && (nativeChanges.electronChanged || nativeChanges.nativeChanged.length)) {
  console.warn(
    "\nWARNING: Electron or native dependency versions changed since the last tag.\n" +
      "Consider publishing with --force-full so users get the full installer instead of a patch.\n"
  );
} else if (forceFull) {
  console.log("\nforceFull enabled via --force-full\n");
}

console.log("\nBuilding patch…");
execSync("npm run build:patch", {
  cwd: ROOT,
  stdio: "inherit",
});

console.log("\nBuilding full Windows release…");
if (process.platform === "win32") {
  execSync("npm run build:win", {
    cwd: ROOT,
    stdio: "inherit",
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
  channel: isBeta ? "beta" : "stable",
  releasedAt: new Date().toISOString(),
  notes,
  nodeVersion: getManifestNodeVersion(),
  forceFull: shouldForceFull,
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
console.log(`Manifest forceFull: ${shouldForceFull}\n`);

if (!noBump) {
  try {
    execSync("git diff --quiet package.json", { cwd: ROOT, stdio: "ignore" });
  } catch {
    execSync(`git add package.json && git commit -m "Release ${tag}."`, {
      cwd: ROOT,
      stdio: "inherit",
    });
    execSync("git push origin HEAD", { cwd: ROOT, stdio: "inherit" });
  }
}

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
  const prereleaseFlag = isBeta ? " --prerelease" : "";
  execSync(
    `gh release create ${tag} ${assets.join(" ")} --repo ${repo} --title "Riftbound OBS v${version}" --notes "${notes.replace(/"/g, '\\"')}"${prereleaseFlag}`,
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
