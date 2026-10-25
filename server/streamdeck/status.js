import { IS_ELECTRON, IS_RELEASE } from "../paths.js";

/**
 * Native Stream Deck control runs inside the desktop app and in `npm start`
 * dev mode, on any OS (macOS and Windows are both supported by node-hid).
 * Set RIFTBOUND_NO_STREAMDECK=1 to disable it.
 */
export function isStreamDeckSupported() {
  if (process.env.RIFTBOUND_NO_STREAMDECK === "1") return false;
  return IS_ELECTRON || !IS_RELEASE;
}

export function defaultStreamDeckStatus() {
  return {
    supported: isStreamDeckSupported(),
    connected: false,
    worker: false,
    phase: "idle",
    model: null,
    productName: null,
    serialNumber: null,
    firmwareVersion: null,
    deviceKey: "xl",
    currentPage: 0,
    pageCount: 0,
    pageNames: [],
    error: null,
    devicesFound: [],
    lastScanAt: null,
    drawProgress: null,
    imagesReady: false,
    imagesDegraded: false,
    imageUploadOk: null,
    imageUploadError: null,
    imagesDrawnCount: 0,
    imagesFailedCount: 0,
    cardPrefetch: null,
    cardsReady: 0,
    cardsTotal: 0,
    cardsMissing: [],
    refreshMode: null,
    uploadMode: null,
    panelRenderMs: null,
    panelEncodeMs: null,
    panelUploadMs: null,
    hint: null,
  };
}

export function formatStreamDeckError(err) {
  const msg = err?.message || String(err);
  if (/could not open|cannot open|access|busy|in use/i.test(msg)) {
    return "Stream Deck busy — quit the Elgato Stream Deck app completely, then click Reconnect.";
  }
  return msg;
}

export function resetStreamDeckStatusPatch() {
  return {
    connected: false,
    phase: "idle",
    model: null,
    productName: null,
    serialNumber: null,
    firmwareVersion: null,
    pageCount: 0,
    pageNames: [],
    currentPage: 0,
    error: null,
    drawProgress: null,
    imagesReady: false,
    imagesDegraded: false,
    imageUploadOk: null,
    imageUploadError: null,
    imagesDrawnCount: 0,
    imagesFailedCount: 0,
    cardPrefetch: null,
    cardsReady: 0,
    cardsTotal: 0,
    cardsMissing: [],
    refreshMode: null,
    uploadMode: null,
    panelRenderMs: null,
    panelEncodeMs: null,
    panelUploadMs: null,
  };
}
