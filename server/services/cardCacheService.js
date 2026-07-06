import { cacheCard } from "../cardProvider.js";

export async function cacheMany(ids) {
  const unique = [...new Set(ids.filter(Boolean))];
  for (const id of unique) {
    try {
      await cacheCard(id);
    } catch (err) {
      console.warn(`[cache] ${id}: ${err.message}`);
    }
  }
}

