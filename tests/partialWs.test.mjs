import test from "node:test";
import assert from "node:assert/strict";
import { buildPatch } from "../server/hub.js";
import { mergeStatePatch } from "../public/shared/ws.js";

test("mergeStatePatch replaces only patched top-level sections", () => {
  const state = {
    meta: { gameId: "riftbound" },
    match: { currentGame: 0 },
    layout: { playArea: { x: 1 } },
  };
  const next = mergeStatePatch(state, {
    layout: { playArea: { x: 2 } },
  });

  assert.equal(next.meta, state.meta);
  assert.equal(next.match, state.match);
  assert.deepEqual(next.layout, { playArea: { x: 2 } });
});

test("buildPatch includes requested state sections", () => {
  const patch = buildPatch("layout", "display");
  assert.ok(patch.layout);
  assert.ok(patch.display);
  assert.equal(patch.match, undefined);
});

