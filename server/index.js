import { createServer } from "node:http";
import { exec } from "node:child_process";
import { pathToFileURL } from "node:url";
import express from "express";
import { PUBLIC_DIR, CARDS_DIR, DATA_DIR, IS_ELECTRON, IS_RELEASE } from "./paths.js";
import { initDb } from "./db.js";
import { initHub } from "./hub.js";
import { router } from "./routes.js";
import { startStreamDeckSafe, stopStreamDeckSafe } from "./streamdeckApi.js";

const DEFAULT_PORT = Number(process.env.PORT) || 7474;

export async function startServer(options = {}) {
  const port = Number(options.port) || DEFAULT_PORT;
  const openBrowser = options.openBrowser ?? (!IS_ELECTRON && IS_RELEASE && process.platform === "win32");

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
  app.use("/cards", express.static(CARDS_DIR, { maxAge: "1h" }));
  app.use("/control", express.static(`${PUBLIC_DIR}/control`));
  app.use("/overlay", express.static(`${PUBLIC_DIR}/overlay`));
  app.use("/shared", express.static(`${PUBLIC_DIR}/shared`));
  app.use("/preview", express.static(`${PUBLIC_DIR}/preview`));
  app.get("/", (_req, res) => res.redirect("/control"));

  const server = createServer(app);
  initHub(server);

  await new Promise((resolve, reject) => {
    server.once("error", (err) => {
      if (err?.code === "EADDRINUSE") {
        reject(
          new Error(
            `Port ${port} is already in use. Quit other Riftbound OBS instances in Task Manager, then try again.`
          )
        );
        return;
      }
      reject(err);
    });
    server.listen(port, "127.0.0.1", () => resolve());
  });

  console.log("Riftbound OBS Overlay");
  console.log(`  Overlay (Browser Source) : http://localhost:${port}/overlay`);
  console.log(`  Control panel            : http://localhost:${port}/control`);
  if (IS_RELEASE) console.log(`  Data folder              : ${DATA_DIR}`);
  if (IS_ELECTRON && process.platform === "win32") {
    startStreamDeckSafe();
  }

  if (openBrowser) {
    exec(`start http://localhost:${port}/control`);
  }

  const close = async () => {
    await stopStreamDeckSafe();
    await new Promise((resolve, reject) => {
      server.close((err) => (err ? reject(err) : resolve()));
    });
  };

  return { server, port, close };
}

const isDirectRun =
  process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isDirectRun) {
  startServer().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
