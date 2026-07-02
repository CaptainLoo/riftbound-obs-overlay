import { writeFile, access } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, extname } from "node:path";
import { db } from "./db.js";
import { CARDS_DIR } from "./paths.js";

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
  // Served by express static middleware mounted at /cards.
  return `/cards/${fileName}`;
}

/**
 * Ensure a card is present in the local cache: fetches metadata and downloads
 * the full image + a large thumbnail. Returns the cached entry.
 */
function localAssetExists(localPath) {
  if (!localPath) return false;
  const file = localPath.replace(/^\/cards\//, "");
  return existsSync(join(CARDS_DIR, file));
}

/** Re-download a card when cache metadata exists but files are missing on disk. */
export async function repairCardAsset(cardId) {
  const entry = db.data.cardsCache[cardId];
  if (entry) {
    const thumbOk = localAssetExists(entry.thumbLocal);
    const imageOk = localAssetExists(entry.imageLocal);
    if (thumbOk || imageOk) return entry;
    delete db.data.cardsCache[cardId];
    await db.write();
  }
  return cacheCard(cardId);
}

export async function cacheCard(cardId) {
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
  await db.write();
  return entry;
}

export function getCachedCard(cardId) {
  return db.data.cardsCache[cardId] || null;
}
