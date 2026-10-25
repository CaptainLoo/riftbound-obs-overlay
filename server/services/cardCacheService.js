import { db } from "../db.js";
import { cacheCard, repairCardAsset } from "../riftscribe.js";
import { runPool } from "../util/pool.js";

const DEFAULT_CONCURRENCY = 4;

/** Download metadata + images for many cards (errors are logged, not thrown). */
export async function cacheMany(ids, { concurrency = DEFAULT_CONCURRENCY } = {}) {
  const unique = [...new Set(ids.filter(Boolean))];
  await runPool(
    unique.map((id) => async () => {
      try {
        await cacheCard(id);
      } catch (err) {
        console.warn(`[cache] ${id}: ${err.message}`);
      }
    }),
    concurrency
  );
}

function cardSlice(ids) {
  const out = {};
  for (const id of ids) {
    const c = db.data.cardsCache[id];
    if (c) out[id] = { name: c.name, thumbLocal: c.thumbLocal, imageLocal: c.imageLocal };
  }
  return out;
}

/**
 * Re-download cards whose files are missing on disk (used by the Stream Deck worker).
 * @returns {{ repaired: string[], failed: string[], cards: Record<string, object> }}
 */
export async function repairMany(ids, { concurrency = DEFAULT_CONCURRENCY } = {}) {
  const unique = [...new Set((Array.isArray(ids) ? ids : []).filter((id) => typeof id === "string"))].slice(0, 200);
  const repaired = [];
  const failed = [];
  await runPool(
    unique.map((id) => async () => {
      try {
        await repairCardAsset(id);
        repaired.push(id);
      } catch (err) {
        failed.push(id);
        console.warn(`[cache] repair ${id}: ${err.message}`);
      }
    }),
    concurrency
  );
  return { repaired, failed, cards: cardSlice(unique) };
}
