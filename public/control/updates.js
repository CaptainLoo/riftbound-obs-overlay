/** In-app updates banner (Windows installs). */
import { api } from "./api.js";
import { toast } from "./toast.js";

const $ = (id) => document.getElementById(id);
const updateBanner = $("update-banner");
const updateTitle = $("update-banner-title");
const updateDetail = $("update-banner-detail");
const updateNotes = $("update-banner-notes");
const updateDownloadBtn = $("update-download");
const updateApplyBtn = $("update-apply");
const updateDismissBtn = $("update-dismiss");
const updateCheckBtn = $("update-check");
const updateVersionSelect = $("update-version-select");
const updateLogBtn = $("update-log");
const updateProgressWrap = $("update-progress-wrap");
const updateProgressBar = $("update-progress-bar");
const appVersionEl = $("app-version");

const UPDATE_RECHECK_MS = 6 * 60 * 60 * 1000;
const FIRST_CHECK_DELAY_MS = 2000;
const UPDATE_LOG_PATH = "%APPDATA%\\RiftboundOBS\\updates\\update.log";
let updateState = null;
let updateDismissedVersion = null;
let updateDismissedFailureAt = null;
let updateReleasesLoaded = false;

function selectedUpdateVersion() {
  return updateVersionSelect?.value || "latest";
}

function updateQueryString() {
  const version = selectedUpdateVersion();
  return version && version !== "latest" ? `?version=${encodeURIComponent(version)}` : "";
}

async function loadUpdateReleases() {
  if (!updateVersionSelect || updateReleasesLoaded) return;
  try {
    const info = await api("/api/update/releases");
    updateVersionSelect.innerHTML = `<option value="latest">Latest stable</option>`;
    for (const release of info.releases || []) {
      const opt = document.createElement("option");
      opt.value = release.version;
      opt.textContent = `${release.version}${release.prerelease ? " beta" : ""}`;
      opt.title = release.name || release.tag || release.version;
      updateVersionSelect.appendChild(opt);
    }
    updateVersionSelect.classList.toggle("hidden", !(info.releases || []).length);
    updateReleasesLoaded = true;
  } catch {
    updateVersionSelect.classList.add("hidden");
  }
}

function formatUpdateSize(state) {
  if (state.updateMode === "patch") return "~1 MB (light patch — available immediately)";
  if (state.updateMode === "installer" || state.forceFull) {
    if (state.installer?.size) return `~${Math.round(state.installer.size / (1024 * 1024))} MB (full installer)`;
    return "~80 MB (full installer)";
  }
  return "~1 MB (light patch)";
}

function formatApplyPhase(phase) {
  const labels = {
    validated: "Validated",
    shutting_down: "Shutting down",
    spawned: "Starting updater",
    waiting_app_exit: "Waiting for app to exit",
    extracting: "Extracting patch",
    applying: "Applying patch",
    rebuilding: "Rebuilding native modules",
    running_installer: "Running installer",
    restarting: "Restarting",
    success: "Complete",
    failed: "Failed",
  };
  return labels[phase] || phase || "Working";
}

function setUpdateProgress(percent) {
  if (!updateProgressWrap || !updateProgressBar) return;
  if (percent == null) {
    updateProgressWrap.classList.add("hidden");
    updateProgressBar.style.width = "0%";
    return;
  }
  updateProgressWrap.classList.remove("hidden");
  updateProgressBar.style.width = `${Math.max(0, Math.min(100, percent))}%`;
}

