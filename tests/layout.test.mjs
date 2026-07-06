import test from "node:test";
import assert from "node:assert/strict";
import { normalizeLayout } from "../public/shared/layout.js";
import { defaultLayoutForGame } from "../server/db.js";

test("pokemon default layout hides riftbound-only slots", () => {
  const layout = defaultLayoutForGame("pokemon");
  assert.equal(layout["p1.legend"].visible, false);
  assert.equal(layout["p1.battlefield"].visible, false);
  assert.equal(layout["p1.champion"].visible, false);
  assert.equal(layout["p1.card"].visible, true);
  assert.equal(layout.playArea.visible, true);
});

test("normalizeLayout preserves portrait slot aspect ratio", () => {
  const normalized = normalizeLayout({
    "p1.card": { x: 0, y: 0, width: 10, height: 1, visible: true },
  });
  assert.equal(normalized["p1.card"].height, 24.8);
});

