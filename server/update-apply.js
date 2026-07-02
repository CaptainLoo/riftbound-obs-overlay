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
import { platform } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { spawnAppLauncher, resolvePatchTargetRoot } from "./launcher.js";
import { readAppPid, sleep, waitForProcessExit } from "./update-shutdown.js";
import {
  acquireLock,
  log,
  logPath,
  pendingPath,
  releaseLock,
  sha256File,
  updatesDir,
  writeApplyStatus,
} from "./update-utils.js";

function normalizePath(p) {
  if (!p || typeof p !== "string") return process.cwd();
  return p.replace(/^["']+|["']+$/g, "").replace(/[\\/]+$/, "");
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

function runElectronNpmCi(contentRoot) {
  const npmCli = join(contentRoot, "node_modules", "npm", "bin", "npm-cli.js");
  if (!existsSync(npmCli)) {
    log("npm not found in content root — skipping npm ci.");
    return;
  }
  const nodeRunner = process.env.RIFTBOUND_ELECTRON === "1" ? process.execPath : null;
  if (!nodeRunner) {
    log("Electron runtime not detected — skipping npm ci.");
    return;
  }
  log("Dependencies changed — running npm ci in content root…");
  execSync(`"${nodeRunner}" "${npmCli}" ci --omit=dev`, {
    cwd: contentRoot,
    stdio: "inherit",
    env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" },
  });
}

function runElectronRebuild(contentRoot) {
  if (process.env.RIFTBOUND_ELECTRON !== "1") return;
  const electronVer = process.versions.electron;
  if (!electronVer) {
    log("Electron version unknown — skipping native rebuild.");
    return;
  }
  const rebuildCli = join(contentRoot, "node_modules", "@electron", "rebuild", "lib", "cli.js");
  if (!existsSync(rebuildCli)) {
    log("@electron/rebuild not found — skipping native rebuild (use full installer if Stream Deck fails).");
    return;
  }
  log(`Rebuilding native modules (sharp, node-hid, @julusian/jpeg-turbo) for Electron ${electronVer}…`);
  execSync(
    `"${process.execPath}" "${rebuildCli}" --module-dir "${contentRoot}" --force --only sharp,node-hid,@julusian/jpeg-turbo --version ${electronVer}`,
    {
      cwd: contentRoot,
      stdio: "inherit",
      env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" },
    }
  );
}

function runNpmCi(nodeRoot, workDir) {
  const nodeExe = join(nodeRoot, "node", "node.exe");
  if (!existsSync(nodeExe)) {
    log("Bundled node not found — skipping npm ci.");
    return;
  }
  const npmCli = join(workDir, "node_modules", "npm", "bin", "npm-cli.js");
  if (existsSync(npmCli)) {
    execSync(`"${nodeExe}" "${npmCli}" ci --omit=dev`, { cwd: workDir, stdio: "inherit" });
    return;
  }
  execSync(`"${nodeExe}" -e "require('child_process').execSync('npm ci --omit=dev',{stdio:'inherit'})"`, {
    cwd: workDir,
    stdio: "inherit",
    shell: true,
  });
}

async function renameWithRetry(from, to, attempts = 12) {
  let lastErr;
  for (let i = 0; i < attempts; i++) {
    try {
      if (existsSync(to)) rmSync(to, { recursive: true, force: true });
      renameSync(from, to);
      return;
    } catch (err) {
      lastErr = err;
      log(`Rename retry ${i + 1}/${attempts} ${from} → ${to}: ${err.message}`);
      if (i < attempts - 1) await sleep(2000);
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

  for (const name of ["server", "public"]) {
    const src = join(extractDir, name);
    if (existsSync(src)) cpSync(src, join(stagingRoot, name), { recursive: true });
  }
  for (const name of ["package.json", "package-lock.json"]) {
    const src = join(extractDir, name);
    if (existsSync(src)) cpSync(src, join(stagingRoot, name));
  }
  for (const bat of ["Start Riftbound.bat", "Update Riftbound.bat"]) {
    const src = join(extractDir, bat);
    if (existsSync(src)) cpSync(src, join(stagingRoot, bat));
  }
  return stagingRoot;
}

async function applyStaging(stagingRoot, installRoot, contentRoot) {
  const backupRoot = join(installRoot, ".update-backup");
  rmSync(backupRoot, { recursive: true, force: true });
  mkdirSync(backupRoot, { recursive: true });

  try {
    for (const name of ["server", "public"]) {
      await swapPath(join(stagingRoot, name), join(contentRoot, name), backupRoot);
    }
    for (const name of ["package.json", "package-lock.json"]) {
      await swapFile(join(stagingRoot, name), join(contentRoot, name), backupRoot);
    }
    for (const bat of ["Start Riftbound.bat", "Update Riftbound.bat"]) {
      await swapFile(join(stagingRoot, bat), join(installRoot, bat), backupRoot);
    }
  } finally {
    rmSync(backupRoot, { recursive: true, force: true });
    rmSync(stagingRoot, { recursive: true, force: true });
  }
}

function restartApp(installRoot) {
  if (spawnAppLauncher(installRoot, { spawnFn: spawn, cwd: installRoot })) {
    log(`Restarting app from ${installRoot}`);
    return;
  }
  log(`App launcher not found in ${installRoot}`);
}

function resolveParentPid(pending) {
  const fromEnv = parseInt(process.env.RIFTBOUND_UPDATE_PARENT_PID || "", 10);
  if (Number.isFinite(fromEnv) && fromEnv > 0) return fromEnv;
  if (pending?.parentPid) return pending.parentPid;
  return readAppPid();
}

async function main() {
  await runPatchApply();
}

export async function runPatchApply() {
  acquireLock("patch-apply");
  let pending = null;
  try {
    mkdirSync(updatesDir(), { recursive: true });
    writeFileSync(logPath(), `[${new Date().toISOString()}] --- patch update start ---\n`, "utf8");

    if (!existsSync(pendingPath())) {
      log("No pending update (missing pending.json).");
      process.exit(1);
    }

    pending = JSON.parse(readFileSync(pendingPath(), "utf8"));
    if (pending.mode === "installer") {
      log("Pending update is installer mode — use update-router.js");
      process.exit(1);
    }

    writeApplyStatus({
      phase: "waiting_app_exit",
      version: pending.version,
      mode: "patch",
      message: "Waiting for app to exit…",
      error: null,
    });

    const parentPid = resolveParentPid(pending);
    log(`Waiting for parent process ${parentPid || "(unknown)"} to exit…`);
    const exited = await waitForProcessExit(parentPid, 60000);
    if (!exited) {
      throw new Error(`App process ${parentPid} did not exit within 60 seconds.`);
    }
    await sleep(1500);

    const installRoot = normalizePath(pending.installRoot || process.cwd());
    const contentRoot = resolvePatchTargetRoot(installRoot);
    log(`Install root: ${installRoot}`);
    log(`Content root: ${contentRoot}`);
    if (!existsSync(installRoot)) {
      throw new Error(`Install folder not found: ${installRoot}`);
    }

    const zipPath = pending.patchZip;
    if (!existsSync(zipPath)) {
      throw new Error(`Patch zip not found: ${zipPath}`);
    }

    if (pending.sha256) {
      const hash = await sha256File(zipPath);
      if (hash !== pending.sha256) {
        throw new Error("SHA256 mismatch — aborting.");
      }
    }

    const extractDir = join(updatesDir(), "extract");
    rmSync(extractDir, { recursive: true, force: true });

    writeApplyStatus({
      phase: "extracting",
      version: pending.version,
      mode: "patch",
      message: "Extracting patch…",
      error: null,
    });
    log("Extracting patch…");
    expandZip(zipPath, extractDir);

    const oldLock = existsSync(join(contentRoot, "package-lock.json"))
      ? readFileSync(join(contentRoot, "package-lock.json"), "utf8")
      : null;
    const newLockPath = join(extractDir, "package-lock.json");
    const newLock = existsSync(newLockPath) ? readFileSync(newLockPath, "utf8") : null;
    const depsChanged = Boolean(newLock && newLock !== oldLock);

    const stagingRoot = prepareStaging(extractDir, installRoot);

    writeApplyStatus({
      phase: "applying",
      version: pending.version,
      mode: "patch",
      message: "Applying patch files…",
      error: null,
    });
    log(`Applying staged update to ${contentRoot}`);
    await applyStaging(stagingRoot, installRoot, contentRoot);

    if (depsChanged) {
      writeApplyStatus({
        phase: "rebuilding",
        version: pending.version,
        mode: "patch",
        message: "Rebuilding native modules…",
        error: null,
      });
      try {
        const nodeExe = join(installRoot, "node", "node.exe");
        if (existsSync(nodeExe)) {
          log("Dependencies changed — running npm ci…");
          runNpmCi(installRoot, contentRoot);
        } else if (process.env.RIFTBOUND_ELECTRON === "1") {
          runElectronNpmCi(contentRoot);
          runElectronRebuild(contentRoot);
        } else {
          log("Dependencies changed — skip npm ci (use full installer if modules are missing).");
        }
      } catch (rebuildErr) {
        log(`Native rebuild failed: ${rebuildErr.message}`);
        throw new Error(
          `Native module rebuild failed — install riftbound-setup-${pending.version}.exe from GitHub Releases instead.`
        );
      }
    }

    rmSync(pendingPath(), { force: true });
    rmSync(extractDir, { recursive: true, force: true });
    writeFileSync(
      join(updatesDir(), "last-update.json"),
      JSON.stringify({ version: pending.version, mode: "patch", appliedAt: new Date().toISOString() }, null, 2)
    );

    writeApplyStatus({
      phase: "restarting",
      version: pending.version,
      mode: "patch",
      message: "Restarting app…",
      error: null,
    });

    log(`Update applied successfully (v${pending.version}).`);
    await sleep(1000);
    if (pending.restart) restartApp(installRoot);

    writeApplyStatus({
      phase: "success",
      version: pending.version,
      mode: "patch",
      message: `Updated to v${pending.version}.`,
      error: null,
    });
  } catch (err) {
    log(`Update failed: ${err.stack || err.message}`);
    writeApplyStatus({
      phase: "failed",
      version: pending?.version,
      mode: "patch",
      message: err.message,
      error: err.message,
    });
    process.exitCode = 1;
    throw err;
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