function setUpdateUi(state) {
  updateState = state;
  if (appVersionEl && state?.currentVersion) appVersionEl.textContent = `v${state.currentVersion}`;
  updateCheckBtn?.classList.toggle("hidden", !state?.supported);
  updateVersionSelect?.classList.toggle("hidden", !state?.supported || !updateReleasesLoaded);
  if (!updateBanner) return;

  if (!state?.supported) {
    updateBanner.classList.add("hidden");
    return;
  }

  if (state.lastApplyFailure && updateDismissedFailureAt !== state.lastApplyFailure.at) {
    updateBanner.classList.remove("hidden");
    updateTitle.textContent = "Update failed";
    updateDetail.textContent = state.lastApplyFailure.message || state.lastApplyFailure.error || "The last update attempt failed.";
    updateLogBtn?.classList.remove("hidden");
    updateNotes.textContent = `Log: ${state.lastApplyFailure.logPath || UPDATE_LOG_PATH}`;
    updateNotes.classList.remove("hidden");
    updateDownloadBtn.disabled = !state.updateAvailable && !state.downloaded?.ready;
    updateApplyBtn.disabled = !state.downloaded?.ready;
    if (state.downloaded?.ready) {
      updateApplyBtn.disabled = false;
      updateTitle.textContent = `Update v${state.downloaded.version} ready (retry)`;
      updateDetail.textContent =
        state.downloaded.mode === "installer"
          ? "Installer downloaded. Click Install & restart to retry."
          : "Patch downloaded. Click Install & restart to retry.";
    }
    return;
  }

  if (state.error && !state.updateAvailable && !state.downloaded?.ready) {
    updateBanner.classList.remove("hidden");
    updateTitle.textContent = "Update check failed";
    updateDetail.textContent = state.error;
    updateNotes.classList.add("hidden");
    updateDownloadBtn.disabled = true;
    updateApplyBtn.disabled = true;
    setUpdateProgress(null);
    return;
  }

  const showBanner =
    (state.updateAvailable || state.downloaded?.ready) &&
    updateDismissedVersion !== (state.downloaded?.version || state.latestVersion);

  if (!showBanner) {
    updateBanner.classList.add("hidden");
    setUpdateProgress(null);
    return;
  }

  updateBanner.classList.remove("hidden");
  updateLogBtn?.classList.toggle("hidden", !state.logPath);

  if (state.installType === "electron") {
    if (state.updateMode === "patch") {
      updateNotes.textContent = "Patch updates (~1 MB) are available immediately — no need to wait for the full installer.";
    } else if (state.forceFull) {
      updateNotes.textContent =
        "This release requires the full installer (Electron or native module change). User data in %APPDATA%\\RiftboundOBS is preserved.";
    } else {
      updateNotes.textContent = "User data in %APPDATA%\\RiftboundOBS is preserved during updates.";
    }
    updateNotes.classList.remove("hidden");
  } else if (state.installType === "portable" && state.installer) {
    updateNotes.textContent = "Tip: the Windows installer is recommended for more reliable updates. Download it from GitHub Releases when convenient.";
    updateNotes.classList.remove("hidden");
  }

  if (state.downloaded?.ready) {
    const modeLabel = state.downloaded.mode === "installer" ? "full installer" : "patch";
    updateTitle.textContent = `Update v${state.downloaded.version} ready`;
    updateDetail.textContent = `${modeLabel} downloaded. Click Install & restart.`;
    updateDownloadBtn.disabled = true;
    updateApplyBtn.disabled = false;
    setUpdateProgress(null);
  } else if (state.updateAvailable) {
    const modeLabel =
      state.updateMode === "patch"
        ? "Patch update (available immediately)"
        : state.updateMode === "installer" || state.forceFull
          ? "Full installer update"
          : "Update";
    updateTitle.textContent = `${modeLabel}: v${state.latestVersion} available`;
    if (state.updateBlockedReason) {
      updateDetail.textContent = state.updateBlockedReason;
      updateDownloadBtn.disabled = true;
    } else {
      const selected = state.selectedVersion && state.selectedVersion !== "latest" ? `Selected ${state.selectedVersion}. ` : "";
      updateDetail.textContent = `${selected}You are on v${state.currentVersion}. Download size ${formatUpdateSize(state)}.`;
      updateDownloadBtn.disabled = false;
    }
    updateApplyBtn.disabled = true;
    setUpdateProgress(null);
  }

  if (state.notes?.trim() && state.installType !== "portable" && state.installType !== "electron") {
    updateNotes.textContent = state.notes.trim();
    updateNotes.classList.remove("hidden");
  } else if (!state.installType || (state.installType !== "portable" && state.installType !== "electron")) {
    updateNotes.classList.add("hidden");
  }
}

async function pollApplyStatusWhileOnline() {
  for (let i = 0; i < 15; i++) {
    await new Promise((resolve) => setTimeout(resolve, 1000));
    try {
      const status = await api("/api/update/status");
      const phase = status.applyStatus?.phase;
      const msg = status.applyStatus?.message;
      if (phase && phase !== "validated") updateDetail.textContent = `${formatApplyPhase(phase)}… ${msg || ""}`.trim();
    } catch {
      return;
    }
  }
}

export async function checkUpdates() {
  try {
    await loadUpdateReleases();
    const state = await api(`/api/update/check${updateQueryString()}`);
    setUpdateUi(state);
    return state;
  } catch (err) {
    if (updateBanner) {
      updateBanner.classList.remove("hidden");
      updateTitle.textContent = "Update check failed";
      updateDetail.textContent = err.message;
      updateDownloadBtn.disabled = true;
      updateApplyBtn.disabled = true;
    }
    await showVersionOnly();
    return null;
  }
}

async function showVersionOnly() {
  if (!appVersionEl) return;
  try {
    const v = await api("/api/version");
    appVersionEl.textContent = v.version ? `v${v.version}` : "";
  } catch {
    /* ignore */
  }
}

async function pollDownloadProgress() {
  for (let i = 0; i < 120; i++) {
    await new Promise((resolve) => setTimeout(resolve, 500));
    try {
      const p = await api("/api/update/progress");
      if (p.status === "downloading") {
        const label = p.percent != null ? `${p.percent}%` : "…";
        updateDetail.textContent = `Downloading… ${label}`;
        setUpdateProgress(p.percent ?? (p.total ? Math.round((p.received / p.total) * 100) : 50));
      }
      if (p.status === "complete") {
        setUpdateProgress(100);
        return;
      }
    } catch {
      /* server may still be finishing */
    }
  }
}

