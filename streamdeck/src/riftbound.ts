import http from "node:http";

export type ShowCardSettings = {
  player?: "p1" | "p2";
  cardId?: string;
  index?: number;
  host?: string;
  port?: number;
};

export type PlayerSettings = {
  player?: "p1" | "p2";
  host?: string;
  port?: number;
};

export type GameSettings = {
  index?: number;
  host?: string;
  port?: number;
};

export type BattlefieldSettings = {
  player?: "p1" | "p2";
  cardId?: string;
  label?: string;
  host?: string;
  port?: number;
};

export type GamePointSettings = {
  player?: "p1" | "p2";
  /** +1 or -1 */
  delta?: number;
  host?: string;
  port?: number;
};

export function apiBase(settings: { host?: string; port?: number }) {
  const host = settings.host?.trim() || "127.0.0.1";
  const port = Number(settings.port) || 7474;
  return `http://${host}:${port}`;
}

function request(
  method: "GET" | "POST",
  path: string,
  settings: { host?: string; port?: number },
  body?: unknown
): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const base = apiBase(settings);
    let url: URL;
    try {
      url = new URL(`${base}${path}`);
    } catch {
      reject(new Error(`Invalid server address: ${base}`));
      return;
    }

    const payload = body === undefined ? null : JSON.stringify(body);
    const req = http.request(
      {
        hostname: url.hostname,
        port: url.port || 7474,
        path: `${url.pathname}${url.search}`,
        method,
        headers:
          payload === null
            ? undefined
            : { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(payload) },
      },
      (res) => {
        let data = "";
        res.on("data", (chunk) => {
          data += chunk;
        });
        res.on("end", () => {
          if (res.statusCode && res.statusCode >= 400) {
            reject(new Error(data || `HTTP ${res.statusCode}`));
            return;
          }
          if (!data) {
            resolve({});
            return;
          }
          try {
            resolve(JSON.parse(data));
          } catch {
            resolve(data);
          }
        });
      }
    );

    req.on("error", (err) => {
      reject(
        new Error(
          `Riftbound app unreachable at ${base}. Launch Riftbound OBS and keep it running. (${err.message})`
        )
      );
    });
    req.setTimeout(8000, () => {
      req.destroy();
      reject(new Error(`Timeout connecting to ${base}`));
    });
    if (payload !== null) req.write(payload);
    req.end();
  });
}

export async function apiGet(path: string, settings: { host?: string; port?: number }) {
  return request("GET", path, settings);
}

export async function apiPost(path: string, settings: { host?: string; port?: number }, body: unknown) {
  return request("POST", path, settings, body);
}

export async function ping(settings: { host?: string; port?: number }) {
  return apiGet("/api/streamdeck", settings);
}

export async function showCard(settings: ShowCardSettings) {
  const player = settings.player || "p1";
  if (settings.cardId) {
    return apiGet(`/api/hot/card/${player}/${encodeURIComponent(settings.cardId)}`, settings);
  }
  if (typeof settings.index === "number" && Number.isFinite(settings.index)) {
    return apiGet(`/api/hot/card/${player}/index/${Math.floor(settings.index)}`, settings);
  }
  throw new Error("No card configured on this key");
}

export async function setBattlefield(settings: BattlefieldSettings) {
  const player = settings.player || "p1";
  const cardId = settings.cardId;
  if (!cardId) throw new Error("No battlefield configured on this key");
  return apiGet(`/api/hot/battlefield/${player}/${encodeURIComponent(cardId)}`, settings);
}

export async function adjustGamePoint(settings: GamePointSettings) {
  const player = settings.player || "p1";
  const delta = Number(settings.delta);
  if (delta !== 1 && delta !== -1) throw new Error("Invalid point delta");
  const op = delta > 0 ? "inc" : "dec";
  return apiGet(`/api/hot/score/${player}/${op}`, settings);
}

export async function fetchDeckProfile(settings: { host?: string; port?: number }) {
  return apiGet("/api/streamdeck", settings);
}

function requestBinary(path: string, settings: { host?: string; port?: number }): Promise<Buffer | null> {
  return new Promise((resolve, reject) => {
    const base = apiBase(settings);
    let url: URL;
    try {
      url = new URL(`${base}${path}`);
    } catch {
      reject(new Error(`Invalid server address: ${base}`));
      return;
    }

    const req = http.request(
      {
        hostname: url.hostname,
        port: url.port || 7474,
        path: `${url.pathname}${url.search}`,
        method: "GET",
      },
      (res) => {
        if (res.statusCode && res.statusCode >= 400) {
          res.resume();
          resolve(null);
          return;
        }
        const chunks: Buffer[] = [];
        res.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
        res.on("end", () => resolve(Buffer.concat(chunks)));
      }
    );

    req.on("error", () => resolve(null));
    req.setTimeout(8000, () => {
      req.destroy();
      resolve(null);
    });
    req.end();
  });
}

function bufferToDataUri(buffer: Buffer, mime: string) {
  return `data:${mime};base64,${buffer.toString("base64")}`;
}

export async function loadCardImage(cardId: string, settings: { host?: string; port?: number }) {
  const thumb = await requestBinary(`/cards/${cardId}-thumb.webp`, settings);
  if (thumb?.length) return bufferToDataUri(thumb, "image/webp");
  const png = await requestBinary(`/cards/${cardId}.png`, settings);
  if (png?.length) return bufferToDataUri(png, "image/png");
  return null;
}
