import { db } from "../db.js";
import { broadcastPatch, broadcastState } from "../hub.js";
import { markDirty } from "../persist.js";
import { pushStreamDeckModel } from "../streamdeckApi.js";

const BROADCAST_DEBOUNCE_MS = 32;

let broadcastTimer = null;
let pendingSections = new Set();
let pendingFull = false;

/** The single in-memory app state (players, match, display, layout, cardsCache). */
export function activeGameData() {
  return db.data;
}

/**
 * Coalesce broadcasts: several mutations within one frame produce one patch
 * carrying the union of their sections (or one full state if any asked for it).
 */
export function scheduleBroadcast(sections = null) {
  if (sections) {
    for (const section of Array.isArray(sections) ? sections : [sections]) pendingSections.add(section);
  } else {
    pendingFull = true;
  }
  if (broadcastTimer) return;
  broadcastTimer = setTimeout(() => {
    broadcastTimer = null;
    const full = pendingFull;
    const list = [...pendingSections];
    pendingFull = false;
    pendingSections.clear();
    if (full || !list.length) broadcastState();
    else broadcastPatch(list);
    pushStreamDeckModel();
  }, BROADCAST_DEBOUNCE_MS);
}

/**
 * Record a mutation of `db.data`: broadcast the affected sections to overlay /
 * control clients (coalesced) and schedule a debounced disk write.
 * Synchronous on purpose: request handlers must not wait for the disk.
 */
export function commit(sections = null) {
  scheduleBroadcast(sections);
  markDirty();
}
