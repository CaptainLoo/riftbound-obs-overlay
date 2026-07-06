import { getActiveGameData } from "./db.js";
import { buildPages, detectDeviceKey } from "./streamdeckLayout.js";
import {
  collectPageCardIds,
  collectStreamDeckCardIds,
  countReadyAssets,
  ensureCardAssets,
} from "./streamdeckCardAssets.js";
import { warmAdjacentPages, warmAdjacentPanelPages } from "./streamdeckImageWarm.js";
import { renderPagePanel } from "./streamdeckPanel.js";
import {
  clearPanelHidCache,
  getCachedPanelPrepared,
  panelCacheKey,
  preparePanelUpload,
  setCachedPanelPrepared,
  uploadPreparedPanel,
} from "./streamdeckHidCache.js";
import {
  classifyStreamDeckRefresh,
  findChangedControlKeyIndices,
  fingerprintPageVisual,
  snapshotRevision,
} from "./streamdeckRevision.js";
import { logStartup } from "./startupLog.js";
import {
  defaultStreamDeckStatus,
  formatStreamDeckError,
  resetStreamDeckStatusPatch,
} from "./streamdeck/status.js";

const DEFAULT_PORT = Number(process.env.PORT) || 7474;
const API = `http://127.0.0.1:${DEFAULT_PORT}/api`;
const KEY_RENDER_TIMEOUT_MS = 8000;
const KEY_UPLOAD_TIMEOUT_MS = 20000;
const PANEL_UPLOAD_TIMEOUT_MS = 30000;
const PROBE_UPLOAD_TIMEOUT_MS = 5000;
const RENDER_CONCURRENCY = 4;
const PARTIAL_KEY_THRESHOLD = 6;
const HID_PACKET_BATCH = 4;
const CARD_KEY_TYPES = new Set(["showCard", "battlefield"]);

let nodeLib = null;
let imagesMod = null;
let statusListener = null;

async function loadNodeLib() {
  if (!nodeLib) {
    nodeLib = await import("@elgato-stream-deck/node");
  }
  return nodeLib;
}

async function loadImagesMod() {
  if (!imagesMod) {
    imagesMod = await import("./streamdeckImages.js");
  }
  return imagesMod;
}

let deck = null;
let pages = [];
let currentPageIndex = 0;
let deviceKey = "xl";
let keySize = 96;
let refreshTimer = null;
let refreshInFlight = false;
let status = defaultStreamDeckStatus();

let lastRevision = null;
let imageDrawGeneration = 0;
let imageDrawInFlight = false;

function setStatus(patch) {
  status = { ...status, ...patch };
  statusListener?.(getStreamDeckStatus());
}

export function setStreamDeckStatusListener(fn) {
  statusListener = fn;
}

const formatError = formatStreamDeckError;

export async function preflightNativeModules() {
  setStatus({ phase: "loading", error: null, connected: false });
  try {
    await import("@elgato-stream-deck/node");
    await import("sharp");
    return true;
  } catch (err) {
    setStatus({
      phase: "error",
      connected: false,
      error: `Stream Deck native module failed to load: ${formatError(err)}. Reinstall Riftbound OBS.`,
    });
    throw err;
  }
}

function apiUrl(path) {
  return `${API}${path.startsWith("/") ? path : `/${path}`}`;
}

async function apiGet(path) {
  const res = await fetch(apiUrl(path));
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(text || `HTTP ${res.status}`);
  }
  return res.json().catch(() => ({}));
}

async function apiPost(path, body = {}) {
  const res = await fetch(apiUrl(path), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(text || `HTTP ${res.status}`);
  }
  return res.json().catch(() => ({}));
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function yieldToEventLoop() {
  return new Promise((r) => setImmediate(r));
}

function withTimeout(promise, ms, label) {
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
    }),
  ]);
}

function unwrapPreparedBuffer(modelId, prepared) {
  if (prepared.modelId !== modelId) {
    throw new Error("Prepared buffer is for a different model!");
  }
  return prepared.do_not_touch.map((b) => {
    if (typeof b === "string") return Buffer.from(b, "base64");
    if (b instanceof Uint8Array) return b;
    throw new Error("Prepared buffer is not a string or Uint8Array!");
  });
}

