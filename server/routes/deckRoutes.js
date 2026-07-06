import { Router } from "express";
import { db } from "../db.js";
import { broadcastState } from "../hub.js";
import { previewDecklist, savePlayerDeck, searchCards } from "../services/deckService.js";
import { requirePlayer } from "../services/playerService.js";

export const deckRoutes = Router();

deckRoutes.get("/cards/search", async (req, res) => {
  try {
    res.json(await searchCards(req.query.q));
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

deckRoutes.post("/players/:id/pseudo", async (req, res) => {
  try {
    const player = requirePlayer(req.params.id);
    player.pseudo = String(req.body?.pseudo ?? "");
    await db.write();
    broadcastState();
    res.json({ ok: true, pseudo: player.pseudo });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

deckRoutes.post("/decklist/preview", async (req, res) => {
  try {
    res.json(await previewDecklist({ format: req.body?.format, text: req.body?.text }));
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

deckRoutes.post("/players/:id/deck", async (req, res) => {
  try {
    const deck = await savePlayerDeck(req.params.id, req.body?.deck ?? {});
    res.json({ ok: true, deck });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

