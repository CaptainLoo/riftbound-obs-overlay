import { Router } from "express";
import { db } from "../db.js";
import { playerBattlefields, playerDisplayCards } from "../deckCards.js";
import { DEVICES } from "../streamdeckLayout.js";
import {
  getStreamDeckStatusSafe,
  queueStreamDeckRefreshImages,
  reconnectStreamDeckSafe,
} from "../streamdeckApi.js";

export const streamdeckRoutes = Router();

streamdeckRoutes.get("/streamdeck", async (_req, res) => {
  const hid = await getStreamDeckStatusSafe();
  const { players, match, display, cardsCache } = db.data;
  const showing = display?.cards || { p1: null, p2: null };
  const playerInfo = players.map((p) => {
    const info = playerDisplayCards(p, cardsCache);
    return {
      ...info,
      showing: showing[p.id] || null,
      battlefields: playerBattlefields(p, cardsCache),
      cardCount: info.cards.length,
    };
  });
  res.json({
    ...hid,
    players: playerInfo,
    showing,
    match: {
      currentGame: match.currentGame,
      currentScore: match.games[match.currentGame]?.score || { p1: 0, p2: 0 },
    },
    devices: DEVICES,
    hint: hid.connected
      ? "Stream Deck is controlled directly by Riftbound OBS — no Elgato app required."
      : "Quit the Elgato Stream Deck app completely, then click Reconnect.",
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
