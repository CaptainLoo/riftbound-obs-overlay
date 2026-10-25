import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

process.env.RIFTBOUND_DATA_DIR = mkdtempSync(join(tmpdir(), "riftbound-test-"));

const { buildStreamDeckModel } = await import("../server/streamdeck/model.js");
const { buildPages, DEVICES, cardSlotIndices } = await import("../server/streamdeckLayout.js");
const { classifyStreamDeckRefresh, snapshotRevision, findChangedControlKeyIndices } = await import(
  "../server/streamdeckRevision.js"
);
const { createTransport } = await import("../server/streamdeck/transport.js");

function fixtureData({ score = { p1: 0, p2: 0 }, bf = null, anim = "pop", mainCount = 40 } = {}) {
  const cardsCache = { legend: { name: "Legend", thumbLocal: "/cards/legend-thumb.png", imageLocal: "/cards/legend.png" } };
  const maindeck = [];
  for (let i = 0; i < mainCount; i++) {
    cardsCache[`m${i}`] = { name: `Main ${i}`, thumbLocal: `/cards/m${i}-thumb.png`, imageLocal: `/cards/m${i}.png` };
    maindeck.push({ id: `m${i}`, quantity: 1 });
  }
  cardsCache.bf1 = { name: "Void Gate", thumbLocal: "/cards/bf1-thumb.png", imageLocal: "/cards/bf1.png" };
  cardsCache.unused = { name: "Not in any deck" };
  return {
    cardsCache,
    players: [
      { id: "p1", pseudo: "Alice", deck: { legend: "legend", champions: [], battlefields: [{ id: "bf1", quantity: 1 }], maindeck, runes: [], sideboard: [] } },
      { id: "p2", pseudo: "Bob", deck: { legend: null, champions: [], battlefields: [], maindeck: [], runes: [], sideboard: [] } },
    ],
    match: {
      format: "bo3",
      score: { p1: 0, p2: 0 },
      currentGame: 0,
      games: [
        { battlefield: { p1: bf, p2: null }, champion: { p1: null, p2: null }, score },
        { battlefield: { p1: null, p2: null }, champion: { p1: null, p2: null }, score: { p1: 0, p2: 0 } },
        { battlefield: { p1: null, p2: null }, champion: { p1: null, p2: null }, score: { p1: 0, p2: 0 } },
      ],
    },
    display: { mode: "persistent", cards: { p1: null, p2: null }, cardAnimation: anim, cardReveal: { p1: 0, p2: 0 } },
    layout: {},
  };
}

test("buildStreamDeckModel keeps only referenced cards and a stable rev", () => {
  const m = buildStreamDeckModel(fixtureData());
  assert.deepEqual(Object.keys(m).sort(), ["cards", "display", "match", "players", "rev"]);
  assert.equal(m.players[0].cards.length, 41);
  assert.deepEqual(m.players[0].battlefields, [{ id: "bf1", name: "Void Gate", label: "Void Gate" }]);
  assert.equal("unused" in m.cards, false);
  assert.ok(m.cards.bf1.thumbLocal);
  assert.equal(m.rev, buildStreamDeckModel(fixtureData()).rev);
});

test("model rev changes on score but not on card animation", () => {
  const base = buildStreamDeckModel(fixtureData()).rev;
  assert.notEqual(buildStreamDeckModel(fixtureData({ score: { p1: 1, p2: 0 } })).rev, base);
  assert.equal(buildStreamDeckModel(fixtureData({ anim: "flip" })).rev, base);
});

test("buildPages yields Controls plus paginated card pages and marks the active battlefield", () => {
  const model = buildStreamDeckModel(fixtureData({ bf: "bf1" }));
  const pages = buildPages(model, "xl");
  const perPage = cardSlotIndices(DEVICES.xl).length;
  assert.equal(pages[0].name, "Controls");
  assert.equal(pages.length, 1 + Math.ceil(41 / perPage));
  assert.equal(pages[1].name, "Alice cards (1)");
  const bfKey = [...pages[0].keys.values()].find((k) => k.type === "battlefield");
  assert.equal(bfKey.active, true);
  assert.match(bfKey.label, /^✓ /);
  const showCard = [...pages[1].keys.values()].find((k) => k.type === "showCard");
  assert.equal(showCard.settings.player, "p1");
  // 15-key layout stays within the grid
  for (const page of buildPages(model, "standard")) {
    for (const idx of page.keys.keys()) assert.ok(idx < 15, `key ${idx} outside 15-key grid`);
  }
});

test("refresh classification: skip / partial / full", () => {
  const m0 = buildStreamDeckModel(fixtureData());
  const prev = snapshotRevision(m0);
  assert.equal(classifyStreamDeckRefresh(null, m0), "full");
  assert.equal(classifyStreamDeckRefresh(prev, m0), "skip");
  assert.equal(classifyStreamDeckRefresh(prev, buildStreamDeckModel(fixtureData({ anim: "flip" }))), "skip");
  const scored = buildStreamDeckModel(fixtureData({ score: { p1: 2, p2: 0 } }));
  assert.equal(classifyStreamDeckRefresh(prev, scored), "partial");
  const changed = findChangedControlKeyIndices(buildPages(m0, "xl")[0], buildPages(scored, "xl")[0]);
  assert.deepEqual(changed, [10, 11]); // P1 +/− keys on row 1
  const newDeck = buildStreamDeckModel(fixtureData({ mainCount: 10 }));
  assert.equal(classifyStreamDeckRefresh(prev, newDeck), "full");
});

function pair() {
  const a = new EventEmitter();
  const b = new EventEmitter();
  a.send = (msg) => setImmediate(() => b.emit("message", msg));
  b.send = (msg) => setImmediate(() => a.emit("message", msg));
  return [a, b];
}

test("transport: model and commands flow one way, throttled status flows back", async () => {
  const [serverEnd, workerEnd] = pair();
  const server = createTransport(serverEnd, { statusThrottleMs: 10 });
  const worker = createTransport(workerEnd, { statusThrottleMs: 10 });

  const models = [];
  const commands = [];
  const statuses = [];
  worker.onModel(({ model }) => models.push(model.rev));
  worker.onCommand((msg) => commands.push(msg));
  server.onStatus(({ status }) => statuses.push(status.phase));

  const ready = new Promise((resolve) => server.onReady(resolve));
  worker.sendReady();
  await ready;

  server.sendModel({ rev: "a" });
  server.sendCommand("refresh-images", { force: true });
  server.sendCommand("shutdown", { quick: true });
  for (const phase of ["loading", "scanning", "opening", "connected"]) worker.sendStatus({ phase });
  await new Promise((r) => setTimeout(r, 40));

  assert.deepEqual(models, ["a"]);
  assert.deepEqual(commands.map((c) => c.cmd), ["refresh-images", "shutdown"]);
  assert.equal(commands[0].force, true);
  assert.deepEqual(statuses, ["connected"], "intermediate statuses are coalesced");
});