function getHidDevice() {
  return deck?.device?.device ?? null;
}

async function fillKeyBufferYielding(keyIndex, rgb, options) {
  const prepared = await deck.prepareFillKeyBuffer(keyIndex, rgb, options);
  const packets = unwrapPreparedBuffer(deck.MODEL, prepared);
  const hidDevice = getHidDevice();

  if (!hidDevice?.sendReports) {
    await deck.fillKeyBuffer(keyIndex, rgb, options);
    return;
  }

  for (const packet of packets) {
    await hidDevice.sendReports([packet]);
    await yieldToEventLoop();
  }
}

async function sendPreparedPacketsYielding(deck, prepared) {
  const packets = unwrapPreparedBuffer(deck.MODEL, prepared);
  const hidDevice = getHidDevice();

  if (!hidDevice?.sendReports) {
    await deck.sendPreparedBuffer(prepared);
    return;
  }

  for (let i = 0; i < packets.length; i += HID_PACKET_BATCH) {
    await hidDevice.sendReports(packets.slice(i, i + HID_PACKET_BATCH));
    await yieldToEventLoop();
  }
}

async function fillKeyBufferWithFallback(keyIndex, rgb, options) {
  try {
    await fillKeyBufferYielding(keyIndex, rgb, options);
  } catch (yieldErr) {
    logStartup(`[streamdeck] Key ${keyIndex} yielding upload failed, retrying native: ${yieldErr.message}`);
    await deck.fillKeyBuffer(keyIndex, rgb, options);
  }
}

async function probeKeyImageUpload() {
  if (!deck) return { ok: false, error: "No device" };
  const controls = deck.CONTROLS.filter((c) => c.type === "button");
  const probeIndex = controls[0]?.index ?? 0;
  try {
    const { renderLabelImage } = await loadImagesMod();
    const rgb = await renderLabelImage("OK", "game", keySize);
    await withTimeout(
      fillKeyBufferWithFallback(probeIndex, rgb, { format: "rgb" }),
      PROBE_UPLOAD_TIMEOUT_MS,
      "Image upload probe"
    );
    logStartup(`[streamdeck] Image upload probe OK (key ${probeIndex})`);
    return { ok: true, error: null };
  } catch (err) {
    logStartup(`[streamdeck] Image upload probe failed: ${err.message}`);
    return { ok: false, error: err.message };
  }
}

function buildDrawHint({ failed, drawn, imageUploadOk, cardsMissing }) {
  if (imageUploadOk === false) {
    return "Key image upload unavailable — buttons work with colors only. Reinstall Riftbound OBS.";
  }
  if (cardsMissing?.length) {
    const n = cardsMissing.length;
    return `${n} card image${n > 1 ? "s" : ""} missing — re-import deck or click Refresh images.`;
  }
  if (failed > 0) {
    return `${failed} key(s) show colors only — buttons still work. Reinstall the app for full labels.`;
  }
  if (drawn === 0) {
    return "Key labels unavailable — buttons work with colors only.";
  }
  return null;
}

async function prefetchCardAssets(cardIds) {
  if (!cardIds.length) {
    setStatus({ cardPrefetch: null, cardsReady: 0, cardsTotal: 0, cardsMissing: [] });
    return { ready: 0, total: 0, missing: [] };
  }

  setStatus({ cardPrefetch: { done: 0, total: cardIds.length } });
  const result = await ensureCardAssets(cardIds, (progress) => {
    setStatus({ cardPrefetch: progress });
  });

  if (result.repairedIds?.length) {
    const { invalidateCardCache } = await loadImagesMod();
    for (const id of result.repairedIds) {
      invalidateCardCache(id);
    }
  }

  setStatus({
    cardPrefetch: null,
    cardsReady: result.ready,
    cardsTotal: result.total,
    cardsMissing: result.missing.slice(0, 5),
  });
  return result;
}

async function prefetchForCurrentContext() {
  const allIds = collectStreamDeckCardIds(getActiveGameData(), deviceKey);
  const page = pages[currentPageIndex];
  const pageIds = page ? collectPageCardIds(page) : [];
  const priorityIds = [...new Set([...pageIds, ...allIds])];
  return prefetchCardAssets(priorityIds);
}

