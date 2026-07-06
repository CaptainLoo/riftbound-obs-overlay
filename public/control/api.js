export async function api(path, opts = {}) {
  const res = await fetch(path, {
    headers: { "Content-Type": "application/json" },
    ...opts,
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  if (!res.ok) {
    const txt = await res.text().catch(() => res.statusText);
    try {
      const parsed = JSON.parse(txt);
      throw new Error(parsed.error || txt);
    } catch (err) {
      if (err instanceof Error && err.message !== txt) throw err;
      throw new Error(txt);
    }
  }
  return res.status === 204 ? null : res.json();
}

