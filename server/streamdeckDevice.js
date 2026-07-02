import { platform } from "node:os";
import { IS_ELECTRON } from "./paths.js";
import { db } from "./db.js";
import { buildPages, detectDeviceKey } from "./streamdeckLayout.js";

const DEFAULT_PORT = Number(process.env.PORT) || 7474;
const API = `http://127.0.0.1:${DEFAULT_PORT}/api`;

let nodeLib = null;
let imagesMod = null;

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
let status = {
  supported: platform() === "win32" && IS_ELECTRON,
  connected: false,
  model: null,
  productName: null,
  serialNumber: null,
  firmwareVersion: null,
  deviceKey: "xl",
  currentPage: 0,
  pageCount: 0,
  pageNames: [],
  error: null,
};

function setStatus(patch) {
  status = { ...status, ...patch };
}

function formatError(err) {
  const msg = err?.message || String(err);
  if (/could not open|cannot open|access|busy|in use/i.test(msg)) {
    return "Stream Deck busy — quit the Elgato Stream Deck app completely, then restart Riftbound OBS.";
  }
  return msg;
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

async function flashKey(keyIndex, r, g, b) {
  if (!deck) return;
  try {
    await deck.fillKeyColor(keyIndex, r, g, b);
    setTimeout(() => {
      drawCurrentPage().catch(() => {});
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

async function drawCurrentPage() {
  if (!deck || !pages.length) return;
  const page = pages[currentPageIndex];
  if (!page) return;

  const controls = deck.CONTROLS.filter((c) => c.type === "button");
  const validIndices = new Set(controls.map((c) => c.index));

  for (const idx of validIndices) {
    if (!page.keys.has(idx)) {
      await deck.clearKey(idx);
    }
  }

  for (const [idx, keyDef] of page.keys.entries()) {
    if (!validIndices.has(idx)) continue;
    try {
      const { renderKeyImage } = await loadImagesMod();
      const rgb = await renderKeyImage(keyDef, db.data.cardsCache, keySize);
      await deck.fillKeyBuffer(idx, rgb, { format: "rgb" });
    } catch (err) {
      console.error(`[streamdeck] Key ${idx} draw failed:`, err.message);
    }
  }
}

async function rebuildPages(resetPage = false) {
  if (!deck) return;
  deviceKey = detectDeviceKey(deck);
  pages = buildPages(db.data, deviceKey);
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
    if (force) {
      const { clearImageCaches } = await loadImagesMod();
      clearImageCaches();
    }
    await rebuildPages(false);
    setStatus({ error: null });
  } catch (err) {
    console.error("[streamdeck] Refresh failed:", err);
    setStatus({ error: formatError(err) });
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

export async function startStreamDeck() {
  if (!status.supported) {
    setStatus({ connected: false, error: null });
    return;
  }
  if (deck) return;

  try {
    const { DeviceModelId, listStreamDecks, openStreamDeck } = await loadNodeLib();
    const devices = await listStreamDecks();
    if (!devices.length) {
      setStatus({
        connected: false,
        error: "No Stream Deck detected. Plug in your device and restart Riftbound OBS.",
      });
      return;
    }

    const preferred =
      devices.find((d) => d.model === DeviceModelId.XL) ||
      devices.find((d) => d.model === DeviceModelId.ORIGINALV2) ||
      devices.find((d) => d.model === DeviceModelId.MINI) ||
      devices[0];

    deck = await openStreamDeck(preferred.path);
    const buttonControl = deck.CONTROLS.find((c) => c.type === "button" && c.feedbackType === "lcd");
    keySize = buttonControl?.pixelSize?.width || 96;

    deck.on("error", (err) => {
      console.error("[streamdeck] Device error:", err);
      setStatus({ error: formatError(err), connected: false });
    });

    deck.on("down", (control) => {
      if (control.type !== "button") return;
      const page = pages[currentPageIndex];
      const keyDef = page?.keys.get(control.index);
      if (!keyDef) return;
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
    pages = buildPages(db.data, deviceKey);

    setStatus({
      connected: true,
      error: null,
      model: preferred.model,
      productName: deck.PRODUCT_NAME,
      serialNumber,
      firmwareVersion,
      deviceKey,
      pageCount: pages.length,
      pageNames: pages.map((p) => p.name),
      currentPage: 0,
    });

    await drawCurrentPage();
    console.log(`[streamdeck] Connected: ${deck.PRODUCT_NAME} (${pages.length} pages)`);
  } catch (err) {
    console.error("[streamdeck] Failed to open device:", err);
    deck = null;
    setStatus({
      connected: false,
      error: formatError(err),
      pageCount: 0,
      pageNames: [],
    });
  }
}

export async function stopStreamDeck() {
  clearTimeout(refreshTimer);
  if (!deck) return;
  try {
    await deck.resetToLogo();
    await deck.close();
  } catch (err) {
    console.error("[streamdeck] Close error:", err);
  }
  deck = null;
  pages = [];
  currentPageIndex = 0;
  setStatus({
    connected: false,
    model: null,
    productName: null,
    serialNumber: null,
    firmwareVersion: null,
    pageCount: 0,
    pageNames: [],
    currentPage: 0,
    error: null,
  });
}
