import { defaultDisplay, defaultMatch, FORMATS, makeGame } from "../db.js";
import { PLAYER_IDS } from "../constants.js";
import { cacheMany } from "./cardCacheService.js";
import { activeGameData, commit } from "./stateService.js";
import { findPlayer, validatePlayerId } from "./playerService.js";

function currentGame(match) {
  return match.games[match.currentGame];
}

export async function resetMatch() {
  const gameData = activeGameData();
  gameData.match = defaultMatch(gameData.match.format);
  gameData.display = defaultDisplay();
  commit(["match", "game", "display"]);
  return gameData.match;
}

export async function setMatchFormat(format) {
  if (!FORMATS[format]) {
    throw Object.assign(new Error("invalid format"), { status: 400, allowed: Object.keys(FORMATS) });
  }
  const match = activeGameData().match;
  const need = FORMATS[format].games;
  match.format = format;
  while (match.games.length < need) match.games.push(makeGame());
  if (match.games.length > need) match.games.length = need;
  if (match.currentGame > need - 1) match.currentGame = need - 1;
  commit(["match", "game"]);
  return match;
}

export async function winGame(player) {
  if (!PLAYER_IDS.includes(player)) {
    throw Object.assign(new Error("invalid player"), { status: 400 });
  }
  const match = activeGameData().match;
  const toWin = FORMATS[match.format].win;
  const alreadyDecided = match.score.p1 >= toWin || match.score.p2 >= toWin;
  if (!alreadyDecided) {
    match.score[player] = (match.score[player] || 0) + 1;
    const played = match.score.p1 + match.score.p2;
    match.currentGame = Math.min(played, match.games.length - 1);
  }
  commit(["match", "game"]);
  return match;
}

export async function updateMatch({ score, currentGame: currentGameIndex } = {}) {
  const match = activeGameData().match;
  if (typeof currentGameIndex === "number") {
    const max = match.games.length - 1;
    match.currentGame = Math.max(0, Math.min(max, currentGameIndex));
  }
  if (score) {
    const game = currentGame(match);
    if (game) {
      if (typeof score.p1 === "number") game.score.p1 = Math.max(0, score.p1);
      if (typeof score.p2 === "number") game.score.p2 = Math.max(0, score.p2);
    }
  }
  commit(["match", "game"]);
  return match;
}

export async function setSelection({ gameIndex, player, slot, cardId }) {
  const game = activeGameData().match.games[gameIndex];
  if (!game) throw Object.assign(new Error("invalid gameIndex"), { status: 400 });
  if (!validatePlayerId(player)) throw Object.assign(new Error("invalid player"), { status: 400 });
  if (slot !== "battlefield" && slot !== "champion") {
    throw Object.assign(new Error("invalid slot"), { status: 400 });
  }
  if (cardId) await cacheMany([cardId]);
  game[slot][player] = cardId || null;
  commit(["game"]);
  return game;
}

export async function hotBattlefield({ player, cardId }) {
  if (!validatePlayerId(player)) throw Object.assign(new Error("invalid player"), { status: 400 });
  const gameData = activeGameData();
  const p = findPlayer(player);
  const allowed = (p?.deck?.battlefields || []).some((e) => e.id === cardId);
  if (!allowed) throw Object.assign(new Error("battlefield not in player deck"), { status: 400 });
  const gameIndex = gameData.match.currentGame;
  const game = gameData.match.games[gameIndex];
  if (!game) throw Object.assign(new Error("invalid game"), { status: 400 });
  await cacheMany([cardId]);
  game.battlefield[player] = cardId;
  commit(["game"]);
  return { gameIndex, player, cardId, name: gameData.cardsCache[cardId]?.name || cardId, game };
}

export async function hotScore({ player, op }) {
  if (!validatePlayerId(player)) throw Object.assign(new Error("invalid player"), { status: 400 });
  if (op !== "inc" && op !== "dec") {
    throw Object.assign(new Error("invalid op (inc|dec)"), { status: 400 });
  }
  const match = activeGameData().match;
  const game = currentGame(match);
  if (!game) throw Object.assign(new Error("invalid game"), { status: 400 });
  if (!game.score) game.score = { p1: 0, p2: 0 };
  const delta = op === "inc" ? 1 : -1;
  game.score[player] = Math.max(0, (game.score[player] || 0) + delta);
  commit(["game"]);
  return {
    player,
    delta,
    currentGame: match.currentGame,
    score: game.score,
  };
}
