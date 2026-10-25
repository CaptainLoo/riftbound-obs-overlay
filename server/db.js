import { existsSync, readdirSync, renameSync, rmSync, statSync } from "node:fs";
import { join } from "node:path";
import { Low } from "lowdb";
import { JSONFile } from "lowdb/node";
import { CARDS_DIR, DATA_DIR, DB_FILE, ensureDataDirs } from "./paths.js";

// ---------------------------------------------------------------------------
// Deck shape (Riftbound)
// ---------------------------------------------------------------------------

function makePlayer(id) {
  return {
    id,
    pseudo: "",
    deck: {
      legend: null,
      champions: [],
      battlefields: [],
      maindeck: [],
      runes: [],
      sideboard: [],
    },
  };
}

function ensurePlayerDeck(player) {
  player.deck ||= {};
  player.deck.legend ??= null;
  player.deck.champions ||= [];
  player.deck.battlefields ||= [];
  player.deck.maindeck ||= [];
  player.deck.runes ||= [];
  player.deck.sideboard ||= [];
  return player;
}

const normEntries = (arr) =>
  (Array.isArray(arr) ? arr : [])
    .map((e) => (typeof e === "string" ? { id: e, quantity: 1 } : e))
    .filter((e) => e && e.id)
    .map((e) => ({ id: e.id, quantity: Number(e.quantity) || 1 }));

const normIds = (arr) =>
  (Array.isArray(arr) ? arr : []).map((e) => (typeof e === "string" ? e : e?.id)).filter(Boolean);

/** Normalize a deck payload from the control panel / API into the stored shape. */
export function normalizeDeck(input = {}) {
  return {
    legend: input.legend || null,
    champions: normIds(input.champions),
    battlefields: normEntries(input.battlefields),
    maindeck: normEntries(input.maindeck),
    runes: normEntries(input.runes),
    sideboard: normEntries(input.sideboard),
  };
}

/** Every card id referenced by a deck (for image caching). */
export function deckCardIds(deck = {}) {
  return [
    deck.legend,
    ...(deck.champions || []),
    ...(deck.battlefields || []).map((e) => e.id),
    ...(deck.maindeck || []).map((e) => e.id),
    ...(deck.runes || []).map((e) => e.id),
    ...(deck.sideboard || []).map((e) => e.id),
  ].filter(Boolean);
}

// ---------------------------------------------------------------------------
// Match / display / layout defaults
// ---------------------------------------------------------------------------

export function makeGame() {
  return {
    battlefield: { p1: null, p2: null },
    champion: { p1: null, p2: null },
    score: { p1: 0, p2: 0 },
  };
}

export const FORMATS = {
  bo1: { games: 1, win: 1 },
  bo3: { games: 3, win: 2 },
  bo5: { games: 5, win: 3 },
};

/** Card reveal animations for on-demand display (overlay CSS). */
export const CARD_ANIMATIONS = ["none", "fade", "slide", "pop", "flip", "glow", "impact"];

export function defaultDisplay() {
  return {
    mode: "persistent",
    cards: { p1: null, p2: null },
    cardAnimation: "pop",
    cardReveal: { p1: 0, p2: 0 },
  };
}

export function defaultMatch(format = "bo3") {
  const n = (FORMATS[format] || FORMATS.bo3).games;
  return {
    format: FORMATS[format] ? format : "bo3",
    score: { p1: 0, p2: 0 },
    currentGame: 0,
    games: Array.from({ length: n }, makeGame),
  };
}

const CARD_PORTRAIT = 744 / 1039;
const CARD_LANDSCAPE = 1039 / 744;
const CANVAS_RATIO = 16 / 9;

function slotHeight(widthPct, ratio) {
  return Math.round(((widthPct * CANVAS_RATIO) / ratio) * 10) / 10;
}

