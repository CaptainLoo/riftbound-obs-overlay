/**
 * Memoize an async function with a TTL, a size cap (oldest-first eviction) and
 * in-flight de-duplication: concurrent calls for the same key share one promise.
 */
export function memoAsync(fn, { ttlMs = 60_000, max = 500, key = (...args) => JSON.stringify(args), now = Date.now } = {}) {
  const cache = new Map(); // key -> { value, at }
  const inFlight = new Map(); // key -> promise

  function evict() {
    while (cache.size > max) {
      const oldest = cache.keys().next().value;
      cache.delete(oldest);
    }
  }

  async function memoized(...args) {
    const k = key(...args);
    const hit = cache.get(k);
    if (hit && now() - hit.at < ttlMs) return hit.value;
    if (inFlight.has(k)) return inFlight.get(k);

    const p = (async () => {
      try {
        const value = await fn(...args);
        cache.delete(k);
        cache.set(k, { value, at: now() });
        evict();
        return value;
      } finally {
        inFlight.delete(k);
      }
    })();
    inFlight.set(k, p);
    return p;
  }

  memoized.clear = () => {
    cache.clear();
  };
  memoized.size = () => cache.size;
  return memoized;
}
