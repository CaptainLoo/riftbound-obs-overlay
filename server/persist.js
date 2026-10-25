/**
 * Single disk-write path for the app state.
 *
 * Mutations call `markDirty()` and return immediately; the JSON file is written
 * once per burst (150 ms debounce, 2 s maximum latency). `flush()` is the only
 * awaited write and is used on shutdown. A failed write is logged and retried
 * on the next `markDirty()` instead of rejecting into request handlers.
 */
import { db } from "./db.js";
import { logStartup } from "./startupLog.js";

export function createPersister({
  write,
  debounceMs = 150,
  maxLatencyMs = 2000,
  onError = (err) => logStartup("[persist] write failed", err),
} = {}) {
  let timer = null;
  let firstDirtyAt = 0;
  let dirty = false;
  let inFlight = null;
  let writes = 0;

  async function writeNow() {
    if (inFlight) {
      await inFlight;
      if (!dirty) return;
    }
    dirty = false;
    firstDirtyAt = 0;
    inFlight = (async () => {
      try {
        await write();
        writes += 1;
      } catch (err) {
        dirty = true;
        onError(err);
      }
    })();
    try {
      await inFlight;
    } finally {
      inFlight = null;
    }
  }

  function markDirty() {
    dirty = true;
    const now = Date.now();
    if (!firstDirtyAt) firstDirtyAt = now;
    clearTimeout(timer);
    const remaining = maxLatencyMs - (now - firstDirtyAt);
    const delay = Math.max(0, Math.min(debounceMs, remaining));
    timer = setTimeout(() => {
      timer = null;
      writeNow().catch(onError);
    }, delay);
  }

  async function flush() {
    clearTimeout(timer);
    timer = null;
    if (inFlight) await inFlight;
    if (dirty) await writeNow();
  }

  return {
    markDirty,
    flush,
    isDirty: () => dirty,
    writeCount: () => writes,
  };
}

const persister = createPersister({ write: () => db.write() });

export const markDirty = persister.markDirty;
export const flush = persister.flush;
export const isDirty = persister.isDirty;