export function defaultLayout() {
  return {
    "p1.pseudo": { x: 2, y: 10.2, width: 11, height: 5, visible: true, fontSize: 3.2, align: "center", color: "#ffffff" },
    "p2.pseudo": { x: 86.83477740719258, y: 10.257199020366073, width: 11, height: 5, visible: true, fontSize: 3.2, align: "center", color: "#ffffff" },
    score: { x: 42, y: 3, width: 16, height: 7, visible: false, fontSize: 5, align: "center", color: "#ffffff" },
    playArea: { x: 18.265099182241737, y: 8.169919287666701, width: 63.55587296983759, height: 91.8300807123333, visible: true },
    "match.tally": {
      x: 18.265566995359634,
      y: 88.70675431812323,
      width: 63.47521026682134,
      height: 11.293245681876773,
      visible: true,
      fontSize: 2.2,
      align: "center",
      color: "#8fa8cc",
    },
    "p1.legend": { x: 2, y: 16, width: 11, height: 27.3, visible: true },
    "p2.legend": { x: 86.56020648077944, y: 15.781077880123147, width: 11, height: 27.3, visible: true },
    "p1.battlefield": { x: 2, y: 44.3, width: 14, height: 17.8, visible: true },
    "p2.battlefield": { x: 84, y: 44.3, width: 14, height: 17.8, visible: true },
    "p1.card": { x: 2, y: 63.1, width: 11, height: 27.3, visible: true },
    "p2.card": { x: 87.01404799883991, y: 63.1, width: 11, height: 27.3, visible: true },
    "p1.champion": { x: 2, y: 86.2, width: 16, height: 5, visible: false, fontSize: 2.4, align: "center", color: "#dce6f5" },
    "p2.champion": { x: 82, y: 62.2, width: 16, height: 5, visible: false, fontSize: 2.4, align: "center", color: "#dce6f5" },
  };
}

export function defaultData() {
  return {
    cardsCache: {},
    players: [makePlayer("p1"), makePlayer("p2")],
    match: defaultMatch(),
    display: defaultDisplay(),
    layout: defaultLayout(),
  };
}

// ---------------------------------------------------------------------------
// Migrations (pure, testable)
// ---------------------------------------------------------------------------

/** Split the pre-v1 `legendGroup` block into `pseudo` + `legend` slots. */
function splitLegendGroups(layout) {
  const pseudoBand = 5;
  for (const side of ["p1", "p2"]) {
    const gKey = `${side}.legendGroup`;
    const group = layout[gKey];
    if (!group) continue;

    const lh = slotHeight(group.width, CARD_PORTRAIT);
    layout[`${side}.pseudo`] = {
      x: group.x,
      y: group.y,
      width: Math.max(group.width, 16),
      height: pseudoBand,
      visible: group.visible !== false,
      fontSize: group.fontSize ?? 3.2,
      align: "center",
      color: group.color ?? "#ffffff",
    };
    layout[`${side}.legend`] = {
      x: group.x,
      y: Math.round((group.y + pseudoBand) * 10) / 10,
      width: group.width,
      height: lh,
      visible: group.visible !== false,
    };
    delete layout[gKey];
  }
}

/** `/cards/<game>/<file>` (v2.2 multi-game layout) → `/cards/<file>`. */
function flattenCardPath(path) {
  if (!path || typeof path !== "string") return path;
  const m = path.match(/^\/cards\/[^/]+\/([^/]+)$/);
  return m ? `/cards/${m[1]}` : path;
}

/**
 * Bring any stored shape to the current flat Riftbound-only schema.
 *   - v2.2 multi-game: { session: { activeGame }, games: { riftbound, pokemon } }
 *   - v2.1 and earlier: flat { cardsCache, players, match, display, layout }
 * Returns { data, changed }.
 */
