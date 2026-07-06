import { existsSync } from "node:fs";
import { basename, join } from "node:path";
import { getActiveGameData, getActiveGameId } from "./db.js";
import { DATA_DIR, getCardsDir } from "./paths.js";
import { repairCardAsset } from "./riftscribe.js";
import { buildPages } from "./streamdeckLayout.js";
import { runPool } from "./streamdeckImageWarm.js";

const DOWNLOAD_CONCURRENCY = 6;

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

function resolveCardFilePath(localPath) {
  if (!localPath) return null;
  const nested = localPath.match(/^\/cards\/([^/]+)\/(.+)$/);
  if (nested) return join(DATA_DIR, "cards", nested[1], nested[2]);
  return join(getCardsDir(getActiveGameId()), basename(localPath));
}

export function hasLocalCardAsset(cardId) {
  const meta = getActiveGameData().cardsCache[cardId];
  if (!meta) return false;
  for (const ref of [meta.thumbLocal, meta.imageLocal]) {
    if (!ref) continue;
    if (existsSync(resolveCardFilePath(ref))) return true;
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
  const failed = [];
  const repairedIds = [];
  let done = 0;
  const cardsCache = getActiveGameData().cardsCache;

  const tasks = unique.map((id) => async () => {
    try {
      if (!hasLocalCardAsset(id)) {
        await repairCardAsset(id);
        repairedIds.push(id);
      }
    } catch (err) {
      failed.push(id);
      console.warn(`[streamdeck] card asset ${id}: ${err.message}`);
    } finally {
      done += 1;
      onProgress?.({ done, total: unique.length, current: id });
    }
  });

  await runPool(tasks, DOWNLOAD_CONCURRENCY);

  if (repairedIds.length) {
    try {
      const { bakeStreamDeckThumb } = await import("./streamdeckImages.js");
      for (const id of repairedIds) {
        await bakeStreamDeckThumb(id, cardsCache).catch(() => {});
      }
    } catch {
      /* ignore */
    }
  }

  const { ready, total, missing } = countReadyAssets(unique);
  return {
    ready,
    total,
    missing: [...new Set([...missing, ...failed])],
    repairedIds,
  };
}
