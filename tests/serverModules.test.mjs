import test from "node:test";
import assert from "node:assert/strict";

test("server route aggregator imports", async () => {
  const mod = await import("../server/routes.js");
  assert.ok(mod.router);
});

test("streamdeck status helpers expose defaults", async () => {
  const mod = await import("../server/streamdeck/status.js");
  const status = mod.defaultStreamDeckStatus();
  assert.equal(status.phase, "idle");
  assert.equal(status.connected, false);
});