export function migrateData(raw) {
  let changed = false;
  let data = raw && typeof raw === "object" ? raw : null;
  if (!data) return { data: defaultData(), changed: true };

  if (data.games && typeof data.games === "object") {
    // Always take the Riftbound slice, never the "active" game.
    const rb = data.games.riftbound && typeof data.games.riftbound === "object" ? data.games.riftbound : {};
    data = {
      cardsCache: rb.cardsCache || {},
      players: rb.players,
      match: rb.match,
      display: rb.display,
      layout: rb.layout,
    };
    changed = true;
  }

  for (const key of ["session", "games", "layoutVersion"]) {
    if (key in data) {
      delete data[key];
      changed = true;
    }
  }

  const defaults = defaultData();
  for (const key of Object.keys(defaults)) {
    if (data[key] === undefined || data[key] === null) {
      data[key] = defaults[key];
      changed = true;
    }
  }

  for (const entry of Object.values(data.cardsCache)) {
    if (!entry || typeof entry !== "object") continue;
    for (const field of ["imageLocal", "thumbLocal"]) {
      const next = flattenCardPath(entry[field]);
      if (next !== entry[field]) {
        entry[field] = next;
        changed = true;
      }
    }
  }

  if (!Array.isArray(data.players) || data.players.length !== 2) {
    data.players = [makePlayer("p1"), makePlayer("p2")];
    changed = true;
  }
  for (const player of data.players) ensurePlayerDeck(player);

  // Layout
  const beforeLayout = JSON.stringify(data.layout);
  splitLegendGroups(data.layout);
  for (const [slot, value] of Object.entries(defaults.layout)) {
    data.layout[slot] ||= value;
  }
  for (const [slot, cfg] of Object.entries(data.layout)) {
    const ratio =
      slot.endsWith(".legend") || slot.endsWith(".card")
        ? CARD_PORTRAIT
        : slot.endsWith(".battlefield")
          ? CARD_LANDSCAPE
          : null;
    if (ratio && cfg?.width) cfg.height = slotHeight(cfg.width, ratio);
  }
  delete data.layout["p1.legendGroup"];
  delete data.layout["p2.legendGroup"];
  if (JSON.stringify(data.layout) !== beforeLayout) changed = true;

  // Match
  const match = data.match;
  const beforeMatch = JSON.stringify(match);
  match.format = FORMATS[match.format] ? match.format : "bo3";
  match.score ||= { p1: 0, p2: 0 };
  if (typeof match.currentGame !== "number") match.currentGame = 0;
  match.games = Array.isArray(match.games) ? match.games : [];
  const need = FORMATS[match.format].games;
  while (match.games.length < need) match.games.push(makeGame());
  if (match.games.length > need) match.games.length = need;
  if (match.currentGame > need - 1) match.currentGame = need - 1;
  for (const g of match.games) {
    if (!g.battlefield || typeof g.battlefield !== "object") g.battlefield = { p1: null, p2: null };
    if (!g.champion || typeof g.champion !== "object") g.champion = { p1: null, p2: null };
    if (!g.score || typeof g.score !== "object") g.score = { p1: 0, p2: 0 };
    if (typeof g.score.p1 !== "number") g.score.p1 = 0;
    if (typeof g.score.p2 !== "number") g.score.p2 = 0;
    delete g.pokemon;
  }
  if (JSON.stringify(match) !== beforeMatch) changed = true;

  // Display
  const display = data.display;
  const beforeDisplay = JSON.stringify(display);
  if (!display.cards || typeof display.cards !== "object") display.cards = { p1: null, p2: null };
  for (const pid of ["p1", "p2"]) {
    if (display.cards[pid] === undefined) display.cards[pid] = null;
  }
  if (display.currentCardId) {
    display.cards.p1 ||= display.currentCardId;
    delete display.currentCardId;
  }
  if (!CARD_ANIMATIONS.includes(display.cardAnimation)) display.cardAnimation = "pop";
  if (!display.cardReveal || typeof display.cardReveal !== "object") display.cardReveal = { p1: 0, p2: 0 };
  for (const pid of ["p1", "p2"]) {
    if (typeof display.cardReveal[pid] !== "number") display.cardReveal[pid] = 0;
  }
  if (JSON.stringify(display) !== beforeDisplay) changed = true;

  return { data, changed };
}

/**
 * Move images out of the v2.2 per-game folders back into `data/cards/`, and
 * remove Pokémon leftovers. Safe to run on every start (no-op once done).
 */
function migrateCardFiles() {
  const legacy = join(CARDS_DIR, "riftbound");
  if (existsSync(legacy)) {
    let entries = [];
    try {
      entries = readdirSync(legacy);
    } catch {
      entries = [];
    }
    for (const name of entries) {
      const src = join(legacy, name);
      const dest = join(CARDS_DIR, name);
      try {
        if (!statSync(src).isFile()) continue;
        if (existsSync(dest)) rmSync(src, { force: true });
        else renameSync(src, dest);
      } catch {
        /* ignore and keep going */
      }
    }
    rmSync(legacy, { recursive: true, force: true });
  }
  rmSync(join(CARDS_DIR, "pokemon"), { recursive: true, force: true });
  rmSync(join(DATA_DIR, "pokemon-set-index.json"), { force: true });
  // Stream Deck scratch thumbs used to live next to the card images.
  try {
    for (const name of readdirSync(CARDS_DIR)) {
      if (name.endsWith("-sd96.rgb")) rmSync(join(CARDS_DIR, name), { force: true });
    }
  } catch {
    /* ignore */
  }
}

// ---------------------------------------------------------------------------
// Database instance
// ---------------------------------------------------------------------------

ensureDataDirs();

const adapter = new JSONFile(DB_FILE);
export const db = new Low(adapter, defaultData());

export async function initDb() {
  await db.read();
  const { data, changed } = migrateData(db.data);
  db.data = data;
  migrateCardFiles();
  if (changed || !existsSync(DB_FILE)) await db.write();
  return db;
}
