/**
 * Builds Stream Deck pages from the model pushed by the server
 * (see streamdeck/model.js). Pure: no I/O, no database.
 */

export const DEVICES = {
  standard: { model: "20GBD9901", cols: 5, rows: 3, label: "Stream Deck (15 keys)" },
  xl: { model: "20GAV9901", cols: 8, rows: 4, label: "Stream Deck XL (32 keys)" },
  mini: { model: "20GAT9901", cols: 3, rows: 2, label: "Stream Deck Mini (6 keys)" },
};

/** Linear key index (row-major), matches @elgato-stream-deck/core grid. */
function keyIndex(device, col, row) {
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

function currentGame(model) {
  return model.match?.games?.[model.match?.currentGame ?? 0] || {};
}

function enrichGamePointLabel(def, model) {
  const player = def.settings?.player;
  const delta = def.settings?.delta ?? 1;
  const pts = currentGame(model).score?.[player] ?? 0;
  const prefix = player === "p1" ? "P1" : "P2";
  return `${prefix} ${delta > 0 ? "+" : "−"} (${pts})`;
}

function gamePointKey(player, delta, model) {
  return {
    type: "gamePoint",
    label: enrichGamePointLabel({ settings: { player, delta } }, model),
    icon: "win",
    settings: { player, delta },
  };
}

function enrichBattlefieldDef(def, model) {
  const player = def.settings?.player;
  const cardId = def.settings?.cardId;
  const active = currentGame(model).battlefield?.[player] === cardId;
  def.active = active;
  const base = String(def.label || "").replace(/^✓\s*/, "");
  def.label = active ? `✓ ${base}` : base;
  return def;
}

function battlefieldKey(player, bf, model, labelPrefix = "") {
  return enrichBattlefieldDef(
    {
      type: "battlefield",
      label: `${labelPrefix}${shortName(bf.name)}`,
      icon: "game",
      settings: { player, cardId: bf.id },
      cardId: bf.id,
    },
    model
  );
}

function enrichSelectGameDef(def, model) {
  const idx = Number(def.settings?.index) || 0;
  const active = idx === (model.match?.currentGame ?? 0);
  def.active = active;
  const base = String(def.label || "").replace(/^[▶●]\s*/, "");
  def.label = active ? `▶ ${base}` : base;
  return def;
}

function selectGameKey(index, label, model) {
  return enrichSelectGameDef({ type: "selectGame", label, icon: "game", settings: { index } }, model);
}

function buildControlKeys(device, model) {
  const keys = new Map();
  const [p1, p2] = model.players || [];
  const p1Bfs = p1?.battlefields || [];
  const p2Bfs = p2?.battlefields || [];

  if (device.cols >= 8 && device.rows >= 4) {
    putKey(keys, device, 0, 0, { type: "hideAll", label: "Hide all", icon: "hide" });
    putKey(keys, device, 1, 0, { type: "matchup", label: "Matchup", icon: "matchup" });
    putKey(keys, device, 2, 0, { type: "resetMatch", label: "Reset", icon: "reset" });
    putKey(keys, device, 3, 0, selectGameKey(0, "Game 1", model));
    putKey(keys, device, 4, 0, selectGameKey(1, "Game 2", model));
    putKey(keys, device, 5, 0, selectGameKey(2, "Game 3", model));
    putKey(keys, device, 6, 0, { type: "winGame", label: "P1 Win", icon: "win", settings: { player: "p1" } });
    putKey(keys, device, 7, 0, { type: "winGame", label: "P2 Win", icon: "win", settings: { player: "p2" } });
    putKey(keys, device, 0, 1, { type: "hidePlayer", label: "Hide P1", icon: "hide", settings: { player: "p1" } });
    putKey(keys, device, 1, 1, { type: "hidePlayer", label: "Hide P2", icon: "hide", settings: { player: "p2" } });
    putKey(keys, device, 2, 1, gamePointKey("p1", 1, model));
    putKey(keys, device, 3, 1, gamePointKey("p1", -1, model));
    putKey(keys, device, 4, 1, gamePointKey("p2", 1, model));
    putKey(keys, device, 5, 1, gamePointKey("p2", -1, model));

    p1Bfs.slice(0, 6).forEach((bf, i) => putKey(keys, device, i, 2, battlefieldKey("p1", bf, model, "P1 · ")));
    p2Bfs.slice(0, 5).forEach((bf, i) => putKey(keys, device, 1 + i, 3, battlefieldKey("p2", bf, model, "P2 · ")));
  } else if (device.cols >= 5 && device.rows >= 3) {
    putKey(keys, device, 0, 0, { type: "hideAll", label: "Hide", icon: "hide" });
    putKey(keys, device, 1, 0, { type: "matchup", label: "Matchup", icon: "matchup" });
    putKey(keys, device, 2, 0, selectGameKey(0, "G1", model));
    putKey(keys, device, 3, 0, selectGameKey(1, "G2", model));
    putKey(keys, device, 4, 0, selectGameKey(2, "G3", model));
    putKey(keys, device, 0, 1, { type: "resetMatch", label: "Reset", icon: "reset" });
    putKey(keys, device, 1, 1, { type: "winGame", label: "P1 Win", icon: "win", settings: { player: "p1" } });
    putKey(keys, device, 2, 1, gamePointKey("p1", 1, model));
    putKey(keys, device, 3, 1, gamePointKey("p2", 1, model));
    putKey(keys, device, 4, 1, gamePointKey("p2", -1, model));
    p1Bfs.slice(0, 2).forEach((bf, i) => putKey(keys, device, 1 + i, 2, battlefieldKey("p1", bf, model)));
    p2Bfs.slice(0, 2).forEach((bf, i) => putKey(keys, device, 3 + i, 2, battlefieldKey("p2", bf, model)));
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
 * Build all Stream Deck pages from the current model.
 * @returns {{ name: string, keys: Map<number, object> }[]}
 */
export function buildPages(model, deviceKey = "xl") {
  const device = DEVICES[deviceKey] || DEVICES.xl;
  const pages = [{ name: "Controls", keys: buildControlKeys(device, model || {}) }];

  const slots = cardSlotIndices(device);
  for (const player of model?.players || []) {
    const cardsList = player.cards || [];
    if (!cardsList.length) continue;

    for (let offset = 0; offset < cardsList.length; offset += slots.length) {
      const chunk = cardsList.slice(offset, offset + slots.length);
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
      const suffix = chunk.length < cardsList.length ? ` (${pageNum})` : "";
      pages.push({
        name: `${player.pseudo || player.id} cards${suffix}`,
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
