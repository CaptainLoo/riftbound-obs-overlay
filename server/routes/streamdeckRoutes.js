import { Router } from "express";
import { getActiveGameId } from "../db.js";
import { playerBattlefields, playerDisplayCards } from "../deckCards.js";
import { DEVICES } from "../streamdeckLayout.js";
import {
  getStreamDeckStatusSafe,
  queueStreamDeckRefreshImages,
  reconnectStreamDeckSafe,
} from "../streamdeckApi.js";
import { activeGameData } from "../services/stateService.js";

export const streamdeckRoutes = Router();

streamdeckRoutes.get("/streamdeck", async (_req, res) => {
  const hid = await getStreamDeckStatusSafe();
  const gameData = activeGameData();
  const gameId = getActiveGameId();
  const showing = gameData.display?.cards || { p1: null, p2: null };
  const match = gameData.match;
  const players = gameData.players.map((p) => {
    const info = playerDisplayCards(p, gameData.cardsCache, gameId);
    const battlefields = playerBattlefields(p, gameData.cardsCache, gameId);
    return {
      ...info,
      showing: showing[p.id] || null,
      battlefields,
      cardCount: info.cards.length,
    };
  });
  res.json({
    ...hid,
    players,
    showing,
    match: {
      currentGame: match.currentGame,
      currentScore: match.games[match.currentGame]?.score || { p1: 0, p2: 0 },
    },
    devices: DEVICES,
    hint: hid.connected
      ? "Stream Deck is controlled directly by Riftbound OBS — no Elgato app required."
      : "Quit the Elgato Stream Deck app (system tray + end StreamDeck.exe in Task Manager), then click Reconnect.",
  });
});

streamdeckRoutes.post("/streamdeck/reconnect", async (_req, res) => {
  try {
    const status = await reconnectStreamDeckSafe();
    res.json({ ok: true, ...status });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

streamdeckRoutes.post("/streamdeck/refresh-images", async (_req, res) => {
  const queued = queueStreamDeckRefreshImages(true);
  if (!queued) {
    return res.status(503).json({ ok: false, error: "Stream Deck worker is not running." });
  }
  res.json({ ok: true, queued: true });
});

