import { getActiveGameId } from "../db.js";
import { searchByName } from "../cardProvider.js";
import { parseDecklist, resolveDecklist, resolveTTS } from "../decklist.js";
import { parseLimitless, resolveLimitless } from "../pokemonDecklist.js";
import { getGameAdapter } from "../gameAdapters/index.js";
import { cacheMany } from "./cardCacheService.js";
import { persistAndBroadcast } from "./stateService.js";
import { requirePlayer } from "./playerService.js";

export async function previewDecklist({ format, text }) {
  if (getActiveGameId() === "pokemon" && format === "limitless") {
    return resolveLimitless(parseLimitless(text));
  }
  if (format === "tts") {
    return resolveTTS(text);
  }
  return resolveDecklist(parseDecklist(text));
}

export async function savePlayerDeck(playerId, incoming = {}) {
  const player = requirePlayer(playerId);
  const adapter = getGameAdapter(getActiveGameId());
  const deck = adapter.normalizeDeck(incoming);
  await cacheMany(adapter.deckCardIds(deck));
  player.deck = deck;
  await persistAndBroadcast();
  return deck;
}

export function searchCards(query) {
  return searchByName(query);
}

