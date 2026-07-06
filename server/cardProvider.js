import { getActiveGameId } from "./db.js";
import * as riftscribe from "./riftscribe.js";
import * as tcgdex from "./tcgdex.js";

const PROVIDERS = {
  riftbound: riftscribe,
  pokemon: tcgdex,
};

export function getCardProvider(gameId = getActiveGameId()) {
  return PROVIDERS[gameId] || riftscribe;
}

export function searchByName(name) {
  return getCardProvider().searchByName(name);
}

export function fetchCardDetail(cardId) {
  return getCardProvider().fetchCardDetail(cardId);
}

export function cacheCard(cardId) {
  return getCardProvider().cacheCard(cardId);
}

export function repairCardAsset(cardId) {
  return getCardProvider().repairCardAsset(cardId);
}

export function getCachedCard(cardId) {
  return getCardProvider().getCachedCard(cardId);
}
