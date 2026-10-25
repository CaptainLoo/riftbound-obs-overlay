/** Stream Deck tab: status card rendered from the worker status pushed over WebSocket. */
import { onAction, setText } from "./dom.js";
import { playerName } from "./players.js";
import { getData, setStreamDeckStatus, subscribeStreamDeck } from "./store.js";
import { toast } from "./toast.js";

const PHASE_LABELS = {
  loading: "Loading modules…",
  scanning: "Scanning for a Stream Deck…",
  opening: "Opening device…",
  drawing: "Drawing keys…",
  connected: "Connected",
  error: "Error",
  idle: "Waiting…",
};

const $ = (id) => document.getElementById(id);

function describe(info) {
  if (!info) return { tone: "warn", badge: "Checking…", detail: "", hint: "", progress: null };

  if (!info.supported) {
    return {
      tone: "muted",
      badge: "Not available on this install",
      detail: "Native Stream Deck control runs in the desktop app and in dev mode (npm start). Hot URLs under /api/hot/* work everywhere.",
      hint: "",
      progress: null,
    };
  }

  if (info.connected) {
    const parts = [];
    if (info.pageCount) parts.push(`Page ${(info.currentPage ?? 0) + 1} / ${info.pageCount}`);
    const pageName = info.pageNames?.[info.currentPage ?? 0];
    if (pageName) parts.push(pageName);
    if (info.firmwareVersion) parts.push(`FW ${info.firmwareVersion}`);

    let progress = null;
    if (info.cardPrefetch && info.cardPrefetch.total > 0 && info.cardPrefetch.done < info.cardPrefetch.total) {
      progress = { label: "Caching card images", done: info.cardPrefetch.done, total: info.cardPrefetch.total };
    } else if (info.drawProgress && !info.drawProgress.partial && info.drawProgress.total > 0 && info.drawProgress.done < info.drawProgress.total) {
      const phase = info.drawProgress.phase === "upload" ? "uploading" : info.drawProgress.phase === "render" ? "rendering" : "loading";
      progress = { label: `Loading key images (${phase})`, done: info.drawProgress.done, total: info.drawProgress.total };
    } else if (info.imageUploadOk === false) {
      parts.push("Colors only (upload failed)");
    } else if (info.imagesDegraded && info.hint) {
      parts.push("Colors only");
    } else if (info.cardsTotal > 0 && info.cardsReady === info.cardsTotal) {
      parts.push(`${info.cardsReady} card images ready`);
    }

    let hint = info.hint || "";
    if (!hint && info.imageUploadOk === false && info.imageUploadError) hint = `Upload probe failed: ${info.imageUploadError}`;
    if (!hint && info.cardsMissing?.length) hint = `${info.cardsMissing.length} card image(s) missing — re-import the deck or click Refresh images.`;
    if (!hint && info.imagesDegraded) hint = "Some keys show colors only — buttons still work.";

    return { tone: "ok", badge: `Connected — ${info.productName || "Stream Deck"}`, detail: parts.join(" · "), hint, progress };
  }

  const busy = ["loading", "scanning", "opening", "drawing"].includes(info.phase);
  if (info.phase === "error" || (info.error && !busy)) {
    let detail = info.error || "Stream Deck connection failed.";
    if (info.devicesFound?.length) detail += ` (HID scan: ${info.devicesFound.length} device(s))`;
    return { tone: "err", badge: "Not connected", detail, hint: info.hint || "Click Reconnect. If this persists, restart the app.", progress: null };
  }
  if (info.worker || busy) {
    const parts = [PHASE_LABELS[info.phase] || info.phase || "Waiting…"];
    if (info.devicesFound?.length) parts.push(`${info.devicesFound.length} HID device(s)`);
    return { tone: "warn", badge: "Connecting…", detail: parts.join(" · "), hint: info.hint || "This can take up to 15 seconds.", progress: null };
  }
  return {
    tone: "warn",
    badge: "Not detected",
    detail: info.devicesFound?.length ? `HID scan found ${info.devicesFound.length} device(s). Click Reconnect.` : "Plug in your Stream Deck and click Reconnect.",
    hint: info.hint || "",
    progress: null,
  };
}

export function renderStreamDeck(info) {
  const badge = $("sd-hid-status");
  if (!badge) return;
  const view = describe(info);
  setText(badge, view.badge);
  badge.className = `status-badge tone-${view.tone}`;
  setText($("sd-hid-detail"), view.detail);
  setText($("sd-hid-hint"), view.hint);
  $("sd-hid-hint")?.classList.toggle("hidden", !view.hint);

  const bar = $("sd-progress");
  if (bar) {
    bar.classList.toggle("hidden", !view.progress);
    if (view.progress) {
      setText($("sd-progress-label"), `${view.progress.label} ${view.progress.done}/${view.progress.total}`);
      $("sd-progress-bar").style.width = `${Math.round((view.progress.done / view.progress.total) * 100)}%`;
    }
  }
  const canAct = Boolean(info?.supported);
  const reconnect = $("sd-reconnect");
  const refresh = $("sd-refresh-images");
  if (reconnect && !reconnect.dataset.busy) reconnect.disabled = !canAct;
  if (refresh && !refresh.dataset.busy) refresh.disabled = !canAct || !info?.connected;
}

export function renderStreamDeckDeck() {
  const el = $("sd-deck-status");
  const data = getData();
  if (!el || !data) return;
  const counts = ["p1", "p2"].map((id) => {
    const p = data.players.find((x) => x.id === id);
    return `${playerName(id)}: ${p?.displayCards?.length ?? 0} cards`;
  });
  setText(el, `Deck keys — ${counts.join(" · ")}. Keys refresh automatically after deck changes.`);
}

async function withBusy(btn, label, fn) {
  if (!btn) return fn();
  const prev = btn.textContent;
  btn.dataset.busy = "1";
  btn.disabled = true;
  btn.textContent = label;
  try {
    await fn();
  } finally {
    delete btn.dataset.busy;
    btn.disabled = false;
    btn.textContent = prev;
    renderStreamDeck(getDataStatus());
  }
}

function getDataStatus() {
  let s = null;
  const unsub = subscribeStreamDeck((v) => (s = v));
  unsub();
  return s;
}

export async function initStreamDeck() {
  onAction("click", "sd-reconnect", (btn) =>
    withBusy(btn, "Reconnecting…", async () => {
      const res = await fetch("/api/streamdeck/reconnect", { method: "POST" });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || res.statusText || "Reconnect failed");
      setStreamDeckStatus(body);
      if (body.connected) toast("Stream Deck connected");
      else if (body.error) toast(body.error, "err");
      else toast("Stream Deck not detected", "warn");
    })
  );
  onAction("click", "sd-refresh-images", (btn) =>
    withBusy(btn, "Refreshing…", async () => {
      const res = await fetch("/api/streamdeck/refresh-images", { method: "POST" });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || res.statusText || "Refresh failed");
      toast("Refreshing Stream Deck images…");
    })
  );

  subscribeStreamDeck(renderStreamDeck);
  // One initial read; afterwards the server pushes every change over WebSocket.
  try {
    const res = await fetch("/api/streamdeck");
    if (res.ok) setStreamDeckStatus(await res.json());
  } catch {
    renderStreamDeck(null);
  }
}