let prefetchInFlight = false;
let prefetchQueued = false;

async function schedulePrefetchAndDraw() {
  if (prefetchInFlight) {
    prefetchQueued = true;
    return;
  }
  prefetchInFlight = true;
  try {
    do {
      prefetchQueued = false;
      if (status.imageUploadOk === false) return;
      await prefetchForCurrentContext();
      scheduleImageDraw();
    } while (prefetchQueued);
  } catch (err) {
    console.error("[streamdeck] Card prefetch failed:", err.message);
    logStartup("[streamdeck] Card prefetch failed", err);
    scheduleImageDraw();
  } finally {
    prefetchInFlight = false;
  }
}

async function flashKey(keyIndex, r, g, b) {
  if (!deck) return;
  try {
    await deck.fillKeyColor(keyIndex, r, g, b);
    setTimeout(() => {
      drawCurrentPageColorsOnly()
        .then(() => scheduleImageDraw())
        .catch(() => {});
    }, 180);
  } catch {
    /* ignore */
  }
}

async function handleKeyAction(keyDef, keyIndex) {
  const s = keyDef.settings || {};
  try {
    switch (keyDef.type) {
      case "navPrev":
        if (currentPageIndex > 0) {
          currentPageIndex -= 1;
          await drawCurrentPage();
          setStatus({ currentPage: currentPageIndex });
        }
        return;
      case "navNext":
        if (currentPageIndex < pages.length - 1) {
          currentPageIndex += 1;
          await drawCurrentPage();
          setStatus({ currentPage: currentPageIndex });
        }
        return;
      case "hideAll":
        await apiGet("/hot/clear");
        return;
      case "hidePlayer":
        await apiGet(`/hot/clear/${s.player || "p1"}`);
        return;
      case "matchup":
        await apiGet("/hot/matchup");
        return;
      case "resetMatch":
        await apiPost("/match/reset", {});
        return;
      case "winGame":
        await apiGet(`/hot/win/${s.player || "p1"}`);
        return;
      case "selectGame":
        await apiPost("/match", { currentGame: Number(s.index) || 0 });
        return;
      case "battlefield":
        await apiGet(`/hot/battlefield/${s.player}/${encodeURIComponent(s.cardId)}`);
        return;
      case "gamePoint": {
        const op = Number(s.delta) < 0 ? "dec" : "inc";
        await apiGet(`/hot/score/${s.player}/${op}`);
        return;
      }
      case "showCard":
        if (s.cardId) {
          await apiGet(`/hot/card/${s.player}/${encodeURIComponent(s.cardId)}`);
        } else if (typeof s.index === "number") {
          await apiGet(`/hot/card/${s.player}/index/${s.index}`);
        }
        return;
      default:
        console.warn("[streamdeck] Unknown key type:", keyDef.type);
    }
  } catch (err) {
    console.error("[streamdeck] Key action failed:", err.message);
    await flashKey(keyIndex, 255, 60, 60);
  }
}

async function drawCurrentPageColorsOnly() {
  if (!deck || !pages.length) return;
  const page = pages[currentPageIndex];
  if (!page) return;

  const { getIconColorForKeyDef } = await loadImagesMod();
  const controls = deck.CONTROLS.filter((c) => c.type === "button");
  const validIndices = new Set(controls.map((c) => c.index));

  for (const idx of validIndices) {
    if (!page.keys.has(idx)) {
      await deck.fillKeyColor(idx, 0, 0, 0);
    }
  }

  for (const [idx, keyDef] of page.keys.entries()) {
    if (!validIndices.has(idx)) continue;
    const [r, g, b] = getIconColorForKeyDef(keyDef);
    await deck.fillKeyColor(idx, r, g, b);
  }
}

async function fillKeyWithColorFallback(keyIndex, keyDef) {
  const { getIconColorForKeyDef } = await loadImagesMod();
  const [r, g, b] = getIconColorForKeyDef(keyDef);
  await deck.fillKeyColor(keyIndex, r, g, b);
}

