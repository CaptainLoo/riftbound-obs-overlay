import { WebSocketServer } from "ws";
import { getActiveGameData, getActiveGameId, FORMATS } from "./db.js";
import { getGame } from "./games.js";
import { getCachedCard } from "./cardProvider.js";
import { getGameAdapter } from "./gameAdapters/index.js";

let wss = null;

function card(id) {
  if (!id) return null;
  return getCachedCard(id);
}

function pokemonSide(side = {}) {
  return {
    active: card(side.active),
    bench: (Array.isArray(side.bench) ? side.bench : []).map(card).filter(Boolean),
  };
}

function getStateContext() {
  const gameData = getActiveGameData();
  const { players, match, display, layout, cardsCache } = gameData;
  const gameId = getActiveGameId();
  const gameInfo = getGame(gameId);
  const adapter = getGameAdapter(gameId);
  const game = match.games[match.currentGame] || { battlefield: {}, champion: {}, score: {} };
  const toWin = (FORMATS[match.format] || FORMATS.bo3).win;
  const winner =
    match.score.p1 >= toWin ? "p1" : match.score.p2 >= toWin ? "p2" : null;
  return { players, match, display, layout, cardsCache, gameId, gameInfo, adapter, game, toWin, winner };
}

export function buildStateSections() {
  const { players, match, display, layout, cardsCache, gameId, gameInfo, adapter, game, toWin, winner } =
    getStateContext();
  return {
    meta: {
      gameId,
      gameName: gameInfo?.name || gameId,
    },
    players: adapter.buildOverlayPlayers(players, cardsCache),
    match: {
      format: match.format,
      score: match.score,
      currentGame: match.currentGame,
      gameCount: match.games.length,
      toWin,
      winner,
    },
    game: {
      battlefield: {
        p1: card(game.battlefield?.p1),
        p2: card(game.battlefield?.p2),
      },
      champion: {
        p1: card(game.champion?.p1),
        p2: card(game.champion?.p2),
      },
      score: {
        p1: game.score?.p1 || 0,
        p2: game.score?.p2 || 0,
      },
      pokemon: {
        p1: pokemonSide(game.pokemon?.p1),
        p2: pokemonSide(game.pokemon?.p2),
      },
    },
    display: {
      mode: display.mode,
      cards: {
        p1: card(display.cards?.p1),
        p2: card(display.cards?.p2),
      },
      cardAnimation: display.cardAnimation || "pop",
      cardReveal: {
        p1: display.cardReveal?.p1 || 0,
        p2: display.cardReveal?.p2 || 0,
      },
    },
    layout,
  };
}

/** Build the overlay-facing state, resolving card ids to cached card data. */
export function buildState() {
  return buildStateSections();
}

export function initHub(server) {
  wss = new WebSocketServer({ server, path: "/ws" });
  wss.on("connection", (socket) => {
    socket.send(JSON.stringify({ type: "state", state: buildState() }));
  });
}

export function closeHub() {
  if (wss) {
    wss.close();
    wss = null;
  }
}

export function broadcastState() {
  if (!wss) return;
  const message = JSON.stringify({ type: "state", state: buildState() });
  for (const client of wss.clients) {
    if (client.readyState === 1) client.send(message);
  }
}

export function buildPatch(...sections) {
  const full = buildStateSections();
  const patch = {};
  for (const section of sections.flat()) {
    if (section in full) patch[section] = full[section];
  }
  return patch;
}

export function broadcastPatch(sections) {
  if (!wss) return;
  const list = Array.isArray(sections) ? sections : [sections];
  const patch = buildPatch(list);
  const message = JSON.stringify({ type: "patch", patch, sections: Object.keys(patch) });
  for (const client of wss.clients) {
    if (client.readyState === 1) client.send(message);
  }
}
