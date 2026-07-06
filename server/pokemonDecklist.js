import {
  fetchCardByName,
  fetchCardBySetAndNumber,
  searchByName,
  toCandidate,
} from "./tcgdex.js";

const SECTION_HEADERS = [
  { category: "pokemon", re: /^Pok[eé]mon(?:\s*:\s*\d+)?\s*$/i },
  { category: "trainer", re: /^Trainer(?:\s*:\s*\d+)?\s*$/i },
  { category: "energy", re: /^Energy(?:\s*:\s*\d+)?\s*$/i },
];

const LINE_WITH_SET_RE = /^(\d+)\s+(.+?)\s+([A-Z][A-Z0-9]{1,3})\s+(\d+[a-z]?)\s*$/i;
const LINE_QTY_NAME_RE = /^(\d+)\s+(.+?)\s*$/i;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function emptyParsed() {
  return { pokemon: [], trainer: [], energy: [] };
}

/**
 * Parse a Limitless TCG export into Pokémon / Trainer / Energy sections.
 */
export function parseLimitless(text) {
  const result = emptyParsed();
  let current = "pokemon";

  for (const rawLine of String(text || "").split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("//") || line.startsWith("#")) continue;

    const header = SECTION_HEADERS.find((h) => h.re.test(line));
    if (header) {
      current = header.category;
      continue;
    }

    const withSet = line.match(LINE_WITH_SET_RE);
    if (withSet) {
      result[current].push({
        quantity: parseInt(withSet[1], 10) || 1,
        name: withSet[2].trim(),
        setCode: withSet[3].toUpperCase(),
        localId: withSet[4],
        line,
      });
      continue;
    }

    const simple = line.match(LINE_QTY_NAME_RE);
    if (simple) {
      result[current].push({
        quantity: parseInt(simple[1], 10) || 1,
        name: simple[2].trim(),
        setCode: null,
        localId: null,
        line,
      });
    }
  }

  return result;
}

async function resolveOne(entry) {
  let detail = null;
  let error = null;

  if (entry.setCode && entry.localId) {
    try {
      detail = await fetchCardBySetAndNumber(entry.setCode, entry.localId);
    } catch (err) {
      error = err.message;
    }
  }

  if (!detail) {
    try {
      detail = await fetchCardByName(entry.name, entry.setCode);
    } catch (err) {
      error = error || err.message;
    }
  }

  if (!detail) {
    const candidates = await searchByName(entry.name).catch(() => []);
    return {
      quantity: entry.quantity,
      name: entry.name,
      setCode: entry.setCode,
      localId: entry.localId,
      line: entry.line,
      candidates,
      chosen: candidates[0]?.card_id || null,
      ambiguous: candidates.length !== 1,
      error: candidates.length ? null : error || `Card not found: ${entry.name}`,
    };
  }

  const cand = toCandidate(detail);
  const lower = entry.name.toLowerCase();
  const exact = detail.name?.toLowerCase() === lower;

  return {
    quantity: entry.quantity,
    name: detail.name || entry.name,
    setCode: entry.setCode,
    localId: entry.localId,
    line: entry.line,
    candidates: [cand],
    chosen: detail.id,
    ambiguous: !exact,
    error: null,
  };
}

/** Resolve parsed Limitless entries against TCGdex. */
export async function resolveLimitless(parsed) {
  const out = emptyParsed();
  let resolved = 0;

  for (const [category, entries] of Object.entries(parsed)) {
    out[category] = [];
    for (const entry of entries) {
      if (resolved > 0 && resolved % 8 === 0) await sleep(120);
      out[category].push(await resolveOne(entry));
      resolved += 1;
    }
  }

  return out;
}
