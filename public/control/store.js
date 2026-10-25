/**
 * Single source of truth for the control panel.
 *
 *   data      — the /api/data payload (players with displayCards, match, display, layout, cardsCache)
 *   sdStatus  — the Stream Deck worker status pushed by the server over WebSocket
 *
 * WebSocket patches are merged into `data` in place; anything that depends on
 * server-side derived data (displayCards, cardsCache, games array length) triggers
 * one `reloadData()` so the panel never renders stale names.
 */
import { connectState } from "/shared/ws.js";
import { normalizeLayout } from "/shared/layout.js";
import { api } from "./api.js";

let data = null;
let sdStatus = null;
const listeners = new Set();
const sdListeners = new Set();

export function getData() {
  return data;
}

export function setData(next) {
  data = next;
  if (data?.layout) data.layout = normalizeLayout(data.layout);
  return data;
}

export async function reloadData() {
  return setData(await api("/api/data"));
}

/** fn(data, { type: "state" | "patch", sections: string[] }) */
export function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function notify(info) {
  for (const fn of listeners) fn(data, info);
}

export function getStreamDeckStatus() {
  return sdStatus;
}

export function setStreamDeckStatus(status) {
  sdStatus = status;
  for (const fn of sdListeners) fn(sdStatus);
}

/** fn(status) — called immediately when a status is already known. */
export function subscribeStreamDeck(fn) {
  sdListeners.add(fn);
  if (sdStatus) fn(sdStatus);
  return () => sdListeners.delete(fn);
}

const cardId = (card) => card?.id ?? null;

/** Merge the overlay-shaped WS state into the panel's /api/data-shaped data. Returns true when a reload is required. */
function mergeState(state, sections) {
  let needsReload = false;

  if (sections.has("match") && state.match) {
    data.match.format = state.match.format;
    data.match.score = state.match.score;
    data.match.currentGame = state.match.currentGame;
    if (typeof state.match.gameCount === "number" && state.match.gameCount !== data.match.games.length) {
      needsReload = true;
    }
  }
  if (sections.has("game") && state.game) {
    const g = data.match.games[state.match?.currentGame ?? data.match.currentGame];
    if (g) {
      if (state.game.score) g.score = { p1: state.game.score.p1, p2: state.game.score.p2 };
      if (state.game.battlefield) g.battlefield = { p1: cardId(state.game.battlefield.p1), p2: cardId(state.game.battlefield.p2) };
      if (state.game.champion) g.champion = { p1: cardId(state.game.champion.p1), p2: cardId(state.game.champion.p2) };
    }
  }
  if (sections.has("display") && state.display) {
    data.display = data.display || {};
    data.display.mode = state.display.mode;
    if (state.display.cardAnimation) data.display.cardAnimation = state.display.cardAnimation;
    if (state.display.cards) {
      data.display.cards = { p1: cardId(state.display.cards.p1), p2: cardId(state.display.cards.p2) };
    }
  }
  if (sections.has("layout") && state.layout) {
    data.layout = normalizeLayout(state.layout);
  }
  if (sections.has("players")) {
    // Names come through, but displayCards / cardsCache do not: refresh them.
    needsReload = true;
  }
  return needsReload;
}

let firstStateSeen = false;

export function startStateSocket() {
  connectState(
    (state, info) => {
      if (!data) return;
      const sections = new Set(info.sections || []);
      const isFull = info.type !== "patch";

      let needsReload = mergeState(state, sections);
      if (isFull) {
        // The very first full state right after boot duplicates /api/data; later ones mean a reconnect.
        needsReload = firstStateSeen;
        firstStateSeen = true;
      }

      if (needsReload) {
        reloadData()
          .then(() => notify({ type: "state", sections: ["players", "match", "game", "display", "layout"] }))
          .catch(() => notify(info));
      } else {
        notify(info);
      }
    },
    {
      onMessage: (msg) => {
        if (msg?.type === "streamdeck" && msg.status) setStreamDeckStatus(msg.status);
      },
    }
  );
}
