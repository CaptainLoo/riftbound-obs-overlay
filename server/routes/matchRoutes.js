import { Router } from "express";
import {
  hotBattlefield,
  hotScore,
  resetMatch,
  setMatchFormat,
  setSelection,
  updateMatch,
  updatePokemonBoard,
  winGame,
} from "../services/matchService.js";

export const matchRoutes = Router();

matchRoutes.post("/match/reset", async (_req, res) => {
  try {
    res.json({ ok: true, match: await resetMatch() });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

matchRoutes.post("/match/format", async (req, res) => {
  try {
    res.json({ ok: true, match: await setMatchFormat(req.body?.format) });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message, allowed: err.allowed });
  }
});

matchRoutes.post("/match/win", async (req, res) => {
  try {
    res.json({ ok: true, match: await winGame(req.body?.player) });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

matchRoutes.post("/match", async (req, res) => {
  try {
    res.json({ ok: true, match: await updateMatch(req.body ?? {}) });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

matchRoutes.post("/match/selection", async (req, res) => {
  try {
    res.json({ ok: true, game: await setSelection(req.body ?? {}) });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

matchRoutes.post("/match/pokemon-board", async (req, res) => {
  try {
    res.json({ ok: true, ...(await updatePokemonBoard(req.body ?? {})) });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

matchRoutes.get("/hot/win/:player", async (req, res) => {
  try {
    res.json({ ok: true, match: await winGame(req.params.player) });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

matchRoutes.get("/hot/battlefield/:player/:cardId", async (req, res) => {
  try {
    res.json({
      ok: true,
      ...(await hotBattlefield({
        player: req.params.player,
        cardId: decodeURIComponent(req.params.cardId),
      })),
    });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

matchRoutes.get("/hot/score/:player/:op", async (req, res) => {
  try {
    res.json({ ok: true, ...(await hotScore({ player: req.params.player, op: req.params.op })) });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

