import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

process.env.RIFTBOUND_DATA_DIR = mkdtempSync(join(tmpdir(), "riftbound-test-"));

const { normalizeDeck, deckCardIds } = await import("../server/db.js");
const { displayCardEntries, resolveDisplayCard, buildOverlayPlayers } = await import("../server/deckCards.js");

const cache = {
  "sfd-197-221": { name: "Emperor", imageLocal: "/cards/sfd-197-221.png" },
  "champion-1": { name: "Champion" },
  "card-1": { name: "Main Card" },
  "side-1": { name: "Side Card" },
  "bf-1": { name: "Void Gate", thumbLocal: "/cards/bf-1-thumb.png" },
};

test("normalizeDeck accepts ids or entries and keeps quantities", () => {
  const deck = normalizeDeck({
    legend: "sfd-197-221",
    champions: [{ id: "champion-1" }],
    battlefields: ["bf-1"],
    maindeck: [{ id: "card-1", quantity: 2 }],
    sideboard: ["side-1"],
  });
  assert.deepEqual(deckCardIds(deck), ["sfd-197-221", "champion-1", "bf-1", "card-1", "side-1"]);
  assert.deepEqual(deck.maindeck, [{ id: "card-1", quantity: 2 }]);
  assert.deepEqual(deck.runes, []);
});

test("displayCardEntries groups and labels cards in display order", () => {
  const deck = normalizeDeck({
    legend: "sfd-197-221",
    champions: ["champion-1"],
    maindeck: [{ id: "card-1", quantity: 2 }],
    sideboard: ["side-1"],
  });
  assert.deepEqual(
    displayCardEntries(deck, cache).map((e) => [e.group, e.label]),
    [
      ["Legend", "Emperor"],
      ["Champion", "Champion"],
      ["Main deck", "Main Card ×2"],
      ["Side deck", "Side Card"],
    ]
  );
});

test("resolveDisplayCard resolves by id, index and name", () => {
  const deck = normalizeDeck({ legend: "sfd-197-221", maindeck: ["card-1"] });
  assert.equal(resolveDisplayCard(deck, cache, { cardId: "x" }), "x");
  assert.equal(resolveDisplayCard(deck, cache, { index: 1 }), "card-1");
  assert.equal(resolveDisplayCard(deck, cache, { name: "main" }), "card-1");
  assert.equal(resolveDisplayCard(deck, cache, { name: "nope" }), null);
});

test("buildOverlayPlayers resolves legend, first champion and battlefields", () => {
  const players = [
    { id: "p1", pseudo: "A", deck: normalizeDeck({ legend: "sfd-197-221", champions: ["champion-1"], battlefields: ["bf-1", "missing"] }) },
    { id: "p2", pseudo: "B", deck: normalizeDeck({}) },
  ];
  const out = buildOverlayPlayers(players, cache);
  assert.equal(out[0].legend.name, "Emperor");
  assert.equal(out[0].champion.name, "Champion");
  assert.deepEqual(out[0].battlefields.map((b) => b.name), ["Void Gate"]);
  assert.equal(out[1].legend, null);
});
