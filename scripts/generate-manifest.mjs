#!/usr/bin/env node
/**
 * Generate update-manifest.json from dist build outputs (CI helper).
 */
import { existsSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { getVersion, NODE_VERSION, ROOT, sha256File } from "./release-shared.mjs";

const version = process.env.RELEASE_VERSION || getVersion();
const patchZip = join(ROOT, "dist", `riftbound-obs-patch-${version}.zip`);
const setupExe = join(ROOT, "dist", `riftbound-setup-${version}.exe`);

if (!existsSync(patchZip)) {
  console.error("Patch zip not found:", patchZip);
  process.exit(1);
}

const manifest = {
  version,
  channel: "stable",
  releasedAt: new Date().toISOString(),
  notes: process.env.RELEASE_NOTES || `Release v${version}`,
  nodeVersion: NODE_VERSION,
  forceFull: false,
  minPatchFrom: "0.1.0",
  patch: {
    file: `riftbound-obs-patch-${version}.zip`,
    sha256: await sha256File(patchZip),
  },
  full: {
    file: "riftbound-obs-windows.zip",
  },
};

if (existsSync(setupExe)) {
  manifest.installer = {
    file: `riftbound-setup-${version}.exe`,
    sha256: await sha256File(setupExe),
    size: statSync(setupExe).size,
  };
}

const out = join(ROOT, "dist", "update-manifest.json");
writeFileSync(out, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
console.log("Wrote", out);