function compareSemverClient(a, b) {
  const pa = String(a).split(".").map((n) => parseInt(n, 10) || 0);
  const pb = String(b).split(".").map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < 3; i++) {
    const da = pa[i] || 0;
    const db = pb[i] || 0;
    if (da > db) return 1;
    if (da < db) return -1;
  }
  return 0;
}

async function pollAfterUpdate(expectedVersion) {
  const maxAttempts = 120;
  for (let i = 0; i < maxAttempts; i++) {
    await new Promise((resolve) => setTimeout(resolve, 2000));
    try {
      const res = await fetch("/api/version", { cache: "no-store" });
      if (!res.ok) continue;
      const info = await res.json();
      if (expectedVersion && compareSemverClient(info.version, expectedVersion) < 0) {
        updateDetail.textContent = `Installing… waiting for v${expectedVersion} (${i + 1}/${maxAttempts})`;
        continue;
      }
      updateDetail.textContent = info.version ? `Updated to v${info.version}. Reloading…` : "Update complete. Reloading…";
      setTimeout(() => location.reload(), 800);
      return;
    } catch {
      updateDetail.textContent = `Installing silently… (${i + 1}/${maxAttempts})`;
    }
  }
  updateDetail.textContent = `Update did not finish in time. Launch Riftbound OBS manually, or check ${UPDATE_LOG_PATH}`;
  updateLogBtn?.classList.remove("hidden");
  updateApplyBtn.disabled = false;
}

export function initUpdates() {
  updateDownloadBtn?.addEventListener("click", async () => {
    updateDownloadBtn.disabled = true;
    updateDetail.textContent = "Downloading…";
    setUpdateProgress(0);
    const progressPoll = pollDownloadProgress();
    try {
      await api("/api/update/download", { method: "POST", body: { version: selectedUpdateVersion() } });
      await progressPoll;
      toast("Update downloaded", "ok");
      await checkUpdates();
    } catch (err) {
      toast(err.message, "err");
      updateDownloadBtn.disabled = false;
      setUpdateProgress(null);
      await checkUpdates();
    }
  });

  updateApplyBtn?.addEventListener("click", async () => {
    if (!confirm("Install the update and restart the app? The control panel will close briefly.")) return;
    updateApplyBtn.disabled = true;
    updateDetail.textContent = "Running preflight checks…";
    try {
      const preflight = await api("/api/update/preflight", { method: "POST", body: { applyToken: updateState?.applyToken } });
      if (!preflight.ok) throw new Error(preflight.errors?.join(" ") || "Preflight checks failed.");
      if (preflight.warnings?.length) toast(preflight.warnings.join(" "), "warn");
      const expectedVersion = updateState?.downloaded?.version || updateState?.latestVersion;
      updateDetail.textContent = "Installing…";
      const statusPoll = pollApplyStatusWhileOnline();
      const result = await api("/api/update/apply", { method: "POST", body: { applyToken: updateState?.applyToken } });
      await statusPoll.catch(() => {});
      updateDetail.textContent = "Installing silently…";
      pollAfterUpdate(result.expectedVersion || expectedVersion);
    } catch (err) {
      toast(err.message, "err");
      updateApplyBtn.disabled = false;
      await checkUpdates();
    }
  });

  updateLogBtn?.addEventListener("click", async () => {
    try {
      const info = await api("/api/update/log");
      const path = info.logPath || UPDATE_LOG_PATH;
      await navigator.clipboard.writeText(path);
      toast(`Log path copied: ${path}`, "ok");
      if (info.lines?.length) console.log("[update.log tail]\n" + info.lines.join("\n"));
    } catch {
      toast(`Log: ${UPDATE_LOG_PATH}`, "ok");
    }
  });

  updateDismissBtn?.addEventListener("click", () => {
    if (updateState?.lastApplyFailure) updateDismissedFailureAt = updateState.lastApplyFailure.at;
    else updateDismissedVersion = updateState?.downloaded?.version || updateState?.latestVersion;
    updateBanner?.classList.add("hidden");
  });

  updateCheckBtn?.addEventListener("click", async () => {
    updateCheckBtn.disabled = true;
    await checkUpdates();
    updateCheckBtn.disabled = false;
  });

  updateVersionSelect?.addEventListener("change", async () => {
    updateDismissedVersion = null;
    await checkUpdates();
  });

  // Show the version right away; defer the GitHub check so it never competes with first paint.
  showVersionOnly();
  const firstCheck = () => {
    if (navigator.onLine === false) return;
    checkUpdates();
  };
  if (typeof requestIdleCallback === "function") requestIdleCallback(firstCheck, { timeout: FIRST_CHECK_DELAY_MS * 2 });
  else setTimeout(firstCheck, FIRST_CHECK_DELAY_MS);

  setInterval(() => {
    if (document.visibilityState === "visible" && navigator.onLine !== false) checkUpdates();
  }, UPDATE_RECHECK_MS);
}
