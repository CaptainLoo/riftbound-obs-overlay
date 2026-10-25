import { Router } from "express";
import { DEVICES } from "../streamdeckLayout.js";
import { buildStreamDeckModel } from "../streamdeck/model.js";
import {
  getStreamDeckStatusSafe,
  queueStreamDeckRefreshImages,
  reconnectStreamDeckSafe,
} from "../streamdeckApi.js";

export const streamdeckRoutes = Router();

function withHint(status) {
  return {
    ...status,
    devices: DEVICES,
    hint:
      status.hint ||
      (status.connected
        ? "Stream Deck is controlled directly by Riftbound OBS — no Elgato app required."
        : "Quit the Elgato Stream Deck app completely, then click Reconnect."),
  };
}

/** HID status only. Deck contents for keys come from /api/streamdeck/model. */
streamdeckRoutes.get("/streamdeck", async (_req, res) => {
  res.json(withHint(await getStreamDeckStatusSafe()));
});

/** The exact model pushed to the worker (debugging, tests, Companion). */
streamdeckRoutes.get("/streamdeck/model", (_req, res) => {
  res.json(buildStreamDeckModel());
});

streamdeckRoutes.post("/streamdeck/reconnect", async (_req, res) => {
  try {
    const status = await reconnectStreamDeckSafe();
    res.json({ ok: true, ...withHint(status) });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

streamdeckRoutes.post("/streamdeck/refresh-images", (_req, res) => {
  const queued = queueStreamDeckRefreshImages(true);
  if (!queued) {
    return res.status(503).json({ ok: false, error: "Stream Deck worker is not running." });
  }
  res.json({ ok: true, queued: true });
});
