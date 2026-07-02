import { playerBattlefields, playerDisplayCards } from "./deckCards.js";

export const DEVICES = {
  standard: { model: "20GBD9901", cols: 5, rows: 3, label: "Stream Deck (15 keys)" },
  xl: { model: "20GAV9901", cols: 8, rows: 4, label: "Stream Deck XL (32 keys)" },
  mini: { model: "20GAT9901", cols: 3, rows: 2, label: "Stream Deck Mini (6 keys)" },
};

/** Linear key index (row-major), matches @elgato-stream-deck/core grid. */
export function keyIndex(device, col, row) {
  return row * device.cols + col;
}

function navIndices(device) {
  const lastRow = device.rows - 1;
  const lastCol = device.cols - 1;
  return {
    prev: keyIndex(device, 0, lastRow),
    next: keyIndex(device, lastCol, lastRow),
  };
}

/** Grid slots excluding bottom-left and bottom-right navigation keys. */
export function cardSlotIndices(device) {
  const { prev, next } = navIndices(device);
  const slots = [];
  for (let row = 0; row < device.rows; row++) {
    for (let col = 0; col < device.cols; col++) {
      const idx = keyIndex(device, col, row);
      if (idx === prev || idx === next) continue;
      slots.push(idx);
    }
  }
  return slots;
}

function shortName(name, max = 18) {
  return String(name || "").slice(0, max);
}

function putKey(keys, device, col, row, def) {
  keys.set(keyIndex(device, col, row), def);
}

function addNavigation(keys, device) {
  const { prev, next } = navIndices(device);
  keys.set(prev, { type: "navPrev", label: "◀ Prev" });
  keys.set(next, { type: "navNext", label: "Next ▶" });
}

function enrichGamePointLabel(def, data) {
  const player = def.settings?.player;
  const delta = def.settings?.delta ?? 1;
  const pts = data.match?.games?.[data.match?.currentGame ?? 0]?.score?.[player] ?? 0;
  const prefix = player === "p1" ? "P1" : "P2";
  return `${prefix} ${delta > 0 ? "+" : "−"} (${pts})`;
}

function enrichBattlefieldDef(def, data) {
  const player = def.settings?.player;
  const cardId = def.settings?.cardId;
  const current = data.match?.games?.[data.match?.currentGame ?? 0]?.battlefield?.[player];
  const active = current === cardId;
  def.active = active;
  const base = String(def.label || "").replace(/^✓\s*/, "");
  def.label = active ? `✓ ${base}` : base;
  return def;
}

function enrichSelectGameDef(def, data) {
  const idx = Number(def.settings?.index) || 0;
  const current = data.match?.currentGame ?? 0;
  const active = idx === current;
  def.active = active;
  const base = String(def.label || "").replace(/^[●]\s*/, "");
  def.label = active ? `● ${base}` : base;
  return def;
}

