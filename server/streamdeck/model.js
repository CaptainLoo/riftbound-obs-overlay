/**
 * The Stream Deck worker never reads the database: the server builds this
 * self-contained model and pushes it over IPC whenever its revision changes.
 */
import { createHash } from "node:crypto";
import { db } from "../db.js";
import { playerBattlefields, playerDisplayCards } from "../deckCards.js";

export function buildStreamDeckModel(data = db.data) {
  const { players, match, display, cardsCache } = data;
  const cards = {};
  const ref = (id) => {
    if (!id || cards[id]) return;
    const c = cardsCache[id];
    cards[id] = {
      name: c?.name || id,
      thumbLocal: c?.thumbLocal || null,
      imageLocal: c?.imageLocal || null,
    };
  };

  const modelPlayers = players.map((p) => {
    const info = playerDisplayCards(p, cardsCache);
    const battlefields = playerBattlefields(p, cardsCache);
    for (const c of info.cards) ref(c.id);
    for (const b of battlefields) ref(b.id);
    return { id: p.id, pseudo: p.pseudo || "", cards: info.cards, battlefields };
  });

  const body = {
    players: modelPlayers,
    match: {
      format: match.format,
      currentGame: match.currentGame,
      games: match.games.map((g) => ({
        score: { p1: g.score?.p1 || 0, p2: g.score?.p2 || 0 },
        battlefield: { p1: g.battlefield?.p1 || null, p2: g.battlefield?.p2 || null },
      })),
    },
    display: {
      cards: { p1: display.cards?.p1 || null, p2: display.cards?.p2 || null },
    },
    cards,
  };

  const rev = createHash("sha1").update(JSON.stringify(body)).digest("hex").slice(0, 16);
  return { rev, ...body };
}
