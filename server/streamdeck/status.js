import { platform } from "node:os";
import { IS_ELECTRON } from "../paths.js";

export function defaultStreamDeckStatus() {
  return {
    supported: platform() === "win32" && IS_ELECTRON,
    connected: false,
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
    return "Stream Deck busy — quit the Elgato Stream Deck app completely, then restart Riftbound OBS.";
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

