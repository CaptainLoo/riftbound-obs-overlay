import { Router } from "express";
import { sessionRoutes } from "./routes/sessionRoutes.js";
import { dataRoutes } from "./routes/dataRoutes.js";
import { deckRoutes } from "./routes/deckRoutes.js";
import { matchRoutes } from "./routes/matchRoutes.js";
import { displayRoutes } from "./routes/displayRoutes.js";
import { layoutRoutes } from "./routes/layoutRoutes.js";
import { streamdeckRoutes } from "./routes/streamdeckRoutes.js";
import { updateRoutes } from "./routes/updateRoutes.js";

export const router = Router();

router.use(sessionRoutes);
router.use(dataRoutes);
router.use(deckRoutes);
router.use(matchRoutes);
router.use(displayRoutes);
router.use(layoutRoutes);
router.use(streamdeckRoutes);
router.use(updateRoutes);
