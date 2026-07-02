import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import {
  createWriteStream,
  existsSync,
  mkdirSync,
  readFileSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { platform } from "node:os";
import { join } from "node:path";
import { IS_ELECTRON, IS_INSTALLER, IS_PORTABLE, getInstallRoot } from "./paths.js";
import { spawnUpdateApply } from "./launcher.js";
import { runUpdatePreflight } from "./update-preflight.js";
import { clearAppPid, shutdownForUpdate, sleep } from "./update-shutdown.js";
import {
  acquireLock,
  clearDownloadProgress,
  clearStaleLock,
  getApplyToken,
  loadApplyTokenFromPending,
  logPath,
  mintApplyToken,
  pendingPath,
  readApplyStatus,
  readDownloadProgress,
  readLastUpdate,
  readUpdateLogTail,
  releaseLock,
  sha256File,
  updatesDir,
  verifyApplyToken,
  writeApplyStatus,
  writeDownloadProgress,
} from "./update-utils.js";
import { compareSemver, getBundledNodeVersion, getUpdateRepo, getVersion } from "./version.js";

const GITHUB_HEADERS = {
  Accept: "application/vnd.github+json",
  "User-Agent": "riftbound-obs-updater",
};

const INSTALLER_CI_MESSAGE =
  "Full installer not uploaded yet — CI is still building it (usually a few minutes). Download riftbound-setup from GitHub Releases if needed.";

export function isUpdateSupported() {
  return platform() === "win32" && (IS_PORTABLE || IS_INSTALLER || IS_ELECTRON);
}

export function getInstallType() {
  if (IS_ELECTRON) return "electron";
  if (IS_INSTALLER) return "installer";
  if (IS_PORTABLE) return "portable";
  return "dev";
}

export function getLocalVersionInfo() {
  return {
    version: getVersion(),
    updateRepo: getUpdateRepo(),
    supported: isUpdateSupported(),
    installType: getInstallType(),
    nodeVersion: getBundledNodeVersion(),
  };
}

export function getUpdateStatus() {
  const applyStatus = readApplyStatus();
  return {
    applyStatus,
    logPath: logPath(),
    logTail: readUpdateLogTail(80),
    lastUpdate: readLastUpdate(),
  };
}

export function getUpdateLog(lines = 200) {
  return {
    logPath: logPath(),
    lines: readUpdateLogTail(lines),
  };
}

export async function preflightUpdate(applyTokenFromClient) {
  return runUpdatePreflight(applyTokenFromClient);
}

async function fetchJson(url) {
  const res = await fetch(url, { headers: GITHUB_HEADERS });
  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText);
    throw new Error(`GitHub API ${res.status}: ${text}`);
  }
  return res.json();
}

function findAsset(release, matcher) {
  return (release.assets || []).find(matcher);
}

async function fetchLatestManifest() {
  const repo = getUpdateRepo();
  if (!repo || repo.includes("REPLACE")) {
    throw new Error(
      "Update repo not configured. Set package.json → riftbound.updateRepo to owner/repo."
    );
  }

  const release = await fetchJson(`https://api.github.com/repos/${repo}/releases/latest`);
  const tag = release.tag_name?.replace(/^v/, "") || release.name;

  let manifest = null;
  const manifestAsset = findAsset(release, (a) => a.name === "update-manifest.json");
  if (manifestAsset?.browser_download_url) {
    const res = await fetch(manifestAsset.browser_download_url, { headers: GITHUB_HEADERS });
    if (res.ok) manifest = await res.json();
  }

  const patchAsset = findAsset(
    release,
    (a) => a.name.startsWith("riftbound-obs-patch-") && a.name.endsWith(".zip")
  );
  const fullAsset = findAsset(release, (a) => a.name === "riftbound-obs-windows.zip");
  const installerAsset = findAsset(
    release,
    (a) => a.name.startsWith("riftbound-setup-") && a.name.endsWith(".exe")
  );

  if (!manifest) {
    manifest = {
      version: tag,
      channel: "stable",
      notes: release.body || "",
      patch: patchAsset
        ? { url: patchAsset.browser_download_url, sha256: null, file: patchAsset.name }
        : null,
      installer: installerAsset
        ? {
            url: installerAsset.browser_download_url,
            sha256: null,
            file: installerAsset.name,
            size: installerAsset.size || null,
          }
        : null,
      full: fullAsset ? { url: fullAsset.browser_download_url, file: fullAsset.name } : null,
    };
  } else {
    if (!manifest.patch?.url && patchAsset) {
      manifest.patch = {
        ...manifest.patch,
        url: patchAsset.browser_download_url,
        file: patchAsset.name,
      };
    }
    if (!manifest.installer?.url && installerAsset) {
      manifest.installer = {
        ...manifest.installer,
        url: installerAsset.browser_download_url,
        file: installerAsset.name,
        size: installerAsset.size || manifest.installer?.size || null,
      };
    }
    if (!manifest.full?.url && fullAsset) {
      manifest.full = { url: fullAsset.browser_download_url, file: fullAsset.name };
    }
    manifest.notes = manifest.notes || release.body || "";
  }

  manifest.version = manifest.version || tag;
  manifest.channel = manifest.channel || "stable";
  return manifest;
}

