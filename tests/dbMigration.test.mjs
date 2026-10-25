import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dataDir = mkdtempSync(join(tmpdir(), "riftbound-migrate-"));
process.env.RIFTBOUND_DATA_DIR = dataDir;

// Seed a v2.2 multi-game database with the Pokémon game active, plus per-game image folders.
const multiGame = {
  session: { activeGame: "pokemon" },
  games: {
    riftbound: {
      cardsCache: {
        "ogn-007-298": { id: "ogn-007-298", name: "Alpha", imageLocal: "/cards/riftbound/ogn-007-298.png", thumbLocal: "/cards/riftbound/ogn-007-298-thumb.webp" },
      },
      players: [
        { id: "p1", pseudo: "Jeremy", deck: { legend: "ogn-007-298", champions: [], battlefields: [], maindeck: [], runes: [], sideboard: [] } },
        { id: "p2", pseudo: "Kelvin", deck: { legend: null, champions: [], battlefields: [], maindeck: [], runes: [], sideboard: [] } },
      ],
      match: {
        format: "bo3",
        score: { p1: 1, p2: 0 },
        currentGame: 1,
        games: [
          { battlefield: { p1: null, p2: null }, champion: { p1: null, p2: null }, score: { p1: 3, p2: 1 }, pokemon: { p1: { active: null, bench: [] }, p2: { active: null, bench: [] } } },
          { battlefield: { p1: null, p2: null }, champion: { p1: null, p2: null }, score: { p1: 0, p2: 0 }, pokemon: {} },
          { battlefield: { p1: null, p2: null }, champion: { p1: null, p2: null }, score: { p1: 0, p2: 0 } },
        ],
      },
      display: { mode: "persistent", cards: { p1: "ogn-007-298", p2: null }, cardAnimation: "flip", cardReveal: { p1: 3, p2: 0 } },
      layout: { "p1.card": { x: 2, y: 63.1, width: 11, height: 1, visible: true } },
    },
    pokemon: { cardsCache: { x: {} }, players: [], match: {}, display: {}, layout: {}, layoutVersion: 2 },
  },
};
writeFileSync(join(dataDir, "db.json"), JSON.stringify(multiGame));
mkdirSync(join(dataDir, "cards", "riftbound"), { recursive: true });
mkdirSync(join(dataDir, "cards", "pokemon"), { recursive: true });
writeFileSync(join(dataDir, "cards", "riftbound", "ogn-007-298.png"), "img");
writeFileSync(join(dataDir, "cards", "pokemon", "sv06-128.webp"), "img");
writeFileSync(join(dataDir, "pokemon-set-index.json"), "{}");

const { db, initDb, migrateData, defaultData } = await import("../server/db.js");

test("migrateData flattens the multi-game shape and keeps the Riftbound slice", () => {
  const { data, changed } = migrateData(structuredClone(multiGame));
  assert.equal(changed, true);
  assert.deepEqual(Object.keys(data).sort(), ["cardsCache", "display", "layout", "match", "players"]);
  assert.equal(data.players[0].pseudo, "Jeremy");
  assert.deepEqual(data.match.score, { p1: 1, p2: 0 });
  assert.equal(data.match.currentGame, 1);
  assert.equal(data.match.games.length, 3);
  for (const g of data.match.games) assert.equal("pokemon" in g, false);
  assert.equal(data.cardsCache["ogn-007-298"].imageLocal, "/cards/ogn-007-298.png");
  assert.equal(data.cardsCache["ogn-007-298"].thumbLocal, "/cards/ogn-007-298-thumb.webp");
  assert.equal(data.display.cardAnimation, "flip");
  // Portrait slot height recomputed from width, default slots backfilled.
  assert.equal(data.layout["p1.card"].height, 27.3);
  assert.ok(data.layout["p2.legend"]);
});

test("migrateData upgrades the v2.1 flat shape with legendGroup", () => {
  const legacy = {
    cardsCache: {},
    players: [{ id: "p1", pseudo: "", deck: {} }, { id: "p2", pseudo: "", deck: {} }],
    match: { format: "bo5", score: { p1: 0, p2: 0 }, currentGame: 0, games: [] },
    display: { mode: "persistent", currentCardId: "abc" },
    layout: { "p1.legendGroup": { x: 1, y: 2, width: 10, visible: true } },
  };
  const { data } = migrateData(legacy);
  assert.equal(data.match.games.length, 5);
  assert.equal(data.display.cards.p1, "abc");
  assert.equal("currentCardId" in data.display, false);
  assert.ok(data.layout["p1.pseudo"]);
  assert.ok(data.layout["p1.legend"]);
  assert.equal("p1.legendGroup" in data.layout, false);
  assert.deepEqual(Object.keys(data.players[0].deck).sort(), ["battlefields", "champions", "legend", "maindeck", "runes", "sideboard"]);
});

test("migrateData is idempotent on current data", () => {
  const first = migrateData(structuredClone(multiGame)).data;
  const second = migrateData(structuredClone(first));
  assert.equal(second.changed, false);
  assert.deepEqual(second.data, first);
  assert.equal(migrateData(defaultData()).changed, false);
});

test("initDb writes the flat database and moves images out of per-game folders", async () => {
  await initDb();
  assert.equal(db.data.players[0].pseudo, "Jeremy");
  const onDisk = JSON.parse(readFileSync(join(dataDir, "db.json"), "utf8"));
  assert.equal("games" in onDisk, false);
  assert.equal("session" in onDisk, false);
  assert.ok(existsSync(join(dataDir, "cards", "ogn-007-298.png")));
  assert.equal(existsSync(join(dataDir, "cards", "riftbound")), false);
  assert.equal(existsSync(join(dataDir, "cards", "pokemon")), false);
  assert.equal(existsSync(join(dataDir, "pokemon-set-index.json")), false);
});