function scheduleAdjacentWarm() {
  if (!deck || !pages.length || status.imageUploadOk === false) return;
  setImmediate(async () => {
    try {
      const { renderKeyImage, getIconColorForKeyDef } = await loadImagesMod();
      await warmAdjacentPages(pages, currentPageIndex, getActiveGameData().cardsCache, keySize, renderKeyImage);
      if (typeof deck.fillPanelBuffer === "function") {
        await warmAdjacentPanelPages(
          deck,
          pages,
          currentPageIndex,
          getActiveGameData().cardsCache,
          renderKeyImage,
          getIconColorForKeyDef
        );
      }
    } catch (err) {
      logStartup(`[streamdeck] adjacent warm failed: ${err.message}`);
    }
  });
}

async function renderKeysBatch(indices, page, generation, { onProgress } = {}) {
  const { renderKeyImage } = await loadImagesMod();
  const expectedBytes = keySize * keySize * 3;
  const results = new Map();
  let next = 0;

  const workers = Array.from(
    { length: Math.min(RENDER_CONCURRENCY, indices.length) },
    async () => {
      while (next < indices.length) {
        if (generation !== imageDrawGeneration) return;
        const slot = next++;
        const idx = indices[slot];
        const keyDef = page.keys.get(idx);
        if (!keyDef) continue;

        try {
          const rgb = await withTimeout(
            renderKeyImage(keyDef, getActiveGameData().cardsCache, keySize),
            KEY_RENDER_TIMEOUT_MS,
            `Key ${idx} render`
          );
          if (rgb.length !== expectedBytes) {
            throw new Error(`expected ${expectedBytes} bytes, got ${rgb.length}`);
          }
          results.set(idx, { idx, rgb, keyDef, ok: true });
        } catch (err) {
          results.set(idx, { idx, keyDef, ok: false, error: err });
        }
        onProgress?.(idx);
      }
    }
  );

  await Promise.all(workers);
  return indices.map((idx) => results.get(idx)).filter(Boolean);
}

