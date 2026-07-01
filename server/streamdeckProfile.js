import { createRequire } from "node:module";
import { mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { playerBattlefields, playerDisplayCards } from "./deckCards.js";

const require = createRequire(import.meta.url);
const archiver = require("archiver");

const PLUGIN_ROOT = "com.riftbound.obs";
const PLUGIN_VERSION = "1.0.0.0";
const PLUGIN_META = { Name: "Riftbound OBS", UUID: PLUGIN_ROOT, Version: PLUGIN_VERSION };
const NAV_PLUGIN = { Name: "Pages", UUID: "com.elgato.streamdeck.page", Version: "1.0" };

const PLUGIN = {
  showcard: "com.riftbound.obs.showcard",
  hideall: "com.riftbound.obs.hideall",
  hideplayer: "com.riftbound.obs.hideplayer",
  matchup: "com.riftbound.obs.matchup",
  wingame: "com.riftbound.obs.wingame",
  game: "com.riftbound.obs.game",
  battlefield: "com.riftbound.obs.battlefield",
};

export const DEVICES = {
  standard: { model: "20GBD9901", cols: 5, rows: 3, label: "Stream Deck (15 keys)" },
  xl: { model: "20GAV9901", cols: 8, rows: 4, label: "Stream Deck XL (32 keys)" },
  mini: { model: "20GAT9901", cols: 3, rows: 2, label: "Stream Deck Mini (6 keys)" },
};

/** Stream Deck uses "column,row" (not row,col). */
function pos(col, row) {
  return `${col},${row}`;
}

function makeAction(uuid, name, settings, title) {
  return {
    ActionID: randomUUID().toUpperCase(),
    LinkedTitle: true,
    Name: name,
    Plugin: PLUGIN_META,
    Settings: settings,
    State: 0,
    States: [
      {
        Title: title,
        ShowTitle: true,
        TitleAlignment: "bottom",
        TitleColor: "#ffffff",
        FontSize: 9,
        FontFamily: "",
        FontStyle: "",
        FontUnderline: false,
        OutlineThickness: 2,
      },
    ],
    UUID: uuid,
  };
}

function makeNavAction(direction) {
  const isNext = direction === "next";
  return {
    ActionID: randomUUID().toUpperCase(),
    LinkedTitle: true,
    Name: isNext ? "Next Page" : "Previous Page",
    Plugin: NAV_PLUGIN,
    Settings: {},
    State: 0,
    States: [
      {
        Title: isNext ? "Next ▶" : "◀ Prev",
        ShowTitle: true,
        TitleAlignment: "middle",
        TitleColor: "#ffffff",
        FontSize: 10,
        FontFamily: "",
        FontStyle: "",
        FontUnderline: false,
        OutlineThickness: 2,
      },
    ],
    UUID: `com.elgato.streamdeck.page.${direction}`,
  };
}

function navCorners(device) {
  const lastRow = device.rows - 1;
  const lastCol = device.cols - 1;
  return { prev: pos(0, lastRow), next: pos(lastCol, lastRow) };
}

function addNavigation(actions, device) {
  const { prev, next } = navCorners(device);
  actions[prev] = makeNavAction("previous");
  actions[next] = makeNavAction("next");
}

/** Grid slots excluding bottom-left and bottom-right navigation keys. */
function cardSlots(device) {
  const { prev, next } = navCorners(device);
  const slots = [];
  for (let row = 0; row < device.rows; row++) {
    for (let col = 0; col < device.cols; col++) {
      const key = pos(col, row);
      if (key === prev || key === next) continue;
      slots.push(key);
    }
  }
  return slots;
}

function shortName(name, max = 18) {
  return String(name || "").slice(0, max);
}

function buildControlPage(device, data, baseSettings) {
  const actions = {};
  const put = (col, row, uuid, name, settings, title) => {
    actions[pos(col, row)] = makeAction(uuid, name, settings, title);
  };

  const p1 = data.players[0];
  const p2 = data.players[1];
  const p1Bfs = p1 ? playerBattlefields(p1, data.cardsCache) : [];
  const p2Bfs = p2 ? playerBattlefields(p2, data.cardsCache) : [];

  if (device.cols >= 8 && device.rows >= 4) {
    // XL layout — full controls + all battlefields + navigation
    put(0, 0, PLUGIN.hideall, "Hide all", { ...baseSettings }, "Hide all");
    put(1, 0, PLUGIN.matchup, "Matchup", { ...baseSettings }, "Matchup");
    put(2, 0, PLUGIN.game, "Game 1", { ...baseSettings, index: 0 }, "Game 1");
    put(3, 0, PLUGIN.game, "Game 2", { ...baseSettings, index: 1 }, "Game 2");
    put(4, 0, PLUGIN.game, "Game 3", { ...baseSettings, index: 2 }, "Game 3");
    put(5, 0, PLUGIN.wingame, "P1 win", { ...baseSettings, player: "p1" }, "P1 Win");
    put(6, 0, PLUGIN.wingame, "P2 win", { ...baseSettings, player: "p2" }, "P2 Win");
    put(0, 1, PLUGIN.hideplayer, "Hide P1", { ...baseSettings, player: "p1" }, "Hide P1");
    put(1, 1, PLUGIN.hideplayer, "Hide P2", { ...baseSettings, player: "p2" }, "Hide P2");

    p1Bfs.forEach((bf, i) => {
      if (i >= 6) return;
      put(i, 2, PLUGIN.battlefield, "Battlefield", {
        ...baseSettings,
        player: "p1",
        cardId: bf.id,
        label: bf.label,
      }, `P1 · ${shortName(bf.name)}`);
    });

    p2Bfs.forEach((bf, i) => {
      if (i >= 5) return;
      put(1 + i, 3, PLUGIN.battlefield, "Battlefield", {
        ...baseSettings,
        player: "p2",
        cardId: bf.id,
        label: bf.label,
      }, `P2 · ${shortName(bf.name)}`);
    });
  } else if (device.cols >= 5 && device.rows >= 3) {
    // Standard 5×3
    put(0, 0, PLUGIN.hideall, "Hide all", { ...baseSettings }, "Hide");
    put(1, 0, PLUGIN.matchup, "Matchup", { ...baseSettings }, "Matchup");
    put(2, 0, PLUGIN.game, "Game 1", { ...baseSettings, index: 0 }, "G1");
    put(3, 0, PLUGIN.game, "Game 2", { ...baseSettings, index: 1 }, "G2");
    put(4, 0, PLUGIN.game, "Game 3", { ...baseSettings, index: 2 }, "G3");
    put(0, 1, PLUGIN.wingame, "P1 win", { ...baseSettings, player: "p1" }, "P1 Win");
    put(1, 1, PLUGIN.wingame, "P2 win", { ...baseSettings, player: "p2" }, "P2 Win");
    put(2, 1, PLUGIN.hideplayer, "Hide P1", { ...baseSettings, player: "p1" }, "Hide P1");
    put(3, 1, PLUGIN.hideplayer, "Hide P2", { ...baseSettings, player: "p2" }, "Hide P2");

    p1Bfs.slice(0, 2).forEach((bf, i) => {
      put(1 + i, 2, PLUGIN.battlefield, "Battlefield", {
        ...baseSettings,
        player: "p1",
        cardId: bf.id,
        label: bf.label,
      }, shortName(bf.name));
    });
    p2Bfs.slice(0, 2).forEach((bf, i) => {
      put(3 + i, 2, PLUGIN.battlefield, "Battlefield", {
        ...baseSettings,
        player: "p2",
        cardId: bf.id,
        label: bf.label,
      }, shortName(bf.name));
    });
  } else {
    // Mini 3×2 — essentials only
    put(0, 0, PLUGIN.hideall, "Hide all", { ...baseSettings }, "Hide");
    put(1, 0, PLUGIN.matchup, "Matchup", { ...baseSettings }, "Matchup");
    put(2, 0, PLUGIN.game, "Game 1", { ...baseSettings, index: 0 }, "G1");
    put(1, 1, PLUGIN.wingame, "P1 win", { ...baseSettings, player: "p1" }, "P1");
  }

  addNavigation(actions, device);
  return actions;
}

function addDirToArchive(archive, dir, zipPath) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const abs = join(dir, entry.name);
    const rel = zipPath ? `${zipPath}/${entry.name}` : entry.name;
    if (entry.isDirectory()) addDirToArchive(archive, abs, rel);
    else archive.file(abs, { name: rel });
  }
}

