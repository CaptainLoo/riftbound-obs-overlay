/**
 * Apply a downloaded patch on Windows (called by Update Riftbound.bat after server exit).
 */
import { spawn, execSync } from "node:child_process";
import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { homedir, platform } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import {
  acquireLock,
  log,
  logPath,
  pendingPath,
  releaseLock,
  sha256File,
  updatesDir,
} from "./update-utils.js";

function normalizePath(p) {
  if (!p || typeof p !== "string") return process.cwd();
  return p.replace(/^["']+|["']+$/g, "").replace(/[\\/]+$/, "");
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function expandZip(zipPath, destDir) {
  if (platform() !== "win32") {
    execSync(`unzip -q -o "${zipPath}" -d "${destDir}"`, { stdio: "inherit" });
    return;
  }
  mkdirSync(destDir, { recursive: true });
  execSync(
    `powershell -NoProfile -Command "Expand-Archive -LiteralPath '${zipPath.replace(/'/g, "''")}' -DestinationPath '${destDir.replace(/'/g, "''")}' -Force"`,
    { stdio: "inherit" }
  );
}

function installStreamDeckPlugin(installRootDir) {
  const src = join(installRootDir, "streamdeck-plugin", "com.riftbound.obs.sdPlugin");
  if (!existsSync(src)) {
    log("No streamdeck-plugin in patch — skipping.");
    return;
  }
  const appData = process.env.APPDATA || join(homedir(), "AppData", "Roaming");
  const dest = join(appData, "Elgato", "StreamDeck", "Plugins", "com.riftbound.obs.sdPlugin");
  rmSync(dest, { recursive: true, force: true });
  cpSync(src, dest, { recursive: true });
  log(`Stream Deck plugin installed → ${dest}`);
}

function runNpmCi(installRootDir) {
  const nodeExe = join(installRootDir, "node", "node.exe");
  if (!existsSync(nodeExe)) {
    log("Bundled node not found — skipping npm ci.");
    return;
  }
  const npmCli = join(installRootDir, "node_modules", "npm", "bin", "npm-cli.js");
  if (existsSync(npmCli)) {
    execSync(`"${nodeExe}" "${npmCli}" ci --omit=dev`, { cwd: installRootDir, stdio: "inherit" });
    return;
  }
  execSync(`"${nodeExe}" -e "require('child_process').execSync('npm ci --omit=dev',{stdio:'inherit'})"`, {
    cwd: installRootDir,
    stdio: "inherit",
    shell: true,
  });
}

async function renameWithRetry(from, to, attempts = 8) {
  let lastErr;
  for (let i = 0; i < attempts; i++) {
    try {
      if (existsSync(to)) rmSync(to, { recursive: true, force: true });
      renameSync(from, to);
      return;
    } catch (err) {
      lastErr = err;
      log(`Rename retry ${i + 1}/${attempts} ${from} → ${to}: ${err.message}`);
      if (i < attempts - 1) await sleep(1000);
    }
  }
  throw lastErr;
}

async function swapPath(stagingPath, targetPath, backupRoot) {
  if (!existsSync(stagingPath)) return;
  mkdirSync(backupRoot, { recursive: true });
  const backupPath = join(backupRoot, stagingPath.split(/[\\/]/).pop());
  if (existsSync(targetPath)) {
    await renameWithRetry(targetPath, backupPath);
  }
  try {
    await renameWithRetry(stagingPath, targetPath);
  } catch (err) {
    if (existsSync(backupPath)) {
      await renameWithRetry(backupPath, targetPath);
    }
    throw err;
  }
  rmSync(backupPath, { recursive: true, force: true });
}

async function swapFile(stagingPath, targetPath, backupRoot) {
  if (!existsSync(stagingPath)) return;
  mkdirSync(backupRoot, { recursive: true });
  const backupPath = join(backupRoot, stagingPath.split(/[\\/]/).pop());
  if (existsSync(targetPath)) {
    await renameWithRetry(targetPath, backupPath);
  }
  try {
    await renameWithRetry(stagingPath, targetPath);
  } catch (err) {
    if (existsSync(backupPath)) {
      await renameWithRetry(backupPath, targetPath);
    }
    throw err;
  }
  try {
    rmSync(backupPath, { force: true });
  } catch {
    /* ignore */
  }
}

function prepareStaging(extractDir, installRoot) {
  const stagingRoot = join(installRoot, ".update-staging");
  rmSync(stagingRoot, { recursive: true, force: true });
  mkdirSync(stagingRoot, { recursive: true });

  for (const name of ["server", "public", "streamdeck-plugin"]) {
    const src = join(extractDir, name);
    if (existsSync(src)) cpSync(src, join(stagingRoot, name), { recursive: true });
  }
  for (const name of ["package.json", "package-lock.json"]) {
    const src = join(extractDir, name);
    if (existsSync(src)) cpSync(src, join(stagingRoot, name));
  }
  for (const bat of [
    "Start Riftbound.bat",
    "Update Riftbound.bat",
    "Install Stream Deck plugin.bat",
    "Import Stream Deck profile.bat",
  ]) {
    const src = join(extractDir, bat);
    if (existsSync(src)) cpSync(src, join(stagingRoot, bat));
  }
  return stagingRoot;
}

async function applyStaging(stagingRoot, installRoot) {
  const backupRoot = join(installRoot, ".update-backup");
  rmSync(backupRoot, { recursive: true, force: true });
  mkdirSync(backupRoot, { recursive: true });

  try {
    for (const name of ["server", "public", "streamdeck-plugin"]) {
      await swapPath(join(stagingRoot, name), join(installRoot, name), backupRoot);
    }
    for (const name of ["package.json", "package-lock.json"]) {
      await swapFile(join(stagingRoot, name), join(installRoot, name), backupRoot);
    }
    for (const bat of [
      "Start Riftbound.bat",
      "Update Riftbound.bat",
      "Install Stream Deck plugin.bat",
      "Import Stream Deck profile.bat",
    ]) {
      await swapFile(join(stagingRoot, bat), join(installRoot, bat), backupRoot);
    }
  } finally {
    rmSync(backupRoot, { recursive: true, force: true });
    rmSync(stagingRoot, { recursive: true, force: true });
  }
}

function restartApp(installRoot) {
  const startBat = join(installRoot, "Start Riftbound.bat");
  if (!existsSync(startBat)) {
    log(`Start Riftbound.bat not found in ${installRoot}`);
    return;
  }
  log(`Restarting app → ${startBat}`);
  spawn("cmd.exe", ["/c", "start", "Riftbound OBS", "/D", installRoot, startBat], {
    detached: true,
    stdio: "ignore",
    windowsHide: false,
  }).unref();
}

async function main() {
  await runPatchApply();
}

export async function runPatchApply() {
  acquireLock("patch-apply");
  try {
    mkdirSync(updatesDir(), { recursive: true });
    writeFileSync(logPath(), `[${new Date().toISOString()}] --- patch update start ---\n`, "utf8");

    if (!existsSync(pendingPath())) {
      log("No pending update (missing pending.json).");
      process.exit(1);
    }

    const pending = JSON.parse(readFileSync(pendingPath(), "utf8"));
    if (pending.mode === "installer") {
      log("Pending update is installer mode — use update-router.js");
      process.exit(1);
    }

    const installRoot = normalizePath(pending.installRoot || process.cwd());
    log(`Install root: ${installRoot}`);
    if (!existsSync(installRoot)) {
      log(`Install folder not found: ${installRoot}`);
      process.exit(1);
    }

    const zipPath = pending.patchZip;
    if (!existsSync(zipPath)) {
      log(`Patch zip not found: ${zipPath}`);
      process.exit(1);
    }

    if (pending.sha256) {
      const hash = await sha256File(zipPath);
      if (hash !== pending.sha256) {
        log("SHA256 mismatch — aborting.");
        process.exit(1);
      }
    }

    const extractDir = join(updatesDir(), "extract");
    rmSync(extractDir, { recursive: true, force: true });
    log("Extracting patch…");
    expandZip(zipPath, extractDir);

    const oldLock = existsSync(join(installRoot, "package-lock.json"))
      ? readFileSync(join(installRoot, "package-lock.json"), "utf8")
      : null;
    const newLockPath = join(extractDir, "package-lock.json");
    const newLock = existsSync(newLockPath) ? readFileSync(newLockPath, "utf8") : null;
    const depsChanged = Boolean(newLock && newLock !== oldLock);

    const stagingRoot = prepareStaging(extractDir, installRoot);
    log(`Applying staged update to ${installRoot}`);
    await applyStaging(stagingRoot, installRoot);

    if (depsChanged) {
      log("Dependencies changed — running npm ci…");
      runNpmCi(installRoot);
    }

    installStreamDeckPlugin(installRoot);

    rmSync(pendingPath(), { force: true });
    rmSync(extractDir, { recursive: true, force: true });
    writeFileSync(
      join(updatesDir(), "last-update.json"),
      JSON.stringify({ version: pending.version, mode: "patch", appliedAt: new Date().toISOString() }, null, 2)
    );

    log(`Update applied successfully (v${pending.version}).`);
    if (pending.restart) restartApp(installRoot);
  } finally {
    releaseLock();
  }
}

const isCli = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isCli) {
  main().catch((err) => {
    log(`Update failed: ${err.stack || err.message}`);
    process.exit(1);
  });
}
