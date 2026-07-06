import { CARD_ANIMATIONS } from "../db.js";
import { PLAYER_IDS } from "../constants.js";
import { resolveDisplayCard } from "../deckCards.js";
import { getActiveGameId } from "../db.js";
import { cacheMany } from "./cardCacheService.js";
import { activeGameData, persistAndBroadcast } from "./stateService.js";
import { findPlayer, validatePlayerId } from "./playerService.js";

export function bumpCardReveal(player) {
  const gameData = activeGameData();
  if (!gameData.display.cardReveal) gameData.display.cardReveal = { p1: 0, p2: 0 };
  gameData.display.cardReveal[player] = (gameData.display.cardReveal[player] || 0) + 1;
}

export async function setDisplayCard(player, cardId) {
  const gameData = activeGameData();
  if (player && !validatePlayerId(player)) {
    throw Object.assign(new Error("invalid player"), { status: 400 });
  }
  if (cardId) await cacheMany([cardId]);
  if (!gameData.display.cards) gameData.display.cards = { p1: null, p2: null };
  if (player) {
    gameData.display.cards[player] = cardId;
    if (cardId) bumpCardReveal(player);
  } else {
    gameData.display.cards.p1 = cardId;
    if (cardId) bumpCardReveal("p1");
  }
  gameData.display.mode = "persistent";
  await persistAndBroadcast(["display"]);
  return gameData.display;
}

export function resolveDisplayCardRequest(player, { cardId, index, name }) {
  if (cardId !== undefined && cardId !== null) return cardId;
  if (index === undefined && !name) return null;
  const p = findPlayer(player || "p1");
  if (!p) throw Object.assign(new Error("unknown player"), { status: 404 });
  const resolved = resolveDisplayCard(
    p.deck,
    activeGameData().cardsCache,
    { index, name },
    getActiveGameId()
  );
  if (!resolved) throw Object.assign(new Error("card not found"), { status: 404 });
  return resolved;
}

export async function setAnimation(animation) {
  const gameData = activeGameData();
  if (!CARD_ANIMATIONS.includes(animation)) {
    throw Object.assign(new Error("invalid animation"), {
      status: 400,
      allowed: CARD_ANIMATIONS,
    });
  }
  gameData.display.cardAnimation = animation;
  for (const pid of PLAYER_IDS) {
    if (gameData.display.cards?.[pid]) bumpCardReveal(pid);
  }
  await persistAndBroadcast(["display"]);
  return gameData.display;
}

export async function showMatchup() {
  const gameData = activeGameData();
  gameData.display.mode = "matchup";
  if (gameData.display.cards) {
    gameData.display.cards.p1 = null;
    gameData.display.cards.p2 = null;
  }
  await persistAndBroadcast(["display"]);
  return gameData.display;
}

export async function clearDisplay(player = null) {
  const gameData = activeGameData();
  gameData.display.mode = "persistent";
  if (!gameData.display.cards) gameData.display.cards = { p1: null, p2: null };
  if (player && validatePlayerId(player)) {
    gameData.display.cards[player] = null;
  } else {
    gameData.display.cards.p1 = null;
    gameData.display.cards.p2 = null;
  }
  await persistAndBroadcast(["display"]);
  return gameData.display;
}

