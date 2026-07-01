#!/usr/bin/env node
/**
 * One-time GitHub setup: auth check, create repo, push, optional first release.
 *
 *   node scripts/setup-github.mjs
 *   node scripts/setup-github.mjs --public
 *   node scripts/setup-github.mjs --release   # also npm run publish after push
 */
import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const isPublic = args.includes("--public");
const doRelease = args.includes("--release");

const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"));
const repo = pkg.riftbound?.updateRepo;
if (!repo || repo.includes("REPLACE")) {
  console.error("Set package.json → riftbound.updateRepo first.");
  process.exit(1);
}

function run(cmd, opts = {}) {
  console.log(`\n→ ${cmd}\n`);
  execSync(cmd, { cwd: ROOT, stdio: "inherit", ...opts });
}

function runCapture(cmd) {
  return execSync(cmd, { cwd: ROOT, encoding: "utf8" }).trim();
}

try {
  runCapture("gh auth status");
} catch {
  console.log(`
GitHub CLI is not logged in.

Run this once in your terminal (opens the browser):

  gh auth login --web --git-protocol https --scopes repo,read:org

Then re-run:

  node scripts/setup-github.mjs${isPublic ? " --public" : ""}${doRelease ? " --release" : ""}
`);
  process.exit(1);
}

const remoteUrl = `https://github.com/${repo}.git`;

try {
  const existing = runCapture(`gh repo view ${repo} --json name -q .name 2>/dev/null || true`);
  if (existing) {
    console.log(`Repository ${repo} already exists.`);
  }
} catch {
  /* create below */
}

try {
  runCapture(`gh repo view ${repo} --json name -q .name`);
} catch {
  run(`gh repo create ${repo} --${isPublic ? "public" : "private"} --source=. --remote=origin --description="Riftbound OBS overlay with Stream Deck integration"`);
}

try {
  const remotes = runCapture("git remote");
  if (!remotes.includes("origin")) {
    run(`git remote add origin ${remoteUrl}`);
  } else {
    run(`git remote set-url origin ${remoteUrl}`);
  }
} catch {
  run(`git remote add origin ${remoteUrl}`);
}

const branch = runCapture("git branch --show-current") || "main";
run(`git push -u origin ${branch}`);

console.log(`\n✓ GitHub configured: https://github.com/${repo}`);

if (doRelease) {
  console.log("\nPublishing first release…");
  run("npm run publish -- --no-bump");
} else {
  console.log(`
Next steps:
  npm run publish     # push an update release (after code changes)
  Windows PC          # control panel → Download → Install & restart
`);
}
