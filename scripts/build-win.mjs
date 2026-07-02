#!/usr/bin/env node
/**
 * Build a portable Windows x64 release (works from macOS or Windows):
 *   dist/win/node/node.exe
 *   dist/win/server/
 *   dist/win/public/
 *   dist/win/node_modules/
 *   dist/win/Start Riftbound.bat
 */
import { execSync } from "node:child_process";
import {
  createWriteStream,
  cpSync,
  mkdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { pipeline } from "node:stream/promises";
import {
  ROOT,
  copyAppFiles,
  getVersion,
  NODE_VERSION,
  sha256File,
  writeWindowsBats,
} from "./release-shared.mjs";

const OUT = join(ROOT, "dist", "win");
const NODE_ZIP = `node-v${NODE_VERSION}-win-x64.zip`;
const NODE_URL = `https://nodejs.org/dist/v${NODE_VERSION}/${NODE_ZIP}`;

async function download(url, dest) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Download failed (${res.status}): ${url}`);
  await pipeline(res.body, createWriteStream(dest));
}

console.log(`Building portable Windows release v${getVersion()}…\n`);

rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });

const zipPath = join(OUT, NODE_ZIP);
console.log(`Downloading Node.js ${NODE_VERSION} for Windows…`);
await download(NODE_URL, zipPath);

console.log("Extracting Node.js…");
execSync(`unzip -q "${zipPath}" -d "${OUT}"`, { stdio: "inherit" });
rmSync(zipPath);
cpSync(join(OUT, `node-v${NODE_VERSION}-win-x64`), join(OUT, "node"), {
  recursive: true,
});
rmSync(join(OUT, `node-v${NODE_VERSION}-win-x64`), { recursive: true, force: true });

console.log("Copying application…");
if (!process.env.SKIP_STREAMDECK_BUILD) {
  execSync("npm run build:streamdeck", { cwd: ROOT, stdio: "inherit" });
}
copyAppFiles(OUT);
writeWindowsBats(OUT, { installMode: "portable" });

console.log("Installing production dependencies…");
execSync("npm ci --omit=dev", { cwd: OUT, stdio: "inherit" });

writeFileSync(
  join(OUT, "README.txt"),
  `Riftbound OBS Overlay — Windows
================================

1. Extract this entire folder anywhere on your PC.
2. Double-click "Start Riftbound.bat".
3. The control panel opens in your browser automatically.
4. In OBS, add a Browser Source:
   URL: http://localhost:7474/overlay
   Size: 1920 x 1080 (or your canvas resolution)

Updates (after first install):
- Open the control panel — a banner appears when an update is available.
- Click Download, then Install & restart (~1 MB patch, not the full zip).

Stream Deck (optional):
1. Plugin is auto-installed with each update.
2. Download/import profile from the control panel Stream Deck tab.

IMPORTANT: Keep all files together (node, server, public, node_modules).

Your decks, layout and cached card images are stored in:
  %APPDATA%\\RiftboundOBS\\

Port: 7474 (set environment variable PORT to change).
`,
  "utf8"
);

const zipOut = join(ROOT, "dist", "riftbound-obs-windows.zip");
try {
  rmSync(zipOut, { force: true });
  execSync(`cd "${join(ROOT, "dist")}" && zip -r -q riftbound-obs-windows.zip win`, {
    stdio: "inherit",
  });
  console.log(`\nZip: ${zipOut}`);
} catch {
  console.log("\n(zip skipped — install `zip` or compress the folder manually)");
}

console.log(`\nDone! Release folder: ${OUT}\n`);
