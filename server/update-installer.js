/**
 * Silent Inno Setup installer apply (Windows).
 */
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { spawnAppLauncher } from "./launcher.js";
import {
  readAppPid,
  sleep,
  waitForProcessExit,
} from "./update-shutdown.js";
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
import { compareSemver, getVersion } from "./version.js";

function resolveParentPid(pending) {
  const fromEnv = parseInt(process.env.RIFTBOUND_UPDATE_PARENT_PID || "", 10);
  if (Number.isFinite(fromEnv) && fromEnv > 0) return fromEnv;
  if (pending?.parentPid) return pending.parentPid;
  return readAppPid();
}

function verifyInstalledVersion(expectedVersion) {
  if (!expectedVersion) return { ok: true };
  const actual = getVersion();
  if (compareSemver(actual, expectedVersion) >= 0) {
    return { ok: true, actual };
  }
  return {
    ok: false,
    actual,
    expected: expectedVersion,
    message: `Expected v${expectedVersion} after install but found v${actual}.`,
  };
}

export async function applyInstallerUpdate(pending) {
  acquireLock("installer-apply");
  try {
    mkdirSync(updatesDir(), { recursive: true });
    writeFileSync(
      logPath(),
      `[${new Date().toISOString()}] --- installer update start ---\n`,
      "utf8"
    );

    writeApplyStatus({
      phase: "waiting_app_exit",
      version: pending.version,
      mode: "installer",
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

    const setupPath = pending.installerExe;
    if (!setupPath || !existsSync(setupPath)) {
      throw new Error(`Installer not found: ${setupPath || "(missing)"}`);
    }

    if (pending.sha256) {
      log("Verifying installer SHA256…");
      const hash = await sha256File(setupPath);
      if (hash !== pending.sha256) {
        throw new Error("Installer SHA256 mismatch — aborting.");
      }
    }

    writeApplyStatus({
      phase: "running_installer",
      version: pending.version,
      mode: "installer",
      message: "Running silent installer…",
      error: null,
    });

    log(`Running silent installer → ${setupPath}`);
    await runSilentInstaller(setupPath);

    const verify = verifyInstalledVersion(pending.version);
    if (!verify.ok) {
      log(verify.message);
      writeApplyStatus({
        phase: "failed",
        version: pending.version,
        mode: "installer",
        message: verify.message,
        error: verify.message,
      });
      throw new Error(verify.message);
    }

    rmSync(pendingPath(), { force: true });
    writeFileSync(
      join(updatesDir(), "last-update.json"),
      JSON.stringify(
        {
          version: pending.version,
          mode: "installer",
          appliedAt: new Date().toISOString(),
          verifiedVersion: verify.actual || pending.version,
        },
        null,
        2
      ),
      "utf8"
    );

    writeApplyStatus({
      phase: "restarting",
      version: pending.version,
      mode: "installer",
      message: "Restarting app…",
      error: null,
    });

    log(`Installer update applied successfully (v${pending.version}).`);
    await sleep(3000);

    if (pending.restart) {
      restartApp(pending.installRoot);
    }

    writeApplyStatus({
      phase: "success",
      version: pending.version,
      mode: "installer",
      message: `Updated to v${pending.version}.`,
      error: null,
    });
  } catch (err) {
    log(`Installer update failed: ${err.stack || err.message}`);
    writeApplyStatus({
      phase: "failed",
      version: pending?.version,
      mode: "installer",
      message: err.message,
      error: err.message,
    });
    throw err;
  } finally {
    releaseLock();
  }
}

function restartApp(installRoot) {
  if (spawnAppLauncher(installRoot, { spawnFn: spawn, cwd: installRoot })) {
    log(`Restarting app from ${installRoot}`);
    return;
  }
  log(`App launcher not found in ${installRoot}`);
}

function runSilentInstaller(setupPath) {
  return new Promise((resolve, reject) => {
    const child = spawn(setupPath, ["/S"], {
      detached: false,
      stdio: "inherit",
      windowsHide: true,
    });
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`Installer exited with code ${code}`));
    });
  });
}

export async function mainFromCli() {
  if (!existsSync(pendingPath())) {
    log("No pending installer update.");
    process.exit(1);
  }
  const pending = JSON.parse(readFileSync(pendingPath(), "utf8"));
  if (pending.mode !== "installer") {
    log("Pending update is not an installer update.");
    process.exit(1);
  }
  try {
    await applyInstallerUpdate(pending);
  } catch (err) {
    log(`Installer update failed: ${err.stack || err.message}`);
    process.exit(1);
  }
}