function nodeMajorMinor(version) {
  const parts = String(version || "")
    .replace(/^v/, "")
    .split(".");
  return `${parseInt(parts[0], 10) || 0}.${parseInt(parts[1], 10) || 0}`;
}

function nodeRuntimeMismatch(manifestNode, bundledNode) {
  if (!manifestNode || !bundledNode) return false;
  if (IS_ELECTRON) return false;
  return nodeMajorMinor(manifestNode) !== nodeMajorMinor(bundledNode);
}

function resolveUpdateMode(manifest, currentVersion) {
  if (compareSemver(manifest.version, currentVersion) <= 0) return null;

  if (IS_ELECTRON) {
    if (manifest.installer?.url || manifest.installer?.file) return "installer";
    return null;
  }

  if (manifest.forceFull) return "installer";
  const bundledNode = getBundledNodeVersion();
  if (nodeRuntimeMismatch(manifest.nodeVersion, bundledNode)) {
    return "installer";
  }
  if (manifest.minPatchFrom && compareSemver(currentVersion, manifest.minPatchFrom) < 0) {
    return "installer";
  }
  if (manifest.patch?.url || manifest.patch?.file) return "patch";
  if (manifest.installer?.url || manifest.installer?.file) return "installer";
  return null;
}

function removePendingFiles(data) {
  if (data?.patchZip && existsSync(data.patchZip)) unlinkSync(data.patchZip);
  if (data?.installerExe && existsSync(data.installerExe)) unlinkSync(data.installerExe);
  if (existsSync(pendingPath())) unlinkSync(pendingPath());
}

function cleanupStalePending(currentVersion, latestVersion = null) {
  const pending = pendingPath();
  if (!existsSync(pending)) return;
  try {
    const data = JSON.parse(readFileSync(pending, "utf8"));
    const tooOldForInstalled =
      !data.version || compareSemver(data.version, currentVersion) <= 0;
    const tooOldForLatest =
      latestVersion &&
      data.version &&
      compareSemver(data.version, latestVersion) < 0;
    if (tooOldForInstalled || tooOldForLatest) {
      removePendingFiles(data);
    }
  } catch {
    try {
      unlinkSync(pending);
    } catch {
      /* ignore */
    }
  }
}

function getDownloadStatus(currentVersion, latestVersion) {
  cleanupStalePending(currentVersion, latestVersion);
  const pending = pendingPath();
  if (!existsSync(pending)) return null;
  try {
    const data = JSON.parse(readFileSync(pending, "utf8"));
    if (!data.version || compareSemver(data.version, currentVersion) <= 0) return null;
    if (latestVersion && compareSemver(data.version, latestVersion) < 0) return null;

    const artifactPath = data.mode === "installer" ? data.installerExe : data.patchZip;
    return {
      version: data.version,
      mode: data.mode || "patch",
      ready: Boolean(artifactPath && existsSync(artifactPath)),
      sha256: data.sha256,
    };
  } catch {
    return null;
  }
}

function getLastApplyFailure() {
  const status = readApplyStatus();
  if (!status || status.phase !== "failed") return null;
  return {
    phase: status.phase,
    version: status.version,
    message: status.message || status.error,
    error: status.error,
    at: status.at,
    logPath: logPath(),
  };
}

