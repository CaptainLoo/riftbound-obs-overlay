import { deckCardIds, normalizeDeck } from "../db.js";
import { searchByName } from "../riftscribe.js";
import { parseDecklist, resolveDecklist, resolveTTS } from "../decklist.js";
import { cacheMany } from "./cardCacheService.js";
import { commit } from "./stateService.js";
import { requirePlayer } from "./playerService.js";

export async function previewDecklist({ format, text }) {
  if (format === "tts") {
    return resolveTTS(text);
  }
  return resolveDecklist(parseDecklist(text));
}

/**
 * Save a deck in two phases: the cards the overlay needs right away (legend,
 * champions, battlefields) are cached before responding; the rest downloads in
 * the background and a `players` patch is broadcast when it is done.
 */
export async function savePlayerDeck(playerId, incoming = {}) {
  const player = requirePlayer(playerId);
  const deck = normalizeDeck(incoming);
  const priority = new Set([deck.legend, ...deck.champions, ...deck.battlefields.map((e) => e.id)].filter(Boolean));
  const rest = deckCardIds(deck).filter((id) => !priority.has(id));

  await cacheMany([...priority]);
  player.deck = deck;
  commit(["players"]);

  if (rest.length) {
    cacheMany(rest)
      .then(() => commit(["players"]))
      .catch((err) => console.warn(`[deck] background cache failed: ${err.message}`));
  }
  return { deck, pendingImages: rest.length };
}

export function searchCards(query) {
  return searchByName(query);
}
