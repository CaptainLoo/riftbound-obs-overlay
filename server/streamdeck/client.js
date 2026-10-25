/** Tiny HTTP client the worker uses to drive the app (hot URLs, repair, model). */
const DEFAULT_PORT = Number(process.env.PORT) || 7474;
const API = `http://127.0.0.1:${DEFAULT_PORT}/api`;

function apiUrl(path) {
  return `${API}${path.startsWith("/") ? path : `/${path}`}`;
}

async function parse(res) {
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(text || `HTTP ${res.status}`);
  }
  return res.json().catch(() => ({}));
}

export async function apiGet(path) {
  return parse(await fetch(apiUrl(path)));
}

export async function apiPost(path, body = {}) {
  return parse(
    await fetch(apiUrl(path), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    })
  );
}
