#!/usr/bin/env node
/**
 * Install the Riftbound OBS Stream Deck plugin (symlink or copy).
 */
import { cpSync, existsSync, mkdirSync, rmSync } from "node:fs";
import { homedir, platform } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { execSync } from "node:child_process";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const PLUGIN_SRC = join(ROOT, "streamdeck", "com.riftbound.obs.sdPlugin");
const PLUGIN_NAME = "com.riftbound.obs.sdPlugin";

function pluginsDir() {
  if (platform() === "win32") {
    const appData = process.env.APPDATA || join(homedir(), "AppData", "Roaming");
    return join(appData, "Elgato", "StreamDeck", "Plugins");
  }
  return join(homedir(), "Library", "Application Support", "com.elgato.StreamDeck", "Plugins");
}

console.log("Building Stream Deck plugin…");
execSync("npm run icons && npm run build", { cwd: join(ROOT, "streamdeck"), stdio: "inherit" });

const destDir = pluginsDir();
const dest = join(destDir, PLUGIN_NAME);
mkdirSync(destDir, { recursive: true });

if (existsSync(dest)) rmSync(dest, { recursive: true, force: true });
cpSync(PLUGIN_SRC, dest, { recursive: true });

console.log(`\nInstalled: ${dest}`);
console.log("\nNext steps:");
console.log("  1. Quit and reopen the Stream Deck app (or restart it).");
console.log("  2. In Riftbound control panel → Stream Deck → Download profile.");
console.log("  3. Double-click the .streamDeckProfile file to import.\n");
