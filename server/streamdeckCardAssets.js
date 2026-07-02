import { existsSync } from "node:fs";
import { basename, join } from "node:path";
import { db } from "./db.js";
import { CARDS_DIR } from "./paths.js";
import { repairCardAsset } from "./riftscribe.js";
import { buildPages } from "./streamdeckLayout.js";

function cardIdFromKeyDef(keyDef) {
  return keyDef?.cardId || keyDef?.settings?.cardId || null;
}

/** All card ids referenced by Stream Deck pages (showCard + battlefield keys). */
export function collectStreamDeckCardIds(data, deviceKey = "xl") {
  const ids = new Set();
  for (const page of buildPages(data, deviceKey)) {
    for (const keyDef of page.keys.values()) {
      const id = cardIdFromKeyDef(keyDef);
      if (id) ids.add(id);
    }
  }
  return [...ids];
}

/** Card ids on a single page. */
export function collectPageCardIds(page) {
  const ids = new Set();
  if (!page?.keys) return [];
  for (const keyDef of page.keys.values()) {
    const id = cardIdFromKeyDef(keyDef);
    if (id) ids.add(id);
  }
  return [...ids];
}

export function hasLocalCardAsset(cardId) {
  const meta = db.data.cardsCache[cardId];
  if (!meta) return false;
  for (const ref of [meta.thumbLocal, meta.imageLocal]) {
    if (!ref) continue;
    if (existsSync(join(CARDS_DIR, basename(ref)))) return true;
  }
  return false;
}

export function countReadyAssets(cardIds) {
  const unique = [...new Set(cardIds.filter(Boolean))];
  const missing = unique.filter((id) => !hasLocalCardAsset(id));
  return {
    ready: unique.length - missing.length,
    total: unique.length,
    missing,
  };
}

/**
 * Download or repair card thumbnails for Stream Deck rendering.
 * @param {string[]} cardIds
 * @param {(progress: { done: number, total: number, current?: string }) => void} [onProgress]
 */
export async function ensureCardAssets(cardIds, onProgress) {
  const unique = [...new Set(cardIds.filter(Boolean))];
  let done = 0;
  const failed = [];

  for (const id of unique) {
    try {
      if (!hasLocalCardAsset(id)) {
        await repairCardAsset(id);
      }
    } catch (err) {
      failed.push(id);
      console.warn(`[streamdeck] card asset ${id}: ${err.message}`);
    }
    done += 1;
    onProgress?.({ done, total: unique.length, current: id });
  }

  const { ready, total, missing } = countReadyAssets(unique);
  return {
    ready,
    total,
    missing: [...new Set([...missing, ...failed])],
  };
}
