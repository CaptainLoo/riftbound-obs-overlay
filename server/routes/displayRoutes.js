import { Router } from "express";
import { CARD_ANIMATIONS, getActiveGameId } from "../db.js";
import { playerDisplayCards, resolveDisplayCard } from "../deckCards.js";
import { activeGameData } from "../services/stateService.js";
import { findPlayer, validatePlayerId } from "../services/playerService.js";
import {
  clearDisplay,
  resolveDisplayCardRequest,
  setAnimation,
  setDisplayCard,
  showMatchup,
} from "../services/displayService.js";

export const displayRoutes = Router();

displayRoutes.get("/players/:id/cards", (req, res) => {
  const player = findPlayer(req.params.id);
  if (!player) return res.status(404).json({ error: "unknown player" });
  res.json(playerDisplayCards(player, activeGameData().cardsCache, getActiveGameId()));
});

displayRoutes.get("/hot/card/:player/:cardId", async (req, res) => {
  const player = req.params.player;
  if (!validatePlayerId(player)) return res.status(400).json({ error: "invalid player" });
  const cardId = decodeURIComponent(req.params.cardId);
  try {
    const display = await setDisplayCard(player, cardId);
    const name = activeGameData().cardsCache[cardId]?.name || cardId;
    res.json({ ok: true, player, cardId, name, display });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

displayRoutes.get("/hot/card/:player/index/:index", async (req, res) => {
  const player = req.params.player;
  if (!validatePlayerId(player)) return res.status(400).json({ error: "invalid player" });
  const p = findPlayer(player);
  const index = Number(req.params.index);
  const cardId = resolveDisplayCard(p.deck, activeGameData().cardsCache, { index }, getActiveGameId());
  if (!cardId) return res.status(404).json({ error: "card not found for index" });
  try {
    const display = await setDisplayCard(player, cardId);
    const name = activeGameData().cardsCache[cardId]?.name || cardId;
    res.json({ ok: true, player, cardId, name, index, display });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

displayRoutes.get("/hot/clear", async (_req, res) => {
  try {
    res.json({ ok: true, display: await clearDisplay() });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

displayRoutes.get("/hot/clear/:player", async (req, res) => {
  const player = req.params.player;
  if (!validatePlayerId(player)) return res.status(400).json({ error: "invalid player" });
  try {
    res.json({ ok: true, display: await clearDisplay(player) });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

displayRoutes.get("/hot/matchup", async (_req, res) => {
  try {
    res.json({ ok: true, display: await showMatchup() });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

displayRoutes.post("/display/card", async (req, res) => {
  const player = req.body?.player;
  if (player && !validatePlayerId(player)) return res.status(400).json({ error: "invalid player" });
  try {
    const cardId = resolveDisplayCardRequest(player, {
      cardId: req.body?.cardId,
      index: req.body?.index,
      name: req.body?.name,
    });
    res.json({ ok: true, display: await setDisplayCard(player || "p1", cardId) });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

displayRoutes.post("/display/animation", async (req, res) => {
  try {
    res.json({ ok: true, display: await setAnimation(req.body?.animation) });
  } catch (err) {
    res.status(err.status || 500).json({
      error: err.message,
      allowed: err.allowed || CARD_ANIMATIONS,
    });
  }
});

displayRoutes.post("/display/matchup", async (_req, res) => {
  try {
    res.json({ ok: true, display: await showMatchup() });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

displayRoutes.post("/display/clear", async (req, res) => {
  try {
    res.json({ ok: true, display: await clearDisplay(req.body?.player) });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

