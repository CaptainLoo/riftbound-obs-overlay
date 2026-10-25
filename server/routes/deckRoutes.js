import { Router } from "express";
import { previewDecklist, savePlayerDeck, searchCards } from "../services/deckService.js";
import { repairMany } from "../services/cardCacheService.js";
import { setPseudo } from "../services/playerService.js";
import { commit } from "../services/stateService.js";

export const deckRoutes = Router();

deckRoutes.get("/cards/search", async (req, res) => {
  try {
    res.json(await searchCards(req.query.q));
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

/** Re-download cards whose images are missing on disk (Stream Deck worker, maintenance). */
deckRoutes.post("/cards/repair", async (req, res) => {
  try {
    const result = await repairMany(req.body?.ids);
    if (result.repaired.length) commit(["players"]);
    res.json({ ok: true, ...result });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

deckRoutes.post("/players/:id/pseudo", (req, res) => {
  try {
    res.json({ ok: true, pseudo: setPseudo(req.params.id, req.body?.pseudo) });
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
    const { deck, pendingImages } = await savePlayerDeck(req.params.id, req.body?.deck ?? {});
    res.json({ ok: true, deck, pendingImages });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});
