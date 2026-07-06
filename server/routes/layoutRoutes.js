import { Router } from "express";
import { getLayout, resetLayout, saveLayout, updateLiveLayoutSlot } from "../services/layoutService.js";

export const layoutRoutes = Router();

layoutRoutes.get("/layout", (_req, res) => {
  res.json(getLayout());
});

layoutRoutes.post("/layout/reset", async (_req, res) => {
  try {
    res.json({ ok: true, layout: await resetLayout() });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

layoutRoutes.post("/layout/live", (req, res) => {
  const { slot, props } = req.body ?? {};
  updateLiveLayoutSlot(slot, props);
  res.json({ ok: true });
});

layoutRoutes.post("/layout", async (req, res) => {
  try {
    res.json({ ok: true, layout: await saveLayout(req.body ?? {}) });
  } catch (err) {
    res.status(err.status || 400).json({ error: err.message });
  }
});

