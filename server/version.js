import { execSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { ROOT_DIR } from "./paths.js";

export function readPackageJson() {
  return JSON.parse(readFileSync(join(ROOT_DIR, "package.json"), "utf8"));
}

export function getVersion() {
  return readPackageJson().version;
}

/** GitHub `owner/repo` slug for update checks. */
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

/** Compare semver: 1 if a>b, -1 if a<b, 0 if equal. */
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

/** Bundled Node version in Windows release (null if not bundled). */
export function getBundledNodeVersion() {
  const nodeExe = join(ROOT_DIR, "node", "node.exe");
  if (!existsSync(nodeExe)) return null;
  try {
    const out = execSync(`"${nodeExe}" -v`, { encoding: "utf8" }).trim();
    return out.replace(/^v/, "");
  } catch {
    return null;
  }
}