export async function checkForUpdate() {
  if (!isUpdateSupported()) {
    return {
      supported: false,
      currentVersion: getVersion(),
      installType: getInstallType(),
      message: "In-app updates are only available on the Windows install.",
    };
  }

  const currentVersion = getVersion();
  let manifest;
  try {
    manifest = await fetchLatestManifest();
  } catch (err) {
    return {
      supported: true,
      currentVersion,
      installType: getInstallType(),
      error: err.message,
      updateAvailable: false,
      lastApplyFailure: getLastApplyFailure(),
    };
  }

  const latestVersion = manifest.version;
  const updateAvailable = compareSemver(latestVersion, currentVersion) > 0;
  let updateMode = updateAvailable ? resolveUpdateMode(manifest, currentVersion) : null;
  let updateBlockedReason = null;

  if (updateAvailable && IS_ELECTRON && !updateMode) {
    updateBlockedReason = INSTALLER_CI_MESSAGE;
  }

  const downloaded = getDownloadStatus(currentVersion, latestVersion);
  loadApplyTokenFromPending();

  return {
    supported: true,
    currentVersion,
    latestVersion,
    updateAvailable,
    updateMode,
    updateBlockedReason,
    installType: getInstallType(),
    nodeVersion: getBundledNodeVersion(),
    notes: manifest.notes || "",
    patch: IS_ELECTRON ? null : manifest.patch || null,
    installer: manifest.installer || null,
    full: manifest.full || null,
    forceFull: Boolean(manifest.forceFull),
    downloaded,
    applyToken: getApplyToken(),
    lastApplyFailure: getLastApplyFailure(),
    logPath: logPath(),
  };
}

async function downloadArtifact(url, destPath, expectedSha256, onProgress) {
  const res = await fetch(url, { headers: GITHUB_HEADERS });
  if (!res.ok) throw new Error(`Download failed: HTTP ${res.status}`);

  const total = Number(res.headers.get("content-length") || 0);
  const body = res.body;
  if (!body) throw new Error("Empty download body");

  const hash = createHash("sha256");
  const out = createWriteStream(destPath);
  out.on("error", (err) => {
    throw err;
  });

  let received = 0;
  const reader = body.getReader();
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      hash.update(value);
      received += value.length;
      if (!out.write(value)) {
        await new Promise((resolve) => out.once("drain", resolve));
      }
      if (onProgress) {
        onProgress({ received, total, percent: total ? Math.round((received / total) * 100) : null });
      }
    }
  } finally {
    reader.releaseLock();
  }

  await new Promise((resolve, reject) => {
    out.end(() => resolve());
    out.on("error", reject);
  });

  const sha256 = hash.digest("hex");
  if (expectedSha256 && sha256 !== expectedSha256) {
    unlinkSync(destPath);
    throw new Error("Download failed SHA256 verification.");
  }
  return sha256;
}

function existingPendingMatches(status) {
  if (!existsSync(pendingPath())) return false;
  try {
    const data = JSON.parse(readFileSync(pendingPath(), "utf8"));
    if (data.version !== status.latestVersion) return false;
    if ((data.mode || "patch") !== status.updateMode) return false;
    const artifactPath = data.mode === "installer" ? data.installerExe : data.patchZip;
    return Boolean(artifactPath && existsSync(artifactPath));
  } catch {
    return false;
  }
}

export async function downloadUpdate() {
  if (!isUpdateSupported()) {
    throw new Error("Updates not supported on this platform.");
  }

  clearStaleLock();
  acquireLock("download");
  try {
    const status = await checkForUpdate();
    if (status.error) throw new Error(status.error);
    if (!status.updateAvailable) {
      return { ok: true, message: "Already up to date.", ...status };
    }
    if (!status.updateMode) {
      throw new Error(status.updateBlockedReason || "No update artifact available in the latest release.");
    }

    if (existingPendingMatches(status)) {
      const data = JSON.parse(readFileSync(pendingPath(), "utf8"));
      return {
        ok: true,
        message: "Update already downloaded.",
        version: data.version,
        mode: data.mode || "patch",
        ready: true,
        skipped: true,
        applyToken: getApplyToken(),
      };
    }

    mkdirSync(updatesDir(), { recursive: true });
    clearDownloadProgress();

    const token = mintApplyToken();
    let sha256;
    let pending;

    if (status.updateMode === "installer") {
      if (!status.installer?.url) {
        throw new Error(INSTALLER_CI_MESSAGE);
      }
      const dest = join(
        updatesDir(),
        status.installer.file || `riftbound-setup-${status.latestVersion}.exe`
      );
      writeDownloadProgress({
        status: "downloading",
        mode: "installer",
        received: 0,
        total: status.installer.size || 0,
      });
      sha256 = await downloadArtifact(
        status.installer.url,
        dest,
        status.installer.sha256,
        (p) => writeDownloadProgress({ status: "downloading", mode: "installer", ...p })
      );
      pending = {
        version: status.latestVersion,
        mode: "installer",
        installerExe: dest,
        sha256,
        restart: true,
        installRoot: getInstallRoot().replace(/[\\/]+$/, ""),
        applyToken: token,
        parentPid: process.pid,
      };
    } else {
      if (!status.patch?.url) throw new Error("No patch asset in the latest release.");
      const dest = join(updatesDir(), status.patch.file || `patch-${status.latestVersion}.zip`);
      writeDownloadProgress({ status: "downloading", mode: "patch", received: 0, total: 0 });
      sha256 = await downloadArtifact(
        status.patch.url,
        dest,
        status.patch.sha256,
        (p) => writeDownloadProgress({ status: "downloading", mode: "patch", ...p })
      );
      pending = {
        version: status.latestVersion,
        mode: "patch",
        patchZip: dest,
        sha256,
        restart: true,
        installRoot: getInstallRoot().replace(/[\\/]+$/, ""),
        applyToken: token,
        parentPid: process.pid,
      };
    }

    writeFileSync(pendingPath(), JSON.stringify(pending, null, 2), "utf8");
    writeDownloadProgress({
      status: "complete",
      mode: status.updateMode,
      received: 1,
      total: 1,
      percent: 100,
    });

    return {
      ok: true,
      version: status.latestVersion,
      mode: status.updateMode,
      sha256,
      ready: true,
      applyToken: token,
    };
  } finally {
    releaseLock();
  }
}

