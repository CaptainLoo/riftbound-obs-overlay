import { Router } from "express";
import { db, defaultLayout, defaultMatch, defaultDisplay, FORMATS, CARD_ANIMATIONS } from "./db.js";
import { playerDisplayCards, playerBattlefields, resolveDisplayCard, displayCardEntries } from "./deckCards.js";
import { searchByName, cacheCard } from "./riftscribe.js";
import { parseDecklist, resolveDecklist, resolveTTS } from "./decklist.js";
import { buildState, broadcastState } from "./hub.js";
import { DEVICES } from "./streamdeckLayout.js";
import { getStreamDeckStatus } from "./streamdeckDevice.js";
import {
  applyUpdate,
  checkForUpdate,
  downloadUpdate,
  getDownloadProgress,
  getLocalVersionInfo,
} from "./updater.js";
import { isLocalRequest } from "./update-utils.js";

export const router = Router();

const PLAYER_IDS = ["p1", "p2"];

function bumpCardReveal(player) {
  if (!db.data.display.cardReveal) db.data.display.cardReveal = { p1: 0, p2: 0 };
  db.data.display.cardReveal[player] = (db.data.display.cardReveal[player] || 0) + 1;
}

function findPlayer(id) {
  return db.data.players.find((p) => p.id === id);
}

async function cacheMany(ids) {
  const unique = [...new Set(ids.filter(Boolean))];
  for (const id of unique) {
    try {
      await cacheCard(id);
    } catch (err) {
      console.warn(`[cache] ${id}: ${err.message}`);
    }
  }
}

async function setDisplayCard(player, cardId) {
  if (player && !PLAYER_IDS.includes(player)) {
    throw Object.assign(new Error("invalid player"), { status: 400 });
  }
  if (cardId) await cacheMany([cardId]);
  if (!db.data.display.cards) db.data.display.cards = { p1: null, p2: null };
  if (player) {
    db.data.display.cards[player] = cardId;
    if (cardId) bumpCardReveal(player);
  } else {
    db.data.display.cards.p1 = cardId;
    if (cardId) bumpCardReveal("p1");
  }
  db.data.display.mode = "persistent";
  await db.write();
  broadcastState();
  return db.data.display;
}

// ---- Read state -----------------------------------------------------------

router.get("/state", (_req, res) => {
  res.json(buildState());
});

router.get("/data", (_req, res) => {
  res.json({
    players: db.data.players.map((p) => ({
      ...p,
      displayCards: displayCardEntries(p.deck, db.data.cardsCache),
    })),
    match: db.data.match,
    display: db.data.display,
    layout: db.data.layout,
    cardsCache: db.data.cardsCache,
  });
});

// ---- Card search (manual typeahead) --------------------------------------

