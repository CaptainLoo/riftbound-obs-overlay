import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { DATA_DIR } from "./paths.js";

const API_BASE = "https://api.tcgdex.net/v2/en";
const INDEX_FILE = join(DATA_DIR, "pokemon-set-index.json");
const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
const FETCH_CONCURRENCY = 12;

let memoryIndex = null;

async function fetchJson(url) {
  const res = await fetch(url, { headers: { Accept: "application/json" } });
  if (!res.ok) {
    throw new Error(`TCGdex ${res.status}: ${url}`);
  }
  return res.json();
}

async function runPool(tasks, concurrency) {
  const results = [];
  let i = 0;
  async function worker() {
    while (i < tasks.length) {
      const idx = i++;
      results[idx] = await tasks[idx]();
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, tasks.length) }, worker));
  return results;
}

async function buildIndexFromApi() {
  const briefSets = await fetchJson(`${API_BASE}/sets`);
  const tasks = briefSets.map((s) => async () => {
    try {
      const detail = await fetchJson(`${API_BASE}/sets/${s.id}`);
      const code = detail.abbreviation?.official?.toUpperCase();
      if (!code) return null;
      return { code, setId: detail.id, name: detail.name || s.name };
    } catch {
      return null;
    }
  });

  const rows = (await runPool(tasks, FETCH_CONCURRENCY)).filter(Boolean);
  const byCode = {};
  const bySetId = {};
  for (const row of rows) {
    byCode[row.code] = row.setId;
    bySetId[row.setId] = row.code;
  }

  return {
    updatedAt: new Date().toISOString(),
    byCode,
    bySetId,
    count: rows.length,
  };
}

function readDiskIndex() {
  if (!existsSync(INDEX_FILE)) return null;
  try {
    return JSON.parse(readFileSync(INDEX_FILE, "utf8"));
  } catch {
    return null;
  }
}

function isStale(index) {
  if (!index?.updatedAt) return true;
  return Date.now() - new Date(index.updatedAt).getTime() > MAX_AGE_MS;
}

/** Load or refresh the Limitless/PTCGO set code → TCGdex set id map. */
export async function ensureSetIndex(force = false) {
  if (memoryIndex && !force && !isStale(memoryIndex)) return memoryIndex;

  const disk = readDiskIndex();
  if (!force && disk && !isStale(disk)) {
    memoryIndex = disk;
    return memoryIndex;
  }

  mkdirSync(DATA_DIR, { recursive: true });
  memoryIndex = await buildIndexFromApi();
  writeFileSync(INDEX_FILE, `${JSON.stringify(memoryIndex, null, 2)}\n`, "utf8");
  return memoryIndex;
}

export function getSetIdForCode(setCode) {
  const code = String(setCode || "").toUpperCase();
  return memoryIndex?.byCode?.[code] || readDiskIndex()?.byCode?.[code] || null;
}

export function getCodeForSetId(setId) {
  return memoryIndex?.bySetId?.[setId] || readDiskIndex()?.bySetId?.[setId] || null;
}
