import { writeFile, access } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, extname, basename } from "node:path";
import { db } from "./db.js";
import { CARDS_DIR } from "./paths.js";
import { markDirty } from "./persist.js";

const API_BASE = "https://riftscribe.gg/api";

async function fetchJson(url) {
  const res = await fetch(url, { headers: { Accept: "application/json" } });
  if (!res.ok) {
    throw new Error(`RiftScribe request failed (${res.status}) for ${url}`);
  }
  return res.json();
}

/** Typeahead search by name. Returns lightweight candidates. */
export async function searchByName(name) {
  const q = String(name || "").trim();
  if (q.length < 2) return [];
  const url = `${API_BASE}/cards/search?q=${encodeURIComponent(q)}`;
  return fetchJson(url);
}

/** Full card detail from the API (not cached). */
export async function fetchCardDetail(cardId) {
  return fetchJson(`${API_BASE}/cards/${encodeURIComponent(cardId)}`);
}

function fileExists(path) {
  return access(path).then(
    () => true,
    () => false
  );
}

async function downloadImage(url, cardId, suffix) {
  if (!url) return null;
  const ext = extname(new URL(url).pathname) || ".png";
  const fileName = `${cardId}${suffix}${ext}`;
  const dest = join(CARDS_DIR, fileName);
  if (!(await fileExists(dest))) {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Image download failed (${res.status}) for ${url}`);
    const buf = Buffer.from(await res.arrayBuffer());
    await writeFile(dest, buf);
  }
  return `/cards/${fileName}`;
}

/** Absolute path of a cached `/cards/<file>` URL, or null when the file is missing. */
function localCardFile(localPath) {
  if (!localPath) return null;
  const abs = join(CARDS_DIR, basename(localPath));
  return existsSync(abs) ? abs : null;
}

function localAssetExists(localPath) {
  return Boolean(localCardFile(localPath));
}

/** Re-download a card when cache metadata exists but files are missing on disk. */
export async function repairCardAsset(cardId) {
  const entry = db.data.cardsCache[cardId];
  if (entry) {
    if (localAssetExists(entry.thumbLocal) || localAssetExists(entry.imageLocal)) return entry;
    delete db.data.cardsCache[cardId];
    markDirty();
  }
  return cacheCard(cardId);
}

/**
 * Ensure a card is present in the local cache: fetches metadata and downloads
 * the full image + a large thumbnail. Returns the cached entry.
 */
const inFlight = new Map();

export function cacheCard(cardId) {
  if (inFlight.has(cardId)) return inFlight.get(cardId);
  const p = cacheCardNow(cardId).finally(() => inFlight.delete(cardId));
  inFlight.set(cardId, p);
  return p;
}

async function cacheCardNow(cardId) {
  const existing = db.data.cardsCache[cardId];
  if (existing) {
    if (localAssetExists(existing.thumbLocal) || localAssetExists(existing.imageLocal)) {
      return existing;
    }
    delete db.data.cardsCache[cardId];
  }

  const detail = await fetchCardDetail(cardId);
  const id = detail.id || cardId;

  const imageLocal = await downloadImage(detail.image, id, "");
  const thumbLocal = await downloadImage(detail.image_thumb?.large, id, "-thumb");

  const entry = {
    id,
    name: detail.name,
    type: detail.type,
    faction: detail.faction ?? null,
    rarity: detail.rarity ?? null,
    setId: detail.set_id ?? null,
    orientation: detail.orientation ?? "portrait",
    stats: detail.stats ?? null,
    imageLocal,
    thumbLocal: thumbLocal || imageLocal,
  };

  db.data.cardsCache[id] = entry;
  markDirty();
  return entry;
}
