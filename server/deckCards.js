/** Cards available for on-demand overlay display (Stream Deck + control panel). */

import { getGameAdapter } from "./gameAdapters/index.js";

export function displayCardEntries(deck, cardsCache = {}, gameId = "riftbound") {
  return getGameAdapter(gameId).displayCardEntries(deck, cardsCache);
}

export function resolveDisplayCard(deck, cardsCache, { cardId, index, name } = {}, gameId = "riftbound") {
  const list = displayCardEntries(deck, cardsCache, gameId);

  if (cardId) {
    return cardId;
  }
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

export function playerDisplayCards(player, cardsCache = {}, gameId = "riftbound") {
  return {
    id: player.id,
    pseudo: player.pseudo || "",
    cards: displayCardEntries(player.deck, cardsCache, gameId),
  };
}

export function playerBattlefields(player, cardsCache = {}, gameId = "riftbound") {
  return getGameAdapter(gameId).playerBattlefields(player, cardsCache);
}
