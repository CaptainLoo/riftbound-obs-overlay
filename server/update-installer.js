/**
 * Silent Inno Setup installer apply (Windows).
 */
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { spawnAppLauncher } from "./launcher.js";
import {
  acquireLock,
  log,
  logPath,
  pendingPath,
  releaseLock,
  sha256File,
  updatesDir,
} from "./update-utils.js";

export async function applyInstallerUpdate(pending) {
  acquireLock("installer-apply");
  try {
    mkdirSync(updatesDir(), { recursive: true });
    writeFileSync(
      logPath(),
      `[${new Date().toISOString()}] --- installer update start ---\n`,
      { flag: "a" }
    );

    const setupPath = pending.installerExe;
    if (!setupPath || !existsSync(setupPath)) {
      throw new Error(`Installer not found: ${setupPath || "(missing)"}`);
    }

    if (pending.sha256) {
      const hash = await sha256File(setupPath);
      if (hash !== pending.sha256) {
        throw new Error("Installer SHA256 mismatch — aborting.");
      }
    }

    log(`Running silent installer → ${setupPath}`);
    await runSilentInstaller(setupPath);

    rmSync(pendingPath(), { force: true });
    writeFileSync(
      join(updatesDir(), "last-update.json"),
      JSON.stringify(
        { version: pending.version, mode: "installer", appliedAt: new Date().toISOString() },
        null,
        2
      ),
      "utf8"
    );
    log(`Installer update applied successfully (v${pending.version}).`);
    if (pending.restart) {
      restartApp(pending.installRoot);
    }
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
