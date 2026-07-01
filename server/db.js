import { mkdirSync } from "node:fs";
import { Low } from "lowdb";
import { JSONFile } from "lowdb/node";
import { DATA_DIR, CARDS_DIR, DB_FILE } from "./paths.js";

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

function makeGame() {
  return {
    battlefield: { p1: null, p2: null },
    champion: { p1: null, p2: null },
    // Per-game points (independent for each game, reset by moving to the next).
    score: { p1: 0, p2: 0 },
  };
}

const FORMATS = {
  bo1: { games: 1, win: 1 },
  bo3: { games: 3, win: 2 },
  bo5: { games: 5, win: 3 },
};

/** Card reveal animations for on-demand display (overlay CSS). */
const CARD_ANIMATIONS = ["none", "fade", "slide", "pop", "flip", "glow", "impact"];

function defaultDisplay() {
  return {
    mode: "persistent",
    cards: { p1: null, p2: null },
    cardAnimation: "pop",
    cardReveal: { p1: 0, p2: 0 },
  };
}

function defaultMatch(format = "bo3") {
  const n = (FORMATS[format] || FORMATS.bo3).games;
  return {
    format: FORMATS[format] ? format : "bo3",
    // Games won by each player (used for Bo1/Bo3/Bo5 winner detection).
    score: { p1: 0, p2: 0 },
    currentGame: 0,
    games: Array.from({ length: n }, makeGame),
  };
}

// Slot coordinates are expressed in % of the overlay canvas so the layout is
// independent from the OBS Browser Source resolution.
const CARD_PORTRAIT = 744 / 1039;
const CARD_LANDSCAPE = 1039 / 744;
const CANVAS_RATIO = 16 / 9;

function slotHeight(widthPct, ratio) {
  return Math.round(((widthPct * CANVAS_RATIO) / ratio) * 10) / 10;
}

function splitLegendGroups(layout, defaults) {
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

function defaultLayout() {
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

function defaultData() {
  return {
    cardsCache: {},
    players: [makePlayer("p1"), makePlayer("p2")],
    match: defaultMatch(),
    display: defaultDisplay(),
    layout: defaultLayout(),
  };
}

mkdirSync(DATA_DIR, { recursive: true });
mkdirSync(CARDS_DIR, { recursive: true });

const adapter = new JSONFile(DB_FILE);
export const db = new Low(adapter, defaultData());

export async function initDb() {
  await db.read();
  db.data ||= defaultData();
  // Backfill any missing top-level keys (e.g. after an upgrade).
  const defaults = defaultData();
  for (const key of Object.keys(defaults)) {
    if (db.data[key] === undefined) db.data[key] = defaults[key];
  }
  // Ensure every layout slot exists.
  splitLegendGroups(db.data.layout, defaults.layout);
  for (const [slot, value] of Object.entries(defaults.layout)) {
    db.data.layout[slot] ||= value;
  }
  // Keep image slot heights aligned with real card aspect ratios.
  for (const [slot, cfg] of Object.entries(db.data.layout)) {
    const ratio =
      slot.endsWith(".legend") || slot.endsWith(".card")
        ? CARD_PORTRAIT
        : slot.endsWith(".battlefield")
          ? CARD_LANDSCAPE
          : null;
    if (ratio && cfg?.width) cfg.height = slotHeight(cfg.width, ratio);
  }
  delete db.data.layout["p1.legendGroup"];
  delete db.data.layout["p2.legendGroup"];
  // Normalize match against its format (backfill older data).
  const match = db.data.match;
  match.format = FORMATS[match.format] ? match.format : "bo3";
  const need = FORMATS[match.format].games;
  while (match.games.length < need) match.games.push(makeGame());
  if (match.games.length > need) match.games.length = need;
  if (match.currentGame > need - 1) match.currentGame = need - 1;
  // Backfill per-player on-demand card display (replaces single center slot).
  const display = db.data.display;
  if (!display.cards || typeof display.cards !== "object") {
    display.cards = { p1: null, p2: null };
  }
  for (const pid of ["p1", "p2"]) {
    if (display.cards[pid] === undefined) display.cards[pid] = null;
  }
  if (display.currentCardId) {
    display.cards.p1 ||= display.currentCardId;
    delete display.currentCardId;
  }
  if (!CARD_ANIMATIONS.includes(display.cardAnimation)) display.cardAnimation = "pop";
  if (!display.cardReveal || typeof display.cardReveal !== "object") {
    display.cardReveal = { p1: 0, p2: 0 };
  }
  for (const pid of ["p1", "p2"]) {
    if (typeof display.cardReveal[pid] !== "number") display.cardReveal[pid] = 0;
  }
  // Backfill per-game points on older data.
  for (const g of match.games) {
    if (!g.score || typeof g.score !== "object") g.score = { p1: 0, p2: 0 };
    if (typeof g.score.p1 !== "number") g.score.p1 = 0;
    if (typeof g.score.p2 !== "number") g.score.p2 = 0;
  }
  await db.write();
  return db;
}

export { defaultLayout, defaultMatch, makePlayer, FORMATS, CARD_ANIMATIONS, defaultDisplay };
