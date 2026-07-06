import { writeFile, access } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { getActiveGameData } from "./db.js";
import { getCardsDir } from "./paths.js";
import { ensureSetIndex, getSetIdForCode } from "./pokemonSetIndex.js";

const API_BASE = "https://api.tcgdex.net/v2/en";
const GAME_ID = "pokemon";

async function fetchJson(url) {
  const res = await fetch(url, { headers: { Accept: "application/json" } });
  if (!res.ok) {
    const err = new Error(`TCGdex request failed (${res.status}) for ${url}`);
    err.status = res.status;
    throw err;
  }
  return res.json();
}

function cardsDir() {
  return getCardsDir(GAME_ID);
}

function fileExists(path) {
  return access(path).then(
    () => true,
    () => false
  );
}

function localAssetExists(localPath) {
  if (!localPath) return false;
  const file = localPath.replace(/^\/cards\/[^/]+\//, "").replace(/^\/cards\//, "");
  return existsSync(join(cardsDir(), file));
}

function localIdVariants(localId) {
  const raw = String(localId || "").trim();
  if (!raw) return [];
  const stripped = raw.replace(/^0+(?=\d)/, "");
  const variants = new Set([raw, stripped, raw.padStart(3, "0")]);
  return [...variants];
}

function tcgCategory(detail) {
  return detail.category || detail.supertype || "Trainer";
}

function imageUrls(detail) {
  const base = detail.image;
  if (!base) return { full: null, thumb: null };
  return {
    full: `${base}/high.webp`,
    thumb: `${base}/low.webp`,
  };
}

function toEnergyCost(cost) {
  return Array.isArray(cost) ? cost.filter(Boolean).map(String) : [];
}

function toAttacks(detail) {
  return (Array.isArray(detail.attacks) ? detail.attacks : [])
    .filter((attack) => attack?.name)
    .map((attack) => ({
      name: attack.name,
      cost: toEnergyCost(attack.cost),
      damage: attack.damage ? String(attack.damage) : "",
      effect: attack.effect || "",
    }));
}

function toAbilities(detail) {
  return (Array.isArray(detail.abilities) ? detail.abilities : [])
    .filter((ability) => ability?.name)
    .map((ability) => ({
      name: ability.name,
      type: ability.type || "Ability",
      effect: ability.effect || "",
    }));
}

function toCandidate(detail) {
  const urls = imageUrls(detail);
  return {
    card_id: detail.id,
    name: detail.name,
    type: tcgCategory(detail),
    set_id: detail.set?.id || null,
    thumbnail_url: urls.thumb,
    image_url: urls.full,
  };
}

function toCacheEntry(detail, imageLocal, thumbLocal) {
  return {
    id: detail.id,
    name: detail.name,
    type: tcgCategory(detail),
    faction: null,
    rarity: detail.rarity ?? null,
    setId: detail.set?.id || null,
    orientation: "portrait",
    stats: null,
    hp: detail.hp ? String(detail.hp) : "",
    types: Array.isArray(detail.types) ? detail.types.filter(Boolean) : [],
    stage: detail.stage || null,
    attacks: toAttacks(detail),
    abilities: toAbilities(detail),
    imageLocal,
    thumbLocal: thumbLocal || imageLocal,
  };
}

async function downloadImage(url, fileName) {
  if (!url) return null;
  const dest = join(cardsDir(), fileName);
  if (!(await fileExists(dest))) {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Image download failed (${res.status}) for ${url}`);
    const buf = Buffer.from(await res.arrayBuffer());
    await writeFile(dest, buf);
  }
  return `/cards/${GAME_ID}/${fileName}`;
}

/** Full card detail from TCGdex by id (e.g. sv06-128). */
export async function fetchCardById(cardId) {
  return fetchJson(`${API_BASE}/cards/${encodeURIComponent(cardId)}`);
}

/** Typeahead search by name. Returns lightweight candidates. */
export async function searchByName(name) {
  const q = String(name || "").trim();
  if (q.length < 2) return [];
  const results = await fetchJson(`${API_BASE}/cards?name=${encodeURIComponent(q)}`);
  return (Array.isArray(results) ? results : []).map((c) => ({
    card_id: c.id,
    name: c.name,
    type: "Pokémon",
    set_id: c.set?.id || null,
    thumbnail_url: c.image ? `${c.image}/low.webp` : null,
  }));
}

/** Resolve a Limitless line using set code + collector number. */
export async function fetchCardBySetAndNumber(setCode, localId) {
  await ensureSetIndex();
  const setId = getSetIdForCode(setCode);
  if (!setId) {
    throw Object.assign(new Error(`Unknown set code "${setCode}" — try refreshing the set index`), {
      status: 404,
    });
  }

  let lastErr = null;
  for (const lid of localIdVariants(localId)) {
    const cardId = `${setId}-${lid}`;
    try {
      return await fetchCardById(cardId);
    } catch (err) {
      lastErr = err;
      if (err.status !== 404) throw err;
    }
  }
  throw lastErr || new Error(`Card not found: ${setCode} ${localId}`);
}

/** Fallback: search by name and pick the best match. */
export async function fetchCardByName(name, setCode = null) {
  const results = await fetchJson(`${API_BASE}/cards?name=${encodeURIComponent(name)}`);
  const list = Array.isArray(results) ? results : [];
  if (!list.length) return null;

  const lower = name.toLowerCase();
  let pool = list.filter((c) => c.name?.toLowerCase() === lower);
  if (!pool.length) pool = list;

  if (setCode) {
    await ensureSetIndex();
    const setId = getSetIdForCode(setCode);
    if (setId) {
      const inSet = pool.filter((c) => c.id?.startsWith(`${setId}-`));
      if (inSet.length) pool = inSet;
    }
  }

  const best = pool[0];
  if (!best?.id) return null;
  return fetchCardById(best.id);
}

export async function fetchCardDetail(cardId) {
  return fetchCardById(cardId);
}

export async function repairCardAsset(cardId) {
  const gameData = getActiveGameData();
  const entry = gameData.cardsCache[cardId];
  if (entry) {
    const thumbOk = localAssetExists(entry.thumbLocal);
    const imageOk = localAssetExists(entry.imageLocal);
    if (thumbOk || imageOk) return entry;
    delete gameData.cardsCache[cardId];
    const { db } = await import("./db.js");
    await db.write();
  }
  return cacheCard(cardId);
}

export async function cacheCard(cardId) {
  const gameData = getActiveGameData();
  const existing = gameData.cardsCache[cardId];
  if (existing) {
    if (localAssetExists(existing.thumbLocal) || localAssetExists(existing.imageLocal)) {
      return existing;
    }
    delete gameData.cardsCache[cardId];
  }

  const detail = await fetchCardById(cardId);
  const id = detail.id || cardId;
  const urls = imageUrls(detail);
  const safeName = id.replace(/[^a-z0-9.-]/gi, "_");

  const imageLocal = await downloadImage(urls.full, `${safeName}.webp`);
  const thumbLocal = await downloadImage(urls.thumb, `${safeName}-thumb.webp`);

  const entry = toCacheEntry(detail, imageLocal, thumbLocal);
  gameData.cardsCache[id] = entry;
  const { db } = await import("./db.js");
  await db.write();

  try {
    const { bakeStreamDeckThumb } = await import("./streamdeckImages.js");
    await bakeStreamDeckThumb(id, gameData.cardsCache);
  } catch (err) {
    console.warn(`[tcgdex] sd96 bake ${id}: ${err.message}`);
  }
  return entry;
}

export function getCachedCard(cardId) {
  return getActiveGameData().cardsCache[cardId] || null;
}

export { toCandidate };
