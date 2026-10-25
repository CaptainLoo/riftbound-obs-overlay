import { Router } from "express";
import {
  checkForUpdate,
  downloadUpdate,
  getDownloadProgress,
  getLocalVersionInfo,
  listAvailableUpdates,
  getUpdateLog,
  getUpdateStatus,
  preflightUpdate,
  prepareApplyUpdate,
  runApplyShutdownAfterResponse,
} from "../updater.js";
import { isLocalRequest } from "../update-utils.js";

export const updateRoutes = Router();

updateRoutes.get("/version", (_req, res) => {
  res.json(getLocalVersionInfo());
});

updateRoutes.get("/update/releases", async (_req, res) => {
  try {
    res.json(await listAvailableUpdates());
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

updateRoutes.get("/update/check", async (req, res) => {
  try {
    res.json(await checkForUpdate({ version: req.query?.version }));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

updateRoutes.get("/update/progress", (_req, res) => {
  res.json(getDownloadProgress() || { status: "idle" });
});

updateRoutes.post("/update/download", async (req, res) => {
  try {
    res.json(await downloadUpdate({ version: req.body?.version }));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

updateRoutes.get("/update/status", (_req, res) => {
  res.json(getUpdateStatus());
});

updateRoutes.get("/update/log", (_req, res) => {
  res.json(getUpdateLog(200));
});

updateRoutes.post("/update/preflight", async (req, res) => {
  try {
    res.json(await preflightUpdate(req.body?.applyToken));
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

updateRoutes.post("/update/apply", async (req, res) => {
  if (!isLocalRequest(req)) {
    return res.status(403).json({ error: "Apply is only allowed from localhost." });
  }
  try {
    const prepared = await prepareApplyUpdate(req.body?.applyToken);
    res.json({
      ok: true,
      message: "Applying update and restarting…",
      expectedVersion: prepared.expectedVersion,
      mode: prepared.mode,
      logPath: prepared.logPath,
    });
    res.once("finish", () => {
      setImmediate(() => {
        runApplyShutdownAfterResponse(prepared).catch((err) => {
          console.error("[update] apply shutdown failed:", err.message);
        });
      });
    });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

