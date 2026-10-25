import { deckCardIds, normalizeDeck } from "../db.js";
import { searchByName } from "../riftscribe.js";
import { parseDecklist, resolveDecklist, resolveTTS } from "../decklist.js";
import { cacheMany } from "./cardCacheService.js";
import { persistAndBroadcast } from "./stateService.js";
import { requirePlayer } from "./playerService.js";

export async function previewDecklist({ format, text }) {
  if (format === "tts") {
    return resolveTTS(text);
  }
  return resolveDecklist(parseDecklist(text));
}

export async function savePlayerDeck(playerId, incoming = {}) {
  const player = requirePlayer(playerId);
  const deck = normalizeDeck(incoming);
  await cacheMany(deckCardIds(deck));
  player.deck = deck;
  await persistAndBroadcast();
  return deck;
}

export function searchCards(query) {
  return searchByName(query);
}
