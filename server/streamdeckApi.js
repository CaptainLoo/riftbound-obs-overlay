/**
 * Safe lazy entry to Stream Deck — native modules must not block app startup.
 */
let deviceMod = null;
let loadError = null;

async function loadDeviceMod() {
  if (deviceMod) return deviceMod;
  if (loadError) throw loadError;
  try {
    deviceMod = await import("./streamdeckDevice.js");
    return deviceMod;
  } catch (err) {
    loadError = err;
    throw err;
  }
}

export async function startStreamDeckSafe() {
  try {
    const mod = await loadDeviceMod();
    await mod.startStreamDeck();
  } catch (err) {
    console.error("[streamdeck] Startup failed:", err.message || err);
  }
}

export async function stopStreamDeckSafe() {
  try {
    const mod = await loadDeviceMod();
    await mod.stopStreamDeck();
  } catch {
    /* ignore */
  }
}

export async function getStreamDeckStatusSafe() {
  try {
    const mod = await loadDeviceMod();
    return mod.getStreamDeckStatus();
  } catch (err) {
    return {
      supported: false,
      connected: false,
      error: `Stream Deck module unavailable: ${err.message || err}`,
    };
  }
}

export function refreshStreamDeckIfConnectedSafe() {
  loadDeviceMod()
    .then((mod) => {
      if (mod.refreshStreamDeckIfConnected) mod.refreshStreamDeckIfConnected();
    })
    .catch(() => {});
}
