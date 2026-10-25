const DYNAMIC_KEY_TYPES = new Set(["gamePoint", "battlefield", "selectGame"]);

function stableStringify(value) {
  return JSON.stringify(value);
}

/** Deck layout, player names and card metadata used on Stream Deck pages. */
function fingerprintStructure(model) {
  return stableStringify({
    players: (model?.players || []).map((p) => ({
      id: p.id,
      pseudo: p.pseudo,
      cards: (p.cards || []).map((c) => [c.id, c.label]),
      battlefields: (p.battlefields || []).map((b) => [b.id, b.name]),
    })),
    cards: model?.cards || {},
  });
}

/** Match state that affects Controls page labels only. */
function fingerprintControls(model) {
  const match = model?.match || {};
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
export function classifyStreamDeckRefresh(prev, model) {
  if (!prev?.structure) return "full";
  if (prev.rev && model?.rev && prev.rev === model.rev) return "skip";

  const structure = fingerprintStructure(model);
  if (structure !== prev.structure) return "full";

  const controls = fingerprintControls(model);
  if (controls !== prev.controls) return "partial";

  return "skip";
}

export function snapshotRevision(model) {
  return {
    rev: model?.rev || null,
    structure: fingerprintStructure(model),
    controls: fingerprintControls(model),
  };
}

function controlsDynamicKeyIndices(page) {
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
