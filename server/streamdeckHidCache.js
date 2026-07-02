const MAX_ENTRIES = 5;
const cache = new Map();

export function panelCacheKey(pageIndex, pageRevision) {
  return `${pageIndex}:${pageRevision}`;
}

export function getCachedPanelPrepared(cacheKey) {
  return cache.get(cacheKey) || null;
}

export function setCachedPanelPrepared(cacheKey, prepared) {
  if (cache.has(cacheKey)) cache.delete(cacheKey);
  cache.set(cacheKey, prepared);
  while (cache.size > MAX_ENTRIES) {
    const oldest = cache.keys().next().value;
    cache.delete(oldest);
  }
}

export function clearPanelHidCache() {
  cache.clear();
}

export async function preparePanelUpload(deck, rgbPanel) {
  return deck.prepareFillPanelBuffer(rgbPanel, { format: "rgb" }, true);
}

export async function uploadPreparedPanel(deck, prepared, { yieldFn } = {}) {
  if (typeof deck.sendPreparedBuffer === "function") {
    await deck.sendPreparedBuffer(prepared);
    return;
  }

  const packets = unwrapPreparedBuffer(deck.MODEL, prepared);
  const hidDevice = deck?.device?.device ?? null;

  if (hidDevice?.sendReports) {
    const BATCH = 4;
    for (let i = 0; i < packets.length; i += BATCH) {
      await hidDevice.sendReports(packets.slice(i, i + BATCH));
      if (yieldFn) await yieldFn();
    }
    return;
  }

  await deck.sendPreparedBuffer(prepared);
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
