import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

process.env.RIFTBOUND_DATA_DIR = mkdtempSync(join(tmpdir(), "riftbound-test-"));
const { createPersister } = await import("../server/persist.js");

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

test("a burst of markDirty calls produces a single write", async () => {
  let writes = 0;
  const p = createPersister({ write: async () => { writes += 1; }, debounceMs: 20, maxLatencyMs: 500 });
  for (let i = 0; i < 50; i++) {
    p.markDirty();
    await sleep(1);
  }
  await sleep(60);
  assert.equal(writes, 1);
  assert.equal(p.isDirty(), false);
});

test("continuous dirtying still writes within the max latency", async () => {
  let writes = 0;
  const p = createPersister({ write: async () => { writes += 1; }, debounceMs: 20, maxLatencyMs: 80 });
  const start = Date.now();
  while (Date.now() - start < 150) {
    p.markDirty();
    await sleep(5);
  }
  await sleep(40);
  assert.ok(writes >= 1, "expected at least one write during a continuous burst");
});

test("flush writes immediately and resolves once the file is written", async () => {
  let writes = 0;
  const p = createPersister({ write: async () => { await sleep(5); writes += 1; }, debounceMs: 1000 });
  p.markDirty();
  assert.equal(writes, 0);
  await p.flush();
  assert.equal(writes, 1);
  await p.flush();
  assert.equal(writes, 1, "flush without dirty state does not write");
});

test("a failed write is reported, keeps the state dirty and is retried", async () => {
  const errors = [];
  let attempts = 0;
  const p = createPersister({
    write: async () => {
      attempts += 1;
      if (attempts === 1) throw new Error("EPERM");
    },
    debounceMs: 5,
    onError: (err) => errors.push(err.message),
  });
  p.markDirty();
  await sleep(30);
  assert.deepEqual(errors, ["EPERM"]);
  assert.equal(p.isDirty(), true);
  p.markDirty();
  await sleep(30);
  assert.equal(attempts, 2);
  assert.equal(p.isDirty(), false);
});
