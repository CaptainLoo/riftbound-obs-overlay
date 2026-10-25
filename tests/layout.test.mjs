import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { normalizeLayout, layoutToCss } from "../public/shared/layout.js";

process.env.RIFTBOUND_DATA_DIR = mkdtempSync(join(tmpdir(), "riftbound-test-"));
const { defaultLayout } = await import("../server/db.js");

test("default layout exposes every overlay slot", () => {
  const layout = defaultLayout();
  for (const slot of ["p1.pseudo", "p2.pseudo", "score", "playArea", "match.tally", "p1.legend", "p2.legend", "p1.battlefield", "p2.battlefield", "p1.card", "p2.card", "p1.champion", "p2.champion"]) {
    assert.ok(layout[slot], `missing slot ${slot}`);
  }
  assert.equal(layout["p1.legend"].visible, true);
  assert.equal(layout.playArea.visible, true);
});

test("normalizeLayout preserves portrait slot aspect ratio", () => {
  const normalized = normalizeLayout({
    "p1.card": { x: 0, y: 0, width: 10, height: 1, visible: true },
  });
  assert.equal(normalized["p1.card"].height, 24.8);
});

test("layoutToCss emits one rule per slot with aspect ratio on image slots", () => {
  const css = layoutToCss(normalizeLayout(defaultLayout()));
  assert.match(css, /#slot-p1-card \{[^}]*aspect-ratio: 744 \/ 1039/);
  assert.match(css, /#slot-p1-battlefield \{[^}]*aspect-ratio: 1039 \/ 744/);
  assert.match(css, /#slot-match-tally \{[^}]*z-index: 25/);
});