async function drawKeyIndices(keyIndices, generation, { showProgress = true, partial = false, uploadMode = "keys" } = {}) {
  if (!deck || !pages.length || !keyIndices.length) {
    return { drawn: 0, failed: 0, cancelled: false };
  }
  if (status.imageUploadOk === false) {
    return { drawn: 0, failed: 0, cancelled: false };
  }

  const page = pages[currentPageIndex];
  if (!page) return { drawn: 0, failed: 0, cancelled: false };

  const controls = deck.CONTROLS.filter((c) => c.type === "button");
  const validIndices = new Set(controls.map((c) => c.index));
  const indices = keyIndices.filter((idx) => validIndices.has(idx) && page.keys.has(idx));
  const total = indices.length;
  let drawn = 0;
  let failed = 0;

  if (showProgress && total > 0) {
    setStatus({
      drawProgress: { done: 0, total, failed: 0, phase: "render", partial },
      uploadMode,
      imagesReady: false,
      imagesDegraded: false,
      hint: null,
    });
  }

  if (generation !== imageDrawGeneration) {
    return { drawn: 0, failed: 0, cancelled: true };
  }

  let renderedDone = 0;
  const batch = await renderKeysBatch(indices, page, generation, {
    onProgress: () => {
      renderedDone += 1;
      if (showProgress) {
        setStatus({
          drawProgress: {
            done: 0,
            total,
            failed: 0,
            phase: "render",
            partial,
            renderDone: renderedDone,
          },
        });
      }
    },
  });

  if (generation !== imageDrawGeneration) {
    return { drawn: 0, failed: 0, cancelled: true };
  }

  for (const item of batch) {
    if (generation !== imageDrawGeneration) {
      return { drawn, failed, cancelled: true };
    }

    const { idx, keyDef } = item;

    if (!item.ok) {
      failed += 1;
      console.error(`[streamdeck] Key ${idx} image failed, using color:`, item.error?.message);
      logStartup(`[streamdeck] Key ${idx} image failed: ${item.error?.message}`);
      try {
        await fillKeyWithColorFallback(idx, keyDef);
      } catch (fallbackErr) {
        console.error(`[streamdeck] Key ${idx} color fallback failed:`, fallbackErr.message);
      }
      if (showProgress) {
        setStatus({
          drawProgress: { done: drawn + failed, total, failed, current: idx, phase: "upload", partial },
        });
      }
      await yieldToEventLoop();
      continue;
    }

    if (showProgress) {
      setStatus({
        drawProgress: { done: drawn + failed, total, failed, current: idx, phase: "upload", partial },
      });
    }

    try {
      await withTimeout(
        fillKeyBufferWithFallback(idx, item.rgb, { format: "rgb" }),
        KEY_UPLOAD_TIMEOUT_MS,
        `Key ${idx} upload`
      );
      drawn += 1;
    } catch (err) {
      failed += 1;
      console.error(`[streamdeck] Key ${idx} upload failed, using color:`, err.message);
      logStartup(`[streamdeck] Key ${idx} upload failed: ${err.message}`);
      try {
        await fillKeyWithColorFallback(idx, keyDef);
      } catch (fallbackErr) {
        console.error(`[streamdeck] Key ${idx} color fallback failed:`, fallbackErr.message);
      }
    }

    if (showProgress) {
      setStatus({
        drawProgress: { done: drawn + failed, total, failed, current: idx, phase: "upload", partial },
      });
    }
    await yieldToEventLoop();
  }

  if (generation !== imageDrawGeneration) {
    return { drawn, failed, cancelled: true };
  }

  if (showProgress) {
    const imagesDegraded = failed > 0 || status.cardsMissing.length > 0;
    const imagesReady = drawn > 0 || status.imagesReady;
    setStatus({
      drawProgress: null,
      imagesReady,
      imagesDegraded: partial ? status.imagesDegraded && failed > 0 : imagesDegraded,
      imagesDrawnCount: (status.imagesDrawnCount || 0) + drawn,
      imagesFailedCount: (status.imagesFailedCount || 0) + failed,
      hint: buildDrawHint({
        failed,
        drawn,
        imageUploadOk: status.imageUploadOk,
        cardsMissing: status.cardsMissing,
      }),
    });
  }

  return { drawn, failed, cancelled: false };
}

async function drawCurrentPageViaPanel(generation, { showProgress = true } = {}) {
  if (!deck || !pages.length) return { drawn: 0, failed: 0, cancelled: false };
  if (status.imageUploadOk === false) {
    return { drawn: 0, failed: 0, cancelled: false };
  }

  const page = pages[currentPageIndex];
  if (!page) return { drawn: 0, failed: 0, cancelled: false };

  const pageIds = collectPageCardIds(page);
  if (pageIds.length) {
    const { ready, total } = countReadyAssets(pageIds);
    if (ready < total) {
      await prefetchCardAssets(pageIds);
    }
  }

  if (generation !== imageDrawGeneration) {
    return { drawn: 0, failed: 0, cancelled: true };
  }

  const revision = fingerprintPageVisual(page);
  const cacheKey = panelCacheKey(currentPageIndex, revision);
  let prepared = getCachedPanelPrepared(cacheKey);

  const timings = { panelRenderMs: 0, panelEncodeMs: 0, panelUploadMs: 0 };

  if (!prepared) {
    if (showProgress) {
      setStatus({
        drawProgress: { done: 0, total: 1, failed: 0, phase: "render", partial: false },
        uploadMode: "panel",
        imagesReady: false,
        hint: null,
      });
    }

    const t0 = Date.now();
    const { renderKeyImage, getIconColorForKeyDef } = await loadImagesMod();
    const rgbPanel = await renderPagePanel(
      deck,
      page,
      getActiveGameData().cardsCache,
      renderKeyImage,
      getIconColorForKeyDef,
      { concurrency: RENDER_CONCURRENCY }
    );
    timings.panelRenderMs = Date.now() - t0;

    if (generation !== imageDrawGeneration) {
      return { drawn: 0, failed: 0, cancelled: true };
    }

    const t1 = Date.now();
    prepared = await preparePanelUpload(deck, rgbPanel);
    timings.panelEncodeMs = Date.now() - t1;
    setCachedPanelPrepared(cacheKey, prepared);
  }

  if (showProgress) {
    setStatus({
      drawProgress: { done: 0, total: 1, failed: 0, phase: "upload", partial: false },
      uploadMode: "panel",
    });
  }

  const t2 = Date.now();
  await withTimeout(
    sendPreparedPacketsYielding(deck, prepared),
    PANEL_UPLOAD_TIMEOUT_MS,
    "Panel upload"
  );
  timings.panelUploadMs = Date.now() - t2;

  if (generation !== imageDrawGeneration) {
    return { drawn: 0, failed: 0, cancelled: true };
  }

  const buttonCount = deck.CONTROLS.filter((c) => c.type === "button" && c.feedbackType === "lcd").length;

  if (showProgress) {
    setStatus({
      drawProgress: null,
      imagesReady: true,
      imagesDegraded: status.cardsMissing.length > 0,
      imagesDrawnCount: buttonCount,
      uploadMode: "panel",
      panelRenderMs: timings.panelRenderMs,
      panelEncodeMs: timings.panelEncodeMs,
      panelUploadMs: timings.panelUploadMs,
      hint: buildDrawHint({
        failed: 0,
        drawn: buttonCount,
        imageUploadOk: status.imageUploadOk,
        cardsMissing: status.cardsMissing,
      }),
    });
  }

  return { drawn: buttonCount, failed: 0, cancelled: false };
}

