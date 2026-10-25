import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

process.env.RIFTBOUND_DATA_DIR = mkdtempSync(join(tmpdir(), "riftbound-test-"));
const { parseDecklist, resolveDecklist, resolveTTS } = await import("../server/decklist.js");
const { memoAsync } = await import("../server/util/memo.js");

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

test("parseDecklist understands EN/FR headers, quantities and comments", () => {
  const parsed = parseDecklist(`Légende:
1 Pyke, Bloodharbor Ripper
Champion
1 Pyke, Dockside Butcher
// comment
MainDeck:
3x Falling Star
Gust
Champ de bataille
1 Void Gate
Runes
6 Fury Rune
Réserve:
2 Acceptable Losses`);
  assert.deepEqual(parsed.legend, [{ quantity: 1, name: "Pyke, Bloodharbor Ripper" }]);
  assert.deepEqual(parsed.champions, [{ quantity: 1, name: "Pyke, Dockside Butcher" }]);
  assert.deepEqual(parsed.maindeck, [
    { quantity: 3, name: "Falling Star" },
    { quantity: 1, name: "Gust" },
  ]);
  assert.deepEqual(parsed.battlefields, [{ quantity: 1, name: "Void Gate" }]);
  assert.deepEqual(parsed.runes, [{ quantity: 6, name: "Fury Rune" }]);
  assert.deepEqual(parsed.sideboard, [{ quantity: 2, name: "Acceptable Losses" }]);
});

function fakeApi(db, { delay = 5, track } = {}) {
  let inFlight = 0;
  return {
    async searchByName(name) {
      inFlight += 1;
      if (track) track.max = Math.max(track.max, inFlight);
      if (track) track.calls.push(name);
      await sleep(delay);
      inFlight -= 1;
      return db[name.toLowerCase()] || [];
    },
    async fetchCardDetail(id) {
      await sleep(delay);
      if (!db[id]) throw new Error("404");
      return db[id];
    },
  };
}

test("resolveDecklist keeps order, bounds concurrency and resolves legends by title", async () => {
  const db = {
    "falling star": [{ card_id: "ogn-001-298", name: "Falling Star" }],
    gust: [{ card_id: "ogn-002a-298", name: "Gust" }, { card_id: "ogn-002-298", name: "Gust" }],
    "bloodharbor ripper": [{ card_id: "ogn-050-298", name: "Bloodharbor Ripper" }],
    "pyke, bloodharbor ripper": [{ card_id: "ogn-051-298", name: "Pyke" }],
  };
  const track = { max: 0, calls: [] };
  const names = Array.from({ length: 12 }, (_, i) => (i % 2 ? "Gust" : "Falling Star"));
  const parsed = {
    legend: [{ quantity: 1, name: "Pyke, Bloodharbor Ripper" }],
    champions: [],
    maindeck: names.map((name, i) => ({ quantity: i + 1, name })),
    battlefields: [],
    runes: [],
    sideboard: [{ quantity: 1, name: "Unknown Card" }],
  };
  const out = await resolveDecklist(parsed, fakeApi(db, { track }));

  assert.equal(out.legend[0].chosen, "ogn-050-298", "legend resolved by the part after the comma");
  assert.equal(out.legend[0].ambiguous, false);
  assert.deepEqual(out.maindeck.map((e) => e.name), names);
  assert.deepEqual(out.maindeck.map((e) => e.quantity), names.map((_, i) => i + 1));
  assert.equal(out.maindeck[1].chosen, "ogn-002-298", "base printing preferred over variant");
  assert.equal(out.sideboard[0].chosen, null);
  assert.equal(out.sideboard[0].ambiguous, true);
  assert.ok(track.max <= 4, `max in flight was ${track.max}`);
  assert.ok(track.max >= 2, "work actually ran concurrently");
});

test("resolveTTS counts copies and classifies by API type", async () => {
  const db = {
    "ogn-245": { id: "ogn-245-1", name: "Legend A", type: "Legend" },
    "ogn-010": { id: "ogn-010-1", name: "Gate", type: "Battlefield" },
    "ogn-300": { id: "ogn-300-1", name: "Fury Rune", type: "Rune" },
    "ogn-020": { id: "ogn-020-1", name: "Unit", type: "Unit" },
  };
  const out = await resolveTTS("OGN-245-1 OGN-020-1 OGN-020-1 OGN-020-1 OGN-010-1 OGN-300-1 XXX-999-1", fakeApi(db));
  assert.equal(out.legend[0].chosen, "ogn-245-1");
  assert.equal(out.maindeck.find((e) => e.name === "Unit").quantity, 3);
  assert.equal(out.battlefields.length, 1);
  assert.equal(out.runes.length, 1);
  assert.equal(out.maindeck.find((e) => e.name === "xxx-999").ambiguous, true);
});

test("memoAsync caches within the TTL and de-duplicates in-flight calls", async () => {
  let calls = 0;
  let t = 1000;
  const fn = memoAsync(
    async (q) => {
      calls += 1;
      await sleep(5);
      return q.toUpperCase();
    },
    { ttlMs: 100, max: 2, now: () => t }
  );
  const [a, b] = await Promise.all([fn("x"), fn("x")]);
  assert.equal(a, "X");
  assert.equal(b, "X");
  assert.equal(calls, 1, "concurrent calls share one request");
  await fn("x");
  assert.equal(calls, 1, "served from cache");
  t += 200;
  await fn("x");
  assert.equal(calls, 2, "expired after the TTL");
  await fn("y");
  await fn("z");
  assert.equal(fn.size(), 2, "oldest entry evicted at the size cap");
});
