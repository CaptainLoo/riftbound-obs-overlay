import { Router } from "express";
import { db } from "../db.js";
import { displayCardEntries } from "../deckCards.js";
import { buildState } from "../hub.js";

export const dataRoutes = Router();

dataRoutes.get("/state", (_req, res) => {
  res.json(buildState());
});

dataRoutes.get("/data", (_req, res) => {
  const { players, match, display, layout, cardsCache } = db.data;
  res.json({
    players: players.map((p) => ({
      ...p,
      displayCards: displayCardEntries(p.deck, cardsCache),
    })),
    match,
    display,
    layout,
    cardsCache,
  });
});
