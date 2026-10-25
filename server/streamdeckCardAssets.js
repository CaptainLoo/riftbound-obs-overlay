/**
 * Card image availability for Stream Deck keys. The worker checks files on
 * disk and asks the server to repair anything missing (it never touches the DB).
 */
import { existsSync } from "node:fs";
import { basename, join } from "node:path";
import { CARDS_DIR } from "./paths.js";
import { apiPost } from "./streamdeck/client.js";
import { buildPages } from "./streamdeckLayout.js";

const REPAIR_CHUNK = 8;

function cardIdFromKeyDef(keyDef) {
  return keyDef?.cardId || keyDef?.settings?.cardId || null;
}

/** All card ids referenced by Stream Deck pages (showCard + battlefield keys). */
export function collectStreamDeckCardIds(model, deviceKey = "xl") {
  const ids = new Set();
  for (const page of buildPages(model, deviceKey)) {
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

function localFile(localPath) {
  return localPath ? join(CARDS_DIR, basename(localPath)) : null;
}

function hasLocalCardAsset(cardId, cards = {}) {
  const meta = cards[cardId];
  if (!meta) return false;
  for (const ref of [meta.thumbLocal, meta.imageLocal]) {
    const abs = localFile(ref);
    if (abs && existsSync(abs)) return true;
  }
  return false;
}

export function countReadyAssets(cardIds, cards = {}) {
  const unique = [...new Set(cardIds.filter(Boolean))];
  const missing = unique.filter((id) => !hasLocalCardAsset(id, cards));
  return {
    ready: unique.length - missing.length,
    total: unique.length,
    missing,
  };
}

/**
 * Make sure every card has an image on disk. Missing ones are repaired by the
 * server (POST /api/cards/repair); the returned metadata is merged into `cards`
 * so the worker's model stays current, and sd96 thumbs are re-baked.
 * @param {string[]} cardIds
 * @param {Record<string, {name,thumbLocal,imageLocal}>} cards model.cards (mutated)
 * @param {(progress: { done: number, total: number, current?: string }) => void} [onProgress]
 */
export async function ensureCardAssets(cardIds, cards = {}, onProgress) {
  const unique = [...new Set(cardIds.filter(Boolean))];
  const missing = unique.filter((id) => !hasLocalCardAsset(id, cards));
  const failed = [];
  const repairedIds = [];
  let done = 0;

  for (let i = 0; i < missing.length; i += REPAIR_CHUNK) {
    const chunk = missing.slice(i, i + REPAIR_CHUNK);
    onProgress?.({ done, total: missing.length, current: chunk[0] });
    try {
      const res = await apiPost("/cards/repair", { ids: chunk });
      Object.assign(cards, res.cards || {});
      repairedIds.push(...(res.repaired || []));
      failed.push(...(res.failed || []));
    } catch (err) {
      failed.push(...chunk);
      console.warn(`[streamdeck] card repair failed: ${err.message}`);
    }
    done += chunk.length;
    onProgress?.({ done, total: missing.length, current: chunk[chunk.length - 1] });
  }

  if (repairedIds.length) {
    try {
      const { bakeStreamDeckThumb } = await import("./streamdeckImages.js");
      for (const id of repairedIds) {
        await bakeStreamDeckThumb(id, cards).catch(() => {});
      }
    } catch {
      /* ignore */
    }
  }

  const { ready, total, missing: stillMissing } = countReadyAssets(unique, cards);
  return {
    ready,
    total,
    missing: [...new Set([...stillMissing, ...failed])],
    repairedIds,
  };
}