async function drawCurrentPageImages(generation) {
  if (!deck || !pages.length) return { drawn: 0, failed: 0, cancelled: false };
  if (status.imageUploadOk === false) {
    setStatus({
      drawProgress: null,
      imagesReady: false,
      imagesDegraded: true,
      imagesDrawnCount: 0,
      imagesFailedCount: 0,
      hint: buildDrawHint({ failed: 0, drawn: 0, imageUploadOk: false, cardsMissing: status.cardsMissing }),
    });
    return { drawn: 0, failed: 0, cancelled: false };
  }

  const page = pages[currentPageIndex];
  if (!page) return { drawn: 0, failed: 0, cancelled: false };

  const pageIds = collectPageCardIds(page);
  if (pageIds.length) {
    const { ready, total } = countReadyAssets(pageIds);
    if (ready < total) {
      await prefetchCardAssets(pageIds);
    }
  }

  const controls = deck.CONTROLS.filter((c) => c.type === "button");
  const validIndices = new Set(controls.map((c) => c.index));
  const keyIndices = [...page.keys.keys()]
    .filter((idx) => validIndices.has(idx))
    .sort((a, b) => {
      const typeA = page.keys.get(a)?.type;
      const typeB = page.keys.get(b)?.type;
      const aCard = CARD_KEY_TYPES.has(typeA) ? 0 : 1;
      const bCard = CARD_KEY_TYPES.has(typeB) ? 0 : 1;
      return aCard - bCard;
    });

  if (keyIndices.length > PARTIAL_KEY_THRESHOLD && typeof deck.fillPanelBuffer === "function") {
    return drawCurrentPageViaPanel(generation, { showProgress: true });
  }

  return drawKeyIndices(keyIndices, generation, { showProgress: true, partial: false, uploadMode: "keys" });
}

async function drawKeysPartial(keyIndices, { skipProgress = true } = {}) {
  if (!deck || !keyIndices.length || status.imageUploadOk === false) return;
  imageDrawGeneration += 1;
  const gen = imageDrawGeneration;
  await drawKeyIndices(keyIndices, gen, { showProgress: !skipProgress, partial: true });
}

async function runImageDraw(generation) {
  if (!deck || generation !== imageDrawGeneration) return;
  imageDrawInFlight = true;
  let cancelled = false;
  try {
    const result = await drawCurrentPageImages(generation);
    cancelled = result.cancelled;
  } catch (err) {
    console.error("[streamdeck] Background image draw failed:", err.message);
    logStartup("[streamdeck] Background image draw failed", err);
    if (generation === imageDrawGeneration) {
      setStatus({
        drawProgress: null,
        imagesDegraded: true,
        hint: "Key image loading failed — buttons work with colors only.",
      });
    }
  } finally {
    imageDrawInFlight = false;
    if (!cancelled && generation === imageDrawGeneration) {
      scheduleAdjacentWarm();
    }
    if (deck && generation !== imageDrawGeneration) {
      runImageDraw(imageDrawGeneration);
    }
  }
}

