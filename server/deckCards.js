/** Deck-derived views shared by the overlay state, the control panel and the Stream Deck. */

function resolveName(cardsCache, id) {
  return cardsCache?.[id]?.name || id;
}

/** Cards available for on-demand overlay display, in display order, de-duplicated. */
export function displayCardEntries(deck = {}, cardsCache = {}) {
  const entries = [];
  const seen = new Set();
  const add = (group, id, quantity = 1) => {
    if (!id || seen.has(id)) return;
    seen.add(id);
    const name = resolveName(cardsCache, id);
    const label = quantity > 1 ? `${name} ×${quantity}` : name;
    entries.push({ index: entries.length, id, name, group, quantity, label });
  };

  if (deck.legend) add("Legend", deck.legend);
  for (const id of deck.champions || []) add("Champion", id);
  for (const e of deck.maindeck || []) add("Main deck", e.id, Number(e.quantity) || 1);
  for (const e of deck.sideboard || []) add("Side deck", e.id, Number(e.quantity) || 1);

  return entries;
}

/** Resolve a display request ({cardId} | {index} | {name}) to a card id, or null. */
export function resolveDisplayCard(deck, cardsCache, { cardId, index, name } = {}) {
  if (cardId) return cardId;
  const list = displayCardEntries(deck, cardsCache);

  if (typeof index === "number" && Number.isFinite(index)) {
    const i = Math.max(0, Math.floor(index));
    return list[i]?.id ?? null;
  }
  if (name && String(name).trim()) {
    const q = String(name).trim().toLowerCase();
    return (
      list.find((e) => e.name.toLowerCase() === q)?.id ??
      list.find((e) => e.name.toLowerCase().includes(q))?.id ??
      null
    );
  }
  return null;
}

export function playerDisplayCards(player, cardsCache = {}) {
  return {
    id: player.id,
    pseudo: player.pseudo || "",
    cards: displayCardEntries(player.deck, cardsCache),
  };
}

export function playerBattlefields(player, cardsCache = {}) {
  return (player.deck?.battlefields || []).map((entry) => {
    const id = entry.id;
    const name = resolveName(cardsCache, id);
    return { id, name, label: name };
  });
}

/** Players as the overlay sees them: legend / champion / battlefields resolved to cached cards. */
export function buildOverlayPlayers(players = [], cardsCache = {}) {
  const card = (id) => (id ? cardsCache[id] || null : null);
  return players.map((p) => ({
    id: p.id,
    pseudo: p.pseudo,
    legend: card(p.deck?.legend),
    champion: card((p.deck?.champions || [])[0]),
    battlefields: (p.deck?.battlefields || []).map((e) => card(e.id)).filter(Boolean),
  }));
}