export function getDownloadProgress() {
  return readDownloadProgress();
}

export async function applyUpdate(applyTokenFromClient) {
  if (!isUpdateSupported()) {
    throw new Error("Updates not supported on this platform.");
  }
  if (!verifyApplyToken(applyTokenFromClient)) {
    loadApplyTokenFromPending();
    if (!verifyApplyToken(applyTokenFromClient)) {
      throw new Error("Invalid or expired update token. Refresh the control panel and try again.");
    }
  }
  if (!existsSync(pendingPath())) {
    throw new Error("No update downloaded. Download the update first.");
  }

  const preflight = await runUpdatePreflight(applyTokenFromClient);
  if (!preflight.ok) {
    throw new Error(preflight.errors.join(" "));
  }

  clearStaleLock();
  acquireLock("apply");
  try {
    const pending = JSON.parse(readFileSync(pendingPath(), "utf8"));
    const currentVersion = getVersion();
    if (!pending.version || compareSemver(pending.version, currentVersion) <= 0) {
      cleanupStalePending(currentVersion);
      throw new Error(
        `Downloaded update v${pending.version || "?"} is not newer than v${currentVersion}.`
      );
    }

    const installRoot = getInstallRoot().replace(/[\\/]+$/, "");
    pending.restart = true;
    pending.installRoot = installRoot;
    pending.applyToken = applyTokenFromClient || getApplyToken();
    pending.parentPid = process.pid;
    writeFileSync(pendingPath(), JSON.stringify(pending, null, 2), "utf8");

    writeApplyStatus({
      phase: "validated",
      version: pending.version,
      mode: pending.mode || "installer",
      message: "Update validated — shutting down app…",
      error: null,
    });

    writeApplyStatus({
      phase: "shutting_down",
      version: pending.version,
      mode: pending.mode || "installer",
      message: "Stopping server and Stream Deck worker…",
      error: null,
    });

    await shutdownForUpdate();
    await sleep(2000);
    clearAppPid();

    writeApplyStatus({
      phase: "spawned",
      version: pending.version,
      mode: pending.mode || "installer",
      message: "Launching updater…",
      error: null,
    });

    const spawned = spawnUpdateApply(installRoot, {
      spawnFn: spawn,
      isElectron: IS_ELECTRON,
      parentPid: process.pid,
    });
    if (!spawned.ok) {
      writeApplyStatus({
        phase: "failed",
        version: pending.version,
        mode: pending.mode || "installer",
        message: spawned.error,
        error: spawned.error,
      });
      throw new Error(spawned.error);
    }

    releaseLock();
    setTimeout(() => process.exit(0), 500);
    return {
      ok: true,
      message: "Applying update and restarting…",
      expectedVersion: pending.version,
      mode: pending.mode || "installer",
      logPath: logPath(),
    };
  } catch (err) {
    releaseLock();
    writeApplyStatus({
      phase: "failed",
      message: err.message,
      error: err.message,
    });
    throw err;
  }
}
