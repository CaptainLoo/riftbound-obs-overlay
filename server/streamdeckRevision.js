import { collectStreamDeckCardIds } from "./streamdeckCardAssets.js";

const DYNAMIC_KEY_TYPES = new Set(["gamePoint", "battlefield", "selectGame"]);

function stableStringify(value) {
  return JSON.stringify(value);
}

/** Deck layout, player names, and cached card metadata used on Stream Deck pages. */
export function fingerprintStructure(data, deviceKey = "xl") {
  const cardIds = collectStreamDeckCardIds(data, deviceKey);
  const cacheSlice = {};
  for (const id of cardIds.sort()) {
    const entry = data.cardsCache?.[id];
    if (entry) {
      cacheSlice[id] = {
        name: entry.name,
        thumbLocal: entry.thumbLocal,
        imageLocal: entry.imageLocal,
      };
    }
  }
  return stableStringify({
    players: (data.players || []).map((p) => ({
      id: p.id,
      pseudo: p.pseudo,
      deck: p.deck,
    })),
    cardsCache: cacheSlice,
  });
}

/** Match state that affects Controls page labels only. */
export function fingerprintControls(data) {
  const match = data.match || {};
  return stableStringify({
    currentGame: match.currentGame ?? 0,
    games: (match.games || []).map((g) => ({
      score: g.score,
      battlefield: g.battlefield,
    })),
  });
}

/**
 * @returns {"skip"|"partial"|"full"}
 */
export function classifyStreamDeckRefresh(prev, data, deviceKey = "xl") {
  if (!prev?.structure) return "full";

  const structure = fingerprintStructure(data, deviceKey);
  if (structure !== prev.structure) return "full";

  const controls = fingerprintControls(data);
  if (controls !== prev.controls) return "partial";

  return "skip";
}

export function snapshotRevision(data, deviceKey = "xl") {
  return {
    structure: fingerprintStructure(data, deviceKey),
    controls: fingerprintControls(data),
  };
}

export function controlsDynamicKeyIndices(page) {
  if (!page?.keys) return [];
  return [...page.keys.entries()]
    .filter(([, def]) => DYNAMIC_KEY_TYPES.has(def.type))
    .map(([idx]) => idx);
}

function keyVisualSignature(keyDef) {
  if (!keyDef) return "";
  return `${keyDef.type}|${keyDef.label}|${Boolean(keyDef.active)}`;
}

/** Indices on Controls page whose visual changed (label or active flag). */
export function findChangedControlKeyIndices(oldPage, newPage) {
  if (!newPage?.keys) return [];
  const indices = new Set([
    ...controlsDynamicKeyIndices(oldPage),
    ...controlsDynamicKeyIndices(newPage),
  ]);
  const changed = [];
  for (const idx of indices) {
    const oldSig = keyVisualSignature(oldPage?.keys?.get(idx));
    const newSig = keyVisualSignature(newPage.keys.get(idx));
    if (oldSig !== newSig) changed.push(idx);
  }
  return changed.sort((a, b) => a - b);
}

/** Stable fingerprint of all mapped keys on a page (for HID packet cache). */
export function fingerprintPageVisual(page) {
  if (!page?.keys) return "";
  const entries = [...page.keys.entries()]
    .sort(([a], [b]) => a - b)
    .map(([idx, def]) => `${idx}:${keyVisualSignature(def)}`);
  return stableStringify(entries);
}
