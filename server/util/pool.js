/** Run async task factories with a fixed concurrency; results are returned in input order. */
export async function runPool(tasks, concurrency = 4) {
  const results = new Array(tasks.length);
  if (!tasks.length) return results;
  let next = 0;
  const workers = Array.from({ length: Math.min(concurrency, tasks.length) }, async () => {
    while (next < tasks.length) {
      const i = next++;
      results[i] = await tasks[i]();
    }
  });
  await Promise.all(workers);
  return results;
}