function scheduleImageDraw() {
  if (!deck) return;
  imageDrawGeneration += 1;
  const gen = imageDrawGeneration;
  if (!imageDrawInFlight) {
    runImageDraw(gen);
  }
}

async function drawCurrentPage() {
  if (!deck || !pages.length) return;
  await drawCurrentPageColorsOnly();
  scheduleImageDraw();
}

async function rebuildPages(resetPage = false) {
  if (!deck) return;
  deviceKey = detectDeviceKey(deck);
  pages = buildPages(getActiveGameData(), deviceKey);
  if (resetPage || currentPageIndex >= pages.length) currentPageIndex = 0;
  setStatus({
    deviceKey,
    pageCount: pages.length,
    pageNames: pages.map((p) => p.name),
    currentPage: currentPageIndex,
  });
  await drawCurrentPage();
}

export async function refreshStreamDeck(force = false) {
  if (!deck) return;
  if (refreshInFlight) return;
  refreshInFlight = true;
  try {
    deviceKey = detectDeviceKey(deck);
    const oldPages = pages;
    const mode = force ? "full" : classifyStreamDeckRefresh(lastRevision, getActiveGameData(), deviceKey);

    if (mode === "skip" && !force) {
      setStatus({ refreshMode: "skip" });
      return;
    }

    if (force) {
      const { clearImageCaches } = await loadImagesMod();
      clearImageCaches();
      clearPanelHidCache();
    }

    pages = buildPages(getActiveGameData(), deviceKey);
    if (currentPageIndex >= pages.length) currentPageIndex = 0;
    lastRevision = snapshotRevision(getActiveGameData(), deviceKey);

    setStatus({
      deviceKey,
      pageCount: pages.length,
      pageNames: pages.map((p) => p.name),
      currentPage: currentPageIndex,
      error: null,
      phase: "connected",
      refreshMode: mode,
    });

    if (force || mode === "full") {
      await drawCurrentPageColorsOnly();
      await schedulePrefetchAndDraw();
      return;
    }

    if (mode === "partial") {
      if (currentPageIndex === 0) {
        const changed = findChangedControlKeyIndices(oldPages[0], pages[0]);
        if (changed.length) {
          await drawKeysPartial(changed);
        }
      }
      return;
    }
  } catch (err) {
    console.error("[streamdeck] Refresh failed:", err);
    setStatus({ error: formatError(err), phase: "error" });
  } finally {
    refreshInFlight = false;
  }
}

export function refreshStreamDeckIfConnected() {
  if (!deck) return;
  clearTimeout(refreshTimer);
  refreshTimer = setTimeout(() => {
    refreshStreamDeck(false).catch((err) => console.error("[streamdeck]", err));
  }, 300);
}

export function getStreamDeckStatus() {
  return { ...status };
}

async function scanStreamDecks(maxAttempts = 6, delayMs = 1500) {
  setStatus({ phase: "scanning", error: null });
  const { listStreamDecks } = await loadNodeLib();
  let lastErr = null;
  let devices = [];

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      devices = await listStreamDecks();
      const summary = devices.map((d) => ({
        path: d.path,
        model: d.model,
        serialNumber: d.serialNumber ?? null,
      }));
      setStatus({
        devicesFound: summary,
        lastScanAt: new Date().toISOString(),
        error: devices.length ? null : status.error,
      });
      if (devices.length) return devices;
      lastErr = null;
    } catch (err) {
      lastErr = err;
      console.error(`[streamdeck] Scan attempt ${attempt} failed:`, err.message);
      setStatus({
        lastScanAt: new Date().toISOString(),
        devicesFound: [],
      });
    }
    if (attempt < maxAttempts) await sleep(delayMs);
  }

  if (lastErr) throw lastErr;
  return devices;
}

