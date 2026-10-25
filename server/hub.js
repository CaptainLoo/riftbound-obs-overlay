import { WebSocketServer } from "ws";
import { db, FORMATS } from "./db.js";
import { buildOverlayPlayers } from "./deckCards.js";

let wss = null;

function card(cardsCache, id) {
  if (!id) return null;
  return cardsCache[id] || null;
}

/** Build the overlay-facing state, resolving card ids to cached card data. */
export function buildState() {
  const { players, match, display, layout, cardsCache } = db.data;
  const game = match.games[match.currentGame] || { battlefield: {}, champion: {}, score: {} };
  const toWin = (FORMATS[match.format] || FORMATS.bo3).win;
  const winner = match.score.p1 >= toWin ? "p1" : match.score.p2 >= toWin ? "p2" : null;

  return {
    players: buildOverlayPlayers(players, cardsCache),
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
        p1: card(cardsCache, game.battlefield?.p1),
        p2: card(cardsCache, game.battlefield?.p2),
      },
      champion: {
        p1: card(cardsCache, game.champion?.p1),
        p2: card(cardsCache, game.champion?.p2),
      },
      score: {
        p1: game.score?.p1 || 0,
        p2: game.score?.p2 || 0,
      },
    },
    display: {
      mode: display.mode,
      cards: {
        p1: card(cardsCache, display.cards?.p1),
        p2: card(cardsCache, display.cards?.p2),
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

function send(message) {
  for (const client of wss.clients) {
    if (client.readyState === 1) client.send(message);
  }
}

export function broadcastState() {
  if (!wss) return;
  send(JSON.stringify({ type: "state", state: buildState() }));
}

export function buildPatch(...sections) {
  const full = buildState();
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
  send(JSON.stringify({ type: "patch", patch, sections: Object.keys(patch) }));
}
