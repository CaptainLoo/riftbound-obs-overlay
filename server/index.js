import { createServer } from "node:http";
import { exec } from "node:child_process";
import express from "express";
import { PUBLIC_DIR, CARDS_DIR, DATA_DIR, IS_RELEASE } from "./paths.js";
import { initDb } from "./db.js";
import { initHub } from "./hub.js";
import { router } from "./routes.js";

const PORT = Number(process.env.PORT) || 7474;

async function main() {
  await initDb();

  const app = express();
  app.use((req, res, next) => {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");
    if (req.method === "OPTIONS") return res.sendStatus(204);
    next();
  });
  app.use(express.json({ limit: "1mb" }));

  app.use("/api", router);

  // Cached card images.
  app.use("/cards", express.static(CARDS_DIR, { maxAge: "1h" }));

  // Web UIs.
  app.use("/control", express.static(`${PUBLIC_DIR}/control`));
  app.use("/overlay", express.static(`${PUBLIC_DIR}/overlay`));
  app.use("/shared", express.static(`${PUBLIC_DIR}/shared`));
  app.use("/preview", express.static(`${PUBLIC_DIR}/preview`));
  app.get("/", (_req, res) => res.redirect("/control"));

  const server = createServer(app);
  initHub(server);

  server.listen(PORT, "0.0.0.0", () => {
    console.log("Riftbound OBS Overlay");
    console.log(`  Overlay (Browser Source) : http://localhost:${PORT}/overlay`);
    console.log(`  Control panel            : http://localhost:${PORT}/control`);
    if (IS_RELEASE) console.log(`  Data folder              : ${DATA_DIR}`);
    if (IS_RELEASE && process.platform === "win32") {
      exec(`start http://localhost:${PORT}/control`);
    }
  });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