/**
 * Stream a ready-to-import .streamDeckProfile zip (Stream Deck 6.4+ / 7.x).
 * Page 1: controls + battlefields. Card pages include Prev/Next navigation.
 */
export async function streamStreamDeckProfile(data, deviceKey, outStream) {
  const device = DEVICES[deviceKey] || DEVICES.xl;
  const slots = cardSlots(device);
  const profileUuid = randomUUID().toUpperCase();
  const pageIds = [];
  const baseSettings = { host: "127.0.0.1", port: 7474 };

  const tmpRoot = join(tmpdir(), `riftbound-sd-${randomUUID()}`);
  const sdRoot = join(tmpRoot, `${profileUuid}.sdProfile`);
  mkdirSync(sdRoot, { recursive: true });

  function writePage(actions) {
    const pageUuid = randomUUID().toUpperCase();
    pageIds.push(pageUuid);
    const pageDir = join(sdRoot, "Profiles", pageUuid);
    mkdirSync(join(pageDir, "Images"), { recursive: true });
    writeFileSync(
      join(pageDir, "manifest.json"),
      JSON.stringify({ Controllers: [{ Type: "Keypad", Actions: actions }] })
    );
  }

  writePage(buildControlPage(device, data, baseSettings));

  for (const player of data.players) {
    const info = playerDisplayCards(player, data.cardsCache);
    if (!info.cards.length) continue;

    for (let offset = 0; offset < info.cards.length; offset += slots.length) {
      const chunk = info.cards.slice(offset, offset + slots.length);
      const actions = {};

      chunk.forEach((card, i) => {
        actions[slots[i]] = makeAction(
          PLUGIN.showcard,
          "Show Card",
          { ...baseSettings, player: player.id, cardId: card.id, index: card.index },
          shortName(card.label || card.name, 22)
        );
      });

      addNavigation(actions, device);
      writePage(actions);
    }
  }

  writeFileSync(
    join(sdRoot, "manifest.json"),
    JSON.stringify({
      Device: { Model: device.model, UUID: "" },
      Name: "Riftbound OBS",
      Pages: { Current: pageIds[0], Pages: pageIds },
      Version: "3.0",
    })
  );

  const archive = archiver("zip", { zlib: { level: 9 } });
  const done = new Promise((resolve, reject) => {
    outStream.on("finish", resolve);
    outStream.on("error", reject);
    archive.on("error", reject);
    archive.on("end", () => {
      try {
        rmSync(tmpRoot, { recursive: true, force: true });
      } catch {
        /* ignore */
      }
    });
  });

  archive.pipe(outStream);
  addDirToArchive(archive, sdRoot, `${profileUuid}.sdProfile`);
  await archive.finalize();
  await done;
}