export async function startStreamDeck() {
  if (!status.supported) {
    setStatus({ connected: false, error: null, phase: "idle" });
    return;
  }
  if (deck) return;

  try {
    await preflightNativeModules();
    const { DeviceModelId, openStreamDeck } = await loadNodeLib();
    const { encodeJpegWithSharp } = await loadImagesMod();
    const devices = await scanStreamDecks();
    if (!devices.length) {
      setStatus({
        connected: false,
        phase: "error",
        error:
          "No Stream Deck detected. Plug in your device, then click Reconnect.",
      });
      return;
    }

    setStatus({ phase: "opening", error: null });

    const preferred =
      devices.find((d) => d.model === DeviceModelId.XL) ||
      devices.find((d) => d.model === DeviceModelId.ORIGINALV2) ||
      devices.find((d) => d.model === DeviceModelId.MINI) ||
      devices[0];

    deck = await openStreamDeck(preferred.path, { encodeJPEG: encodeJpegWithSharp });
    const buttonControl = deck.CONTROLS.find((c) => c.type === "button" && c.feedbackType === "lcd");
    keySize = buttonControl?.pixelSize?.width || 96;

    deck.on("error", (err) => {
      console.error("[streamdeck] Device error:", err);
      setStatus({ error: formatError(err), connected: false, phase: "error" });
    });

    deck.on("down", (control) => {
      if (control.type !== "button") return;
      const page = pages[currentPageIndex];
      const keyDef = page?.keys.get(control.index);
      if (!keyDef) {
        logStartup(
          `[streamdeck] Unmapped key press index=${control.index} page=${currentPageIndex}`
        );
        return;
      }
      logStartup(`[streamdeck] Key down index=${control.index} type=${keyDef.type}`);
      handleKeyAction(keyDef, control.index).catch((err) => console.error("[streamdeck]", err));
    });

    await deck.setBrightness(100);
    await deck.clearPanel();

    const [serialNumber, firmwareVersion] = await Promise.all([
      deck.getSerialNumber().catch(() => null),
      deck.getFirmwareVersion().catch(() => null),
    ]);

    deviceKey = detectDeviceKey(deck);
    currentPageIndex = 0;
    pages = buildPages(getActiveGameData(), deviceKey);
    lastRevision = snapshotRevision(getActiveGameData(), deviceKey);

    setStatus({
      error: null,
      model: preferred.model,
      productName: deck.PRODUCT_NAME,
      serialNumber,
      firmwareVersion,
      deviceKey,
      pageCount: pages.length,
      pageNames: pages.map((p) => p.name),
      currentPage: 0,
      phase: "drawing",
      connected: false,
      drawProgress: null,
      imagesReady: false,
      imagesDegraded: false,
      hint: null,
    });

    await drawCurrentPageColorsOnly();

    const probe = await probeKeyImageUpload();
    setStatus({
      connected: true,
      phase: "connected",
      drawProgress: null,
      imageUploadOk: probe.ok,
      imageUploadError: probe.error,
      hint: probe.ok
        ? null
        : "Key image upload unavailable — buttons work with colors only. Reinstall Riftbound OBS.",
    });

    console.log(`[streamdeck] Connected: ${deck.PRODUCT_NAME} (${pages.length} pages)`);
    logStartup(`[streamdeck] Connected: ${deck.PRODUCT_NAME} (${pages.length} pages)`);
    if (probe.ok) {
      schedulePrefetchAndDraw();
    }
  } catch (err) {
    console.error("[streamdeck] Failed to open device:", err);
    deck = null;
    setStatus({
      connected: false,
      phase: "error",
      error: formatError(err),
      pageCount: 0,
      pageNames: [],
    });
  }
}

export async function stopStreamDeck() {
  clearTimeout(refreshTimer);
  imageDrawGeneration += 1;
  if (!deck) return;
  try {
    if (process.env.RIFTBOUND_SD_QUICK_CLOSE === "1") {
      await deck.close();
    } else {
      await deck.resetToLogo();
      await deck.close();
    }
  } catch (err) {
    console.error("[streamdeck] Close error:", err);
  }
  deck = null;
  pages = [];
  currentPageIndex = 0;
  lastRevision = null;
  setStatus(resetStreamDeckStatusPatch());
}
