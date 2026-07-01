import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { createWriteStream, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { platform } from "node:os";
import { join } from "node:path";
import { DATA_DIR, IS_PORTABLE, ROOT_DIR } from "./paths.js";
import { compareSemver, getUpdateRepo, getVersion } from "./version.js";

const GITHUB_HEADERS = {
  Accept: "application/vnd.github+json",
  "User-Agent": "riftbound-obs-updater",
};

export function isUpdateSupported() {
  return IS_PORTABLE && platform() === "win32";
}

export function getLocalVersionInfo() {
  return {
    version: getVersion(),
    updateRepo: getUpdateRepo(),
    supported: isUpdateSupported(),
  };
}

function updatesDir() {
  return join(DATA_DIR, "updates");
}

function pendingPath() {
  return join(updatesDir(), "pending.json");
}

async function fetchJson(url) {
  const res = await fetch(url, { headers: GITHUB_HEADERS });
  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText);
    throw new Error(`GitHub API ${res.status}: ${text}`);
  }
  return res.json();
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
  const manifestAsset = (release.assets || []).find((a) => a.name === "update-manifest.json");
  if (manifestAsset?.browser_download_url) {
    const res = await fetch(manifestAsset.browser_download_url, { headers: GITHUB_HEADERS });
    if (res.ok) manifest = await res.json();
  }

  const patchAsset = (release.assets || []).find(
    (a) => a.name.startsWith("riftbound-obs-patch-") && a.name.endsWith(".zip")
  );
  const fullAsset = (release.assets || []).find((a) => a.name === "riftbound-obs-windows.zip");

  if (!manifest) {
    manifest = {
      version: tag,
      notes: release.body || "",
      patch: patchAsset
        ? { url: patchAsset.browser_download_url, sha256: null, file: patchAsset.name }
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
    if (!manifest.full?.url && fullAsset) {
      manifest.full = { url: fullAsset.browser_download_url, file: fullAsset.name };
    }
    manifest.notes = manifest.notes || release.body || "";
  }

  manifest.version = manifest.version || tag;
  return manifest;
}

function getDownloadStatus() {
  const pending = pendingPath();
  if (!existsSync(pending)) return null;
  try {
    const data = JSON.parse(readFileSync(pending, "utf8"));
    return {
      version: data.version,
      ready: existsSync(data.patchZip),
      sha256: data.sha256,
    };
  } catch {
    return null;
  }
}

export async function checkForUpdate() {
  if (!isUpdateSupported()) {
    return {
      supported: false,
      currentVersion: getVersion(),
      message: "In-app updates are only available on the Windows portable install.",
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
      error: err.message,
      updateAvailable: false,
    };
  }

  const latestVersion = manifest.version;
  const cmp = compareSemver(latestVersion, currentVersion);

  return {
    supported: true,
    currentVersion,
    latestVersion,
    updateAvailable: cmp > 0,
    notes: manifest.notes || "",
    patch: manifest.patch || null,
    full: manifest.full || null,
    downloaded: getDownloadStatus(),
  };
}

export async function downloadUpdate() {
  if (!isUpdateSupported()) {
    throw new Error("Updates not supported on this platform.");
  }

  const status = await checkForUpdate();
  if (status.error) throw new Error(status.error);
  if (!status.updateAvailable) {
    return { ok: true, message: "Already up to date.", ...status };
  }
  if (!status.patch?.url) {
    throw new Error("No patch asset in the latest release.");
  }

  mkdirSync(updatesDir(), { recursive: true });
  const zipPath = join(updatesDir(), status.patch.file || `patch-${status.latestVersion}.zip`);

  const res = await fetch(status.patch.url, { headers: GITHUB_HEADERS });
  if (!res.ok) throw new Error(`Download failed: HTTP ${res.status}`);

  const body = res.body;
  if (!body) throw new Error("Empty download body");

  const hash = createHash("sha256");
  const out = createWriteStream(zipPath);
  const reader = body.getReader();
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      hash.update(value);
      if (!out.write(value)) {
        await new Promise((resolve) => out.once("drain", resolve));
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
  if (status.patch.sha256 && sha256 !== status.patch.sha256) {
    throw new Error("Downloaded patch failed SHA256 verification.");
  }

  writeFileSync(
    pendingPath(),
    JSON.stringify(
      {
        version: status.latestVersion,
        patchZip: zipPath,
        sha256,
        restart: true,
        installRoot: ROOT_DIR,
      },
      null,
      2
    ),
    "utf8"
  );

  return {
    ok: true,
    version: status.latestVersion,
    patchZip: zipPath,
    sha256,
    ready: true,
  };
}

export function applyUpdate() {
  if (!isUpdateSupported()) {
    throw new Error("Updates not supported on this platform.");
  }
  if (!existsSync(pendingPath())) {
    throw new Error("No update downloaded. Download the patch first.");
  }

  const pending = JSON.parse(readFileSync(pendingPath(), "utf8"));
  pending.restart = true;
  pending.installRoot = ROOT_DIR;
  writeFileSync(pendingPath(), JSON.stringify(pending, null, 2), "utf8");

  const updateBat = join(ROOT_DIR, "Update Riftbound.bat");
  if (!existsSync(updateBat)) {
    throw new Error("Update Riftbound.bat not found in install folder.");
  }

  spawn("cmd.exe", ["/c", updateBat], {
    detached: true,
    stdio: "ignore",
    cwd: ROOT_DIR,
  }).unref();

  setTimeout(() => process.exit(0), 300);
  return { ok: true, message: "Applying update and restarting…" };
}