router.get("/cards/search", async (req, res) => {
  try {
    const results = await searchByName(req.query.q);
    res.json(results);
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

// ---- Players & pseudos ----------------------------------------------------

router.post("/players/:id/pseudo", async (req, res) => {
  const player = findPlayer(req.params.id);
  if (!player) return res.status(404).json({ error: "unknown player" });
  player.pseudo = String(req.body?.pseudo ?? "");
  await db.write();
  broadcastState();
  res.json({ ok: true, pseudo: player.pseudo });
});

// ---- Decklist import ------------------------------------------------------

// Parse + resolve without saving, so the UI can confirm ambiguous cards.
router.post("/decklist/preview", async (req, res) => {
  try {
    const resolved =
      req.body?.format === "tts"
        ? await resolveTTS(req.body?.text)
        : await resolveDecklist(parseDecklist(req.body?.text));
    res.json(resolved);
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

// Save the final (confirmed) deck for a player.
router.post("/players/:id/deck", async (req, res) => {
  const player = findPlayer(req.params.id);
  if (!player) return res.status(404).json({ error: "unknown player" });

  const incoming = req.body?.deck ?? {};
  const norm = (arr) =>
    (Array.isArray(arr) ? arr : [])
      .map((e) => (typeof e === "string" ? { id: e, quantity: 1 } : e))
      .filter((e) => e && e.id)
      .map((e) => ({ id: e.id, quantity: Number(e.quantity) || 1 }));
  const normIds = (arr) =>
    (Array.isArray(arr) ? arr : [])
      .map((e) => (typeof e === "string" ? e : e?.id))
      .filter(Boolean);

  const deck = {
    legend: incoming.legend || null,
    // Champion units are declared explicitly in the "Champion" section.
    champions: normIds(incoming.champions),
    battlefields: norm(incoming.battlefields),
    maindeck: norm(incoming.maindeck),
    runes: norm(incoming.runes),
    sideboard: norm(incoming.sideboard),
  };

  const allIds = [
    deck.legend,
    ...deck.champions,
    ...deck.battlefields.map((e) => e.id),
    ...deck.maindeck.map((e) => e.id),
    ...deck.runes.map((e) => e.id),
    ...deck.sideboard.map((e) => e.id),
  ];
  await cacheMany(allIds);

  player.deck = deck;
  await db.write();
  broadcastState();
  res.json({ ok: true, deck });
});

// ---- Match (score / current game / per-game selections) -------------------

// Reset score, current game and per-game selections (keeps players, decks, format).
router.post("/match/reset", async (_req, res) => {
  db.data.match = defaultMatch(db.data.match.format);
  db.data.display = defaultDisplay();
  await db.write();
  broadcastState();
  res.json({ ok: true, match: db.data.match });
});

// Change the match format (Bo1/Bo3/Bo5): resizes the games array.
router.post("/match/format", async (req, res) => {
  const format = req.body?.format;
  if (!FORMATS[format]) return res.status(400).json({ error: "invalid format" });
  const need = FORMATS[format].games;
  const match = db.data.match;
  match.format = format;
  while (match.games.length < need) match.games.push({ battlefield: { p1: null, p2: null }, champion: { p1: null, p2: null }, score: { p1: 0, p2: 0 } });
  if (match.games.length > need) match.games.length = need;
  if (match.currentGame > need - 1) match.currentGame = need - 1;
  await db.write();
  broadcastState();
  res.json({ ok: true, match });
});

// A player wins the current game: increment their games-won tally and advance
// to the next game (whose points start fresh at 0-0), unless the match is
// already decided.
router.post("/match/win", async (req, res) => {
  const player = req.body?.player;
  if (!PLAYER_IDS.includes(player)) return res.status(400).json({ error: "invalid player" });
  const match = db.data.match;
  const toWin = FORMATS[match.format].win;
  const alreadyDecided = match.score.p1 >= toWin || match.score.p2 >= toWin;
  if (!alreadyDecided) {
    match.score[player] = (match.score[player] || 0) + 1;
    const played = match.score.p1 + match.score.p2;
    match.currentGame = Math.min(played, match.games.length - 1);
  }
  await db.write();
  broadcastState();
  res.json({ ok: true, match });
});

router.post("/match", async (req, res) => {
  const { score, currentGame } = req.body ?? {};
  const match = db.data.match;
  if (typeof currentGame === "number") {
    const max = match.games.length - 1;
    match.currentGame = Math.max(0, Math.min(max, currentGame));
  }
  // `score` sets the CURRENT game's points (each game keeps its own).
  if (score) {
    const game = match.games[match.currentGame];
    if (game) {
      if (typeof score.p1 === "number") game.score.p1 = Math.max(0, score.p1);
      if (typeof score.p2 === "number") game.score.p2 = Math.max(0, score.p2);
    }
  }
  await db.write();
  broadcastState();
  res.json({ ok: true, match });
});

// Set battlefield / champion for a given game and player.
router.post("/match/selection", async (req, res) => {
  const { gameIndex, player, slot, cardId } = req.body ?? {};
  const game = db.data.match.games[gameIndex];
  if (!game) return res.status(400).json({ error: "invalid gameIndex" });
  if (!PLAYER_IDS.includes(player)) return res.status(400).json({ error: "invalid player" });
  if (slot !== "battlefield" && slot !== "champion") {
    return res.status(400).json({ error: "invalid slot" });
  }
  if (cardId) await cacheMany([cardId]);
  game[slot][player] = cardId || null;
  await db.write();
  broadcastState();
  res.json({ ok: true, game });
});

// ---- On-demand card display ----------------------------------------------

router.get("/players/:id/cards", (req, res) => {
  const player = findPlayer(req.params.id);
  if (!player) return res.status(404).json({ error: "unknown player" });
  res.json(playerDisplayCards(player, db.data.cardsCache));
});

router.get("/streamdeck", (_req, res) => {
  const hid = getStreamDeckStatus();
  const showing = db.data.display?.cards || { p1: null, p2: null };
  const match = db.data.match;
  const players = db.data.players.map((p) => {
    const info = playerDisplayCards(p, db.data.cardsCache);
    const battlefields = playerBattlefields(p, db.data.cardsCache);
    return {
      ...info,
      showing: showing[p.id] || null,
      battlefields,
      cardCount: info.cards.length,
    };
  });
  res.json({
    ...hid,
    players,
    showing,
    match: {
      currentGame: match.currentGame,
      currentScore: match.games[match.currentGame]?.score || { p1: 0, p2: 0 },
    },
    devices: DEVICES,
    hint: hid.connected
      ? "Stream Deck is controlled directly by Riftbound OBS — no Elgato app required."
      : "Quit the Elgato Stream Deck app if it is running, then restart Riftbound OBS.",
  });
});

router.post("/streamdeck/reconnect", async (_req, res) => {
  try {
    const mod = await import("./streamdeckDevice.js");
    await mod.stopStreamDeck();
    await mod.startStreamDeck();
    res.json({ ok: true, ...mod.getStreamDeckStatus() });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// One-click GET URLs for Stream Deck (Website / Web Request plugins).
router.get("/hot/card/:player/:cardId", async (req, res) => {
  const player = req.params.player;
  if (!PLAYER_IDS.includes(player)) return res.status(400).json({ error: "invalid player" });
  const cardId = decodeURIComponent(req.params.cardId);
  try {
    const display = await setDisplayCard(player, cardId);
    const name = db.data.cardsCache[cardId]?.name || cardId;
    res.json({ ok: true, player, cardId, name, display });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

router.get("/hot/card/:player/index/:index", async (req, res) => {
  const player = req.params.player;
  if (!PLAYER_IDS.includes(player)) return res.status(400).json({ error: "invalid player" });
  const p = findPlayer(player);
  const index = Number(req.params.index);
  const cardId = resolveDisplayCard(p.deck, db.data.cardsCache, { index });
  if (!cardId) return res.status(404).json({ error: "card not found for index" });
  try {
    const display = await setDisplayCard(player, cardId);
    const name = db.data.cardsCache[cardId]?.name || cardId;
    res.json({ ok: true, player, cardId, name, index, display });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

router.get("/hot/clear", async (_req, res) => {
  db.data.display.mode = "persistent";
  if (!db.data.display.cards) db.data.display.cards = { p1: null, p2: null };
  db.data.display.cards.p1 = null;
  db.data.display.cards.p2 = null;
  await db.write();
  broadcastState();
  res.json({ ok: true, display: db.data.display });
});

router.get("/hot/clear/:player", async (req, res) => {
  const player = req.params.player;
  if (!PLAYER_IDS.includes(player)) return res.status(400).json({ error: "invalid player" });
  db.data.display.mode = "persistent";
  if (!db.data.display.cards) db.data.display.cards = { p1: null, p2: null };
  db.data.display.cards[player] = null;
  await db.write();
  broadcastState();
  res.json({ ok: true, display: db.data.display });
});

router.get("/hot/matchup", async (_req, res) => {
  db.data.display.mode = "matchup";
  if (db.data.display.cards) {
    db.data.display.cards.p1 = null;
    db.data.display.cards.p2 = null;
  }
  await db.write();
  broadcastState();
  res.json({ ok: true, display: db.data.display });
});

router.get("/hot/win/:player", async (req, res) => {
  const player = req.params.player;
  if (!PLAYER_IDS.includes(player)) return res.status(400).json({ error: "invalid player" });
  const match = db.data.match;
  const toWin = FORMATS[match.format].win;
  const alreadyDecided = match.score.p1 >= toWin || match.score.p2 >= toWin;
  if (!alreadyDecided) {
    match.score[player] = (match.score[player] || 0) + 1;
    const played = match.score.p1 + match.score.p2;
    match.currentGame = Math.min(played, match.games.length - 1);
  }
  await db.write();
  broadcastState();
  res.json({ ok: true, match });
});

router.get("/hot/battlefield/:player/:cardId", async (req, res) => {
  const player = req.params.player;
  if (!PLAYER_IDS.includes(player)) return res.status(400).json({ error: "invalid player" });
  const cardId = decodeURIComponent(req.params.cardId);
  const p = findPlayer(player);
  const allowed = (p?.deck?.battlefields || []).some((e) => e.id === cardId);
  if (!allowed) return res.status(400).json({ error: "battlefield not in player deck" });
  const gameIndex = db.data.match.currentGame;
  const game = db.data.match.games[gameIndex];
  if (!game) return res.status(400).json({ error: "invalid game" });
  await cacheMany([cardId]);
  game.battlefield[player] = cardId;
  await db.write();
  broadcastState();
  const name = db.data.cardsCache[cardId]?.name || cardId;
  res.json({ ok: true, gameIndex, player, cardId, name, game });
});

router.get("/hot/score/:player/:op", async (req, res) => {
  const player = req.params.player;
  if (!PLAYER_IDS.includes(player)) return res.status(400).json({ error: "invalid player" });
  const op = req.params.op;
  if (op !== "inc" && op !== "dec") return res.status(400).json({ error: "invalid op (inc|dec)" });
  const match = db.data.match;
  const game = match.games[match.currentGame];
  if (!game) return res.status(400).json({ error: "invalid game" });
  if (!game.score) game.score = { p1: 0, p2: 0 };
  const delta = op === "inc" ? 1 : -1;
  game.score[player] = Math.max(0, (game.score[player] || 0) + delta);
  await db.write();
  broadcastState();
  res.json({
    ok: true,
    player,
    delta,
    currentGame: match.currentGame,
    score: game.score,
  });
});

router.post("/display/card", async (req, res) => {
  const player = req.body?.player;
  let cardId = req.body?.cardId ?? null;

  if (player && !PLAYER_IDS.includes(player)) {
    return res.status(400).json({ error: "invalid player" });
  }

  if (cardId === undefined || cardId === null) {
    if (req.body?.index !== undefined || req.body?.name) {
      const p = findPlayer(player || "p1");
      if (!p) return res.status(404).json({ error: "unknown player" });
      cardId = resolveDisplayCard(p.deck, db.data.cardsCache, {
        index: req.body.index,
        name: req.body.name,
      });
      if (!cardId) return res.status(404).json({ error: "card not found" });
    } else {
      cardId = null;
    }
  }

  try {
    const display = await setDisplayCard(player || "p1", cardId);
    res.json({ ok: true, display });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

router.post("/display/animation", async (req, res) => {
  const animation = req.body?.animation;
  if (!CARD_ANIMATIONS.includes(animation)) {
    return res.status(400).json({ error: "invalid animation", allowed: CARD_ANIMATIONS });
  }
  db.data.display.cardAnimation = animation;
  // Replay on any card currently visible so a live style change is instant.
  for (const pid of PLAYER_IDS) {
    if (db.data.display.cards?.[pid]) bumpCardReveal(pid);
  }
  await db.write();
  broadcastState();
  res.json({ ok: true, display: db.data.display });
});

router.post("/display/matchup", async (_req, res) => {
  db.data.display.mode = "matchup";
  if (db.data.display.cards) {
    db.data.display.cards.p1 = null;
    db.data.display.cards.p2 = null;
  }
  await db.write();
  broadcastState();
  res.json({ ok: true, display: db.data.display });
});

router.post("/display/clear", async (req, res) => {
  const player = req.body?.player;
  db.data.display.mode = "persistent";
  if (!db.data.display.cards) db.data.display.cards = { p1: null, p2: null };
  if (player && PLAYER_IDS.includes(player)) {
    db.data.display.cards[player] = null;
  } else {
    db.data.display.cards.p1 = null;
    db.data.display.cards.p2 = null;
  }
  await db.write();
  broadcastState();
  res.json({ ok: true, display: db.data.display });
});

// ---- Layout ---------------------------------------------------------------

router.get("/layout", (_req, res) => {
  res.json(db.data.layout);
});

router.post("/layout/reset", async (_req, res) => {
  db.data.layout = defaultLayout();
  await db.write();
  broadcastState();
  res.json({ ok: true, layout: db.data.layout });
});

router.post("/layout/live", (req, res) => {
  const { slot, props } = req.body ?? {};
  if (slot && props && db.data.layout[slot]) {
    db.data.layout[slot] = { ...db.data.layout[slot], ...props };
    broadcastState();
  }
  res.json({ ok: true });
});

router.post("/layout", async (req, res) => {
  const { slot, props, layout } = req.body ?? {};
  if (layout && typeof layout === "object") {
    db.data.layout = layout;
  } else if (slot && props && db.data.layout[slot]) {
    db.data.layout[slot] = { ...db.data.layout[slot], ...props };
  } else {
    return res.status(400).json({ error: "provide either {layout} or {slot, props}" });
  }
  await db.write();
  broadcastState();
  res.json({ ok: true, layout: db.data.layout });
});

// ---- App version & updates (Windows portable) ------------------------------

router.get("/version", (_req, res) => {
  res.json(getLocalVersionInfo());
});

router.get("/update/check", async (_req, res) => {
  try {
    res.json(await checkForUpdate());
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get("/update/progress", (_req, res) => {
  res.json(getDownloadProgress() || { status: "idle" });
});

router.post("/update/download", async (_req, res) => {
  try {
    res.json(await downloadUpdate());
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post("/update/apply", (req, res) => {
  if (!isLocalRequest(req)) {
    return res.status(403).json({ error: "Apply is only allowed from localhost." });
  }
  try {
    const result = applyUpdate(req.body?.applyToken);
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});
