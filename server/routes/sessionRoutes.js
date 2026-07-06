import { Router } from "express";
import { getActiveGameId, setActiveGame } from "../db.js";
import { getGame, listGames } from "../games.js";
import { broadcastState } from "../hub.js";

export const sessionRoutes = Router();

sessionRoutes.get("/games", (_req, res) => {
  res.json(listGames());
});

sessionRoutes.get("/session", (_req, res) => {
  const activeGame = getActiveGameId();
  const game = getGame(activeGame);
  res.json({
    activeGame,
    gameName: game?.name || activeGame,
    controlPath: game?.controlPath || "/control",
    overlayPath: game?.overlayPath || "/overlay",
  });
});

sessionRoutes.post("/session/game", async (req, res) => {
  const gameId = req.body?.gameId;
  if (!gameId) return res.status(400).json({ error: "gameId required" });
  try {
    await setActiveGame(gameId);
    broadcastState();
    const game = getGame(gameId);
    res.json({
      ok: true,
      activeGame: gameId,
      gameName: game?.name || gameId,
      redirect: game?.controlPath || "/control",
    });
  } catch (err) {
    res.status(err.status || 400).json({ error: err.message });
  }
});

