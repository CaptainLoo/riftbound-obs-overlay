#!/usr/bin/env node
/**
 * Build Windows Electron release (portable folder + NSIS installer).
 */
import { execSync } from "node:child_process";
import { join } from "node:path";
import { ROOT } from "./release-shared.mjs";

execSync("node scripts/build-electron.mjs", {
  cwd: ROOT,
  stdio: "inherit",
  env: process.env,
});
