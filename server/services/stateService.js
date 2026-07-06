import { db, getActiveGameData, getActiveGameId } from "../db.js";
import { broadcastPatch, broadcastState } from "../hub.js";

let writeTimer = null;
let pendingWrite = null;
let pendingBroadcast = false;
let pendingSections = new Set();
let broadcastTimer = null;
let pendingBroadcastSections = new Set();
const WRITE_DEBOUNCE_MS = 120;
const BROADCAST_DEBOUNCE_MS = 32;

export function activeGameData() {
  return getActiveGameData();
}

export function activeGameId() {
  return getActiveGameId();
}

export async function persistAndBroadcast(sections = null) {
  await db.write();
  if (sections) broadcastPatch(sections);
  else broadcastState();
}

export function broadcastOnly(sections = null) {
  if (sections) broadcastPatch(sections);
  else broadcastState();
}

export function scheduleBroadcast(sections = null) {
  if (sections) {
    for (const section of Array.isArray(sections) ? sections : [sections]) {
      pendingBroadcastSections.add(section);
    }
  }
  clearTimeout(broadcastTimer);
  broadcastTimer = setTimeout(() => {
    broadcastTimer = null;
    if (pendingBroadcastSections.size) {
      broadcastPatch([...pendingBroadcastSections]);
      pendingBroadcastSections.clear();
    } else {
      broadcastState();
    }
  }, BROADCAST_DEBOUNCE_MS);
}

export function scheduleWrite({ broadcast = true, sections = null } = {}) {
  pendingBroadcast = pendingBroadcast || broadcast;
  if (sections) {
    for (const section of Array.isArray(sections) ? sections : [sections]) pendingSections.add(section);
  }
  if (pendingWrite) return pendingWrite;

  pendingWrite = new Promise((resolve, reject) => {
    clearTimeout(writeTimer);
    writeTimer = setTimeout(async () => {
      const shouldBroadcast = pendingBroadcast;
      pendingWrite = null;
      pendingBroadcast = false;
      try {
        await db.write();
        if (shouldBroadcast) {
          if (pendingSections.size) broadcastPatch([...pendingSections]);
          else broadcastState();
        }
        pendingSections.clear();
        resolve();
      } catch (err) {
        reject(err);
      }
    }, WRITE_DEBOUNCE_MS);
  });

  return pendingWrite;
}

export async function mutateGameState(mutator, { broadcast = true, sections = null, write = true, immediate = true } = {}) {
  const gameData = getActiveGameData();
  const result = await mutator(gameData);
  if (write) {
    if (immediate) await db.write();
    else scheduleWrite({ broadcast, sections });
  }
  if (broadcast && immediate) {
    if (sections) broadcastPatch(sections);
    else broadcastState();
  }
  return result ?? gameData;
}

