/**
 * Pre-apply validation for updates.
 */
import { accessSync, constants, existsSync, readFileSync } from "node:fs";
import { pendingPath, sha256File, logPath as updateLogPath } from "./update-utils.js";
import { compareSemver, getVersion } from "./version.js";

function canWriteDir(dir) {
  try {
    accessSync(dir, constants.W_OK);
    return true;
  } catch {
    return false;
  }
}

export async function runUpdatePreflight(applyTokenFromClient = null) {
  const errors = [];
  const warnings = [];

  if (!existsSync(pendingPath())) {
    errors.push("No update downloaded. Download the update first.");
    return { ok: false, errors, warnings };
  }

  let pending;
  try {
    pending = JSON.parse(readFileSync(pendingPath(), "utf8"));
  } catch {
    errors.push("pending.json is corrupt.");
    return { ok: false, errors, warnings };
  }

  const currentVersion = getVersion();
  if (!pending.version || compareSemver(pending.version, currentVersion) <= 0) {
    errors.push(
      `Downloaded update v${pending.version || "?"} is not newer than v${currentVersion}.`
    );
  }

  if (IS_ELECTRON && pending.mode !== "installer") {
    errors.push("Electron app requires a full installer update. Re-download the update.");
  }

  const installRoot = (pending.installRoot || getInstallRoot()).replace(/[\\/]+$/, "");
  if (!existsSync(installRoot)) {
    errors.push(`Install folder not found: ${installRoot}`);
  } else if (!canWriteDir(installRoot)) {
    errors.push(`Install folder is not writable: ${installRoot}`);
  }

  if (pending.mode === "installer") {
    const setupPath = pending.installerExe;
    if (!setupPath || !existsSync(setupPath)) {
      errors.push(`Installer file not found: ${setupPath || "(missing)"}`);
    } else if (pending.sha256) {
      try {
        const hash = await sha256File(setupPath);
        if (hash !== pending.sha256) {
          errors.push("Installer SHA256 mismatch — re-download the update.");
        }
      } catch (err) {
        errors.push(`Could not verify installer: ${err.message}`);
      }
    }
  } else if (pending.mode === "patch") {
    const zipPath = pending.patchZip;
    if (!zipPath || !existsSync(zipPath)) {
      errors.push(`Patch zip not found: ${zipPath || "(missing)"}`);
    }
  }

  if (IS_ELECTRON) {
    const bootstrap = findBootstrapScript(installRoot);
    if (!bootstrap) {
      errors.push(
        "Updater bootstrap not found in install folder (resources/updater/bootstrap.js)."
      );
    }
  }

  if (applyTokenFromClient && pending.applyToken && pending.applyToken !== applyTokenFromClient) {
    warnings.push("Apply token mismatch — refresh the control panel if apply fails.");
  }

  return {
    ok: errors.length === 0,
    errors,
    warnings,
    pending: {
      version: pending.version,
      mode: pending.mode,
      installRoot,
    },
    logPath: updateLogPath(),
  };
}
