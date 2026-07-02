import { collectPageCardIds } from "./streamdeckCardAssets.js";

const CARD_KEY_TYPES = new Set(["showCard", "battlefield"]);
const DEFAULT_CONCURRENCY = 4;

/** Run async tasks with a fixed concurrency pool. */
export async function runPool(tasks, concurrency = DEFAULT_CONCURRENCY) {
  if (!tasks.length) return;
  let next = 0;
  const workers = Array.from({ length: Math.min(concurrency, tasks.length) }, async () => {
    while (next < tasks.length) {
      const i = next++;
      await tasks[i]();
    }
  });
  await Promise.all(workers);
}

function isCardPage(page) {
  if (!page?.keys) return false;
  for (const keyDef of page.keys.values()) {
    if (CARD_KEY_TYPES.has(keyDef.type)) return true;
  }
  return false;
}

/**
 * Pre-render card key images (art + label composite) into memory cache.
 */
export async function warmPageCardKeys(page, cardsCache, keySize, renderKeyImage, concurrency = DEFAULT_CONCURRENCY) {
  if (!page?.keys) return;
  const tasks = [];
  for (const keyDef of page.keys.values()) {
    if (!CARD_KEY_TYPES.has(keyDef.type)) continue;
    tasks.push(() => renderKeyImage(keyDef, cardsCache, keySize));
  }
  await runPool(tasks, concurrency);
}

/** Warm card art for ids on a page (lighter — used when only art cache needed). */
export async function warmPageCardArt(page, cardsCache, keySize, renderCardArtOnly, concurrency = DEFAULT_CONCURRENCY) {
  const ids = collectPageCardIds(page);
  const tasks = ids.map((id) => () => renderCardArtOnly(id, cardsCache, keySize));
  await runPool(tasks, concurrency);
}

/** Background-warm prev/next card pages after the current page finishes drawing. */
export async function warmAdjacentPages(pages, currentIndex, cardsCache, keySize, renderKeyImage) {
  if (!pages?.length || !renderKeyImage) return;
  const targets = [currentIndex - 1, currentIndex + 1];
  for (const idx of targets) {
    if (idx < 0 || idx >= pages.length) continue;
    const page = pages[idx];
    if (!isCardPage(page)) continue;
    await warmPageCardKeys(page, cardsCache, keySize, renderKeyImage);
  }
}