function buildControlKeys(device, data) {
  const keys = new Map();
  const p1 = data.players?.[0];
  const p2 = data.players?.[1];
  const p1Bfs = p1 ? playerBattlefields(p1, data.cardsCache) : [];
  const p2Bfs = p2 ? playerBattlefields(p2, data.cardsCache) : [];

  if (device.cols >= 8 && device.rows >= 4) {
    putKey(keys, device, 0, 0, { type: "hideAll", label: "Hide all", icon: "hide" });
    putKey(keys, device, 1, 0, { type: "matchup", label: "Matchup", icon: "matchup" });
    putKey(keys, device, 2, 0, { type: "resetMatch", label: "Reset", icon: "reset" });
    putKey(keys, device, 3, 0, enrichSelectGameDef({ type: "selectGame", label: "Game 1", icon: "game", settings: { index: 0 } }, data));
    putKey(keys, device, 4, 0, enrichSelectGameDef({ type: "selectGame", label: "Game 2", icon: "game", settings: { index: 1 } }, data));
    putKey(keys, device, 5, 0, enrichSelectGameDef({ type: "selectGame", label: "Game 3", icon: "game", settings: { index: 2 } }, data));
    putKey(keys, device, 6, 0, { type: "winGame", label: "P1 Win", icon: "win", settings: { player: "p1" } });
    putKey(keys, device, 7, 0, { type: "winGame", label: "P2 Win", icon: "win", settings: { player: "p2" } });
    putKey(keys, device, 0, 1, { type: "hidePlayer", label: "Hide P1", icon: "hide", settings: { player: "p1" } });
    putKey(keys, device, 1, 1, { type: "hidePlayer", label: "Hide P2", icon: "hide", settings: { player: "p2" } });
    putKey(keys, device, 2, 1, {
      type: "gamePoint",
      label: enrichGamePointLabel({ settings: { player: "p1", delta: 1 } }, data),
      icon: "win",
      settings: { player: "p1", delta: 1 },
    });
    putKey(keys, device, 3, 1, {
      type: "gamePoint",
      label: enrichGamePointLabel({ settings: { player: "p1", delta: -1 } }, data),
      icon: "win",
      settings: { player: "p1", delta: -1 },
    });
    putKey(keys, device, 4, 1, {
      type: "gamePoint",
      label: enrichGamePointLabel({ settings: { player: "p2", delta: 1 } }, data),
      icon: "win",
      settings: { player: "p2", delta: 1 },
    });
    putKey(keys, device, 5, 1, {
      type: "gamePoint",
      label: enrichGamePointLabel({ settings: { player: "p2", delta: -1 } }, data),
      icon: "win",
      settings: { player: "p2", delta: -1 },
    });

    p1Bfs.forEach((bf, i) => {
      if (i >= 6) return;
      const def = {
        type: "battlefield",
        label: `P1 · ${shortName(bf.name)}`,
        icon: "game",
        settings: { player: "p1", cardId: bf.id },
        cardId: bf.id,
      };
      enrichBattlefieldDef(def, data);
      putKey(keys, device, i, 2, def);
    });

    p2Bfs.forEach((bf, i) => {
      if (i >= 5) return;
      const def = {
        type: "battlefield",
        label: `P2 · ${shortName(bf.name)}`,
        icon: "game",
        settings: { player: "p2", cardId: bf.id },
        cardId: bf.id,
      };
      enrichBattlefieldDef(def, data);
      putKey(keys, device, 1 + i, 3, def);
    });
  } else if (device.cols >= 5 && device.rows >= 3) {
    putKey(keys, device, 0, 0, { type: "hideAll", label: "Hide", icon: "hide" });
    putKey(keys, device, 1, 0, { type: "matchup", label: "Matchup", icon: "matchup" });
    putKey(keys, device, 2, 0, enrichSelectGameDef({ type: "selectGame", label: "G1", icon: "game", settings: { index: 0 } }, data));
    putKey(keys, device, 3, 0, enrichSelectGameDef({ type: "selectGame", label: "G2", icon: "game", settings: { index: 1 } }, data));
    putKey(keys, device, 4, 0, enrichSelectGameDef({ type: "selectGame", label: "G3", icon: "game", settings: { index: 2 } }, data));
    putKey(keys, device, 0, 1, { type: "resetMatch", label: "Reset", icon: "reset" });
    putKey(keys, device, 1, 1, { type: "winGame", label: "P1 Win", icon: "win", settings: { player: "p1" } });
    putKey(keys, device, 2, 1, {
      type: "gamePoint",
      label: enrichGamePointLabel({ settings: { player: "p1", delta: 1 } }, data),
      icon: "win",
      settings: { player: "p1", delta: 1 },
    });
    putKey(keys, device, 3, 1, {
      type: "gamePoint",
      label: enrichGamePointLabel({ settings: { player: "p2", delta: 1 } }, data),
      icon: "win",
      settings: { player: "p2", delta: 1 },
    });
    putKey(keys, device, 4, 1, {
      type: "gamePoint",
      label: enrichGamePointLabel({ settings: { player: "p2", delta: -1 } }, data),
      icon: "win",
      settings: { player: "p2", delta: -1 },
    });
    p1Bfs.slice(0, 2).forEach((bf, i) => {
      const def = {
        type: "battlefield",
        label: shortName(bf.name),
        icon: "game",
        settings: { player: "p1", cardId: bf.id },
        cardId: bf.id,
      };
      enrichBattlefieldDef(def, data);
      putKey(keys, device, 1 + i, 2, def);
    });
    p2Bfs.slice(0, 2).forEach((bf, i) => {
      const def = {
        type: "battlefield",
        label: shortName(bf.name),
        icon: "game",
        settings: { player: "p2", cardId: bf.id },
        cardId: bf.id,
      };
      enrichBattlefieldDef(def, data);
      putKey(keys, device, 3 + i, 2, def);
    });
  } else {
    putKey(keys, device, 0, 0, { type: "hideAll", label: "Hide", icon: "hide" });
    putKey(keys, device, 1, 0, { type: "resetMatch", label: "Reset", icon: "reset" });
    putKey(keys, device, 2, 0, { type: "matchup", label: "Matchup", icon: "matchup" });
    putKey(keys, device, 1, 1, { type: "winGame", label: "P1", icon: "win", settings: { player: "p1" } });
  }

  addNavigation(keys, device);
  return keys;
}

/**
 * Build all Stream Deck pages from current app data.
 * @returns {{ name: string, keys: Map<number, object> }[]}
 */
export function buildPages(data, deviceKey = "xl") {
  const device = DEVICES[deviceKey] || DEVICES.xl;
  const pages = [{ name: "Controls", keys: buildControlKeys(device, data) }];

  const slots = cardSlotIndices(device);
  for (const player of data.players || []) {
    const info = playerDisplayCards(player, data.cardsCache);
    if (!info.cards.length) continue;

    for (let offset = 0; offset < info.cards.length; offset += slots.length) {
      const chunk = info.cards.slice(offset, offset + slots.length);
      const keys = new Map();
      chunk.forEach((card, i) => {
        keys.set(slots[i], {
          type: "showCard",
          label: shortName(card.label || card.name, 22),
          cardId: card.id,
          settings: { player: player.id, cardId: card.id, index: card.index },
        });
      });
      addNavigation(keys, device);
      const pageNum = Math.floor(offset / slots.length) + 1;
      const suffix = chunk.length < info.cards.length ? ` (${pageNum})` : "";
      pages.push({
        name: `${info.pseudo || player.id} cards${suffix}`,
        keys,
      });
    }
  }

  return pages;
}

export function detectDeviceKey(deck) {
  const count = deck?.CONTROLS?.filter((c) => c.type === "button")?.length ?? 0;
  if (count >= 32) return "xl";
  if (count >= 15) return "standard";
  return "mini";
}
