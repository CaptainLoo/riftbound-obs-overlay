import { WebSocketServer } from "ws";
import { db, FORMATS } from "./db.js";
import { getCachedCard } from "./riftscribe.js";

let wss = null;

function card(id) {
  if (!id) return null;
  return getCachedCard(id);
}

/** Build the overlay-facing state, resolving card ids to cached card data. */
export function buildState() {
  const { players, match, display, layout } = db.data;
  const game = match.games[match.currentGame] || { battlefield: {}, champion: {}, score: {} };
  const toWin = (FORMATS[match.format] || FORMATS.bo3).win;
  const winner =
    match.score.p1 >= toWin ? "p1" : match.score.p2 >= toWin ? "p2" : null;

  return {
    players: players.map((p) => ({
      id: p.id,
      pseudo: p.pseudo,
      legend: card(p.deck.legend),
      champion: card((p.deck.champions || [])[0]),
      battlefields: (p.deck.battlefields || []).map((e) => card(e.id)).filter(Boolean),
    })),
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
      // Per-game points shown live on the overlay.
      score: {
        p1: game.score?.p1 || 0,
        p2: game.score?.p2 || 0,
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

export function initHub(server) {
  wss = new WebSocketServer({ server, path: "/ws" });
  wss.on("connection", (socket) => {
    socket.send(JSON.stringify({ type: "state", state: buildState() }));
  });
}

/** Push the current state to every connected overlay/control client. */
export function broadcastState() {
  if (!wss) return;
  const message = JSON.stringify({ type: "state", state: buildState() });
  for (const client of wss.clients) {
    if (client.readyState === 1) client.send(message);
  }
  import("./streamdeckApi.js")
    .then((m) => m.refreshStreamDeckIfConnectedSafe())
    .catch(() => {});
}
