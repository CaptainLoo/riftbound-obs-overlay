import { Router } from "express";
import { getActiveGameId } from "../db.js";
import { getGame } from "../games.js";
import { displayCardEntries } from "../deckCards.js";
import { buildState } from "../hub.js";
import { activeGameData } from "../services/stateService.js";

export const dataRoutes = Router();

dataRoutes.get("/state", (_req, res) => {
  res.json(buildState());
});

dataRoutes.get("/data", (_req, res) => {
  const gameData = activeGameData();
  const activeGame = getActiveGameId();
  const game = getGame(activeGame);
  res.json({
    activeGame,
    gameName: game?.name || activeGame,
    players: gameData.players.map((p) => ({
      ...p,
      displayCards: displayCardEntries(p.deck, gameData.cardsCache, activeGame),
    })),
    match: gameData.match,
    display: gameData.display,
    layout: gameData.layout,
    cardsCache: gameData.cardsCache,
  });
});

