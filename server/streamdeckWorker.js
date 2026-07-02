/**
 * Stream Deck HID worker — runs in a separate process so native crashes cannot take down the app.
 */
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import WebSocket from "ws";
import { DATA_DIR } from "./paths.js";
import { initDb } from "./db.js";
import { logStartup } from "./startupLog.js";

const STATUS_FILE = join(DATA_DIR, "streamdeck-status.json");
const QUICK_CLOSE_FLAG = join(DATA_DIR, "streamdeck-quick-close.flag");
const DEFAULT_PORT = Number(process.env.PORT) || 7474;

function writeStatus(status) {
  try {
    mkdirSync(DATA_DIR, { recursive: true });
    writeFileSync(STATUS_FILE, `${JSON.stringify({ ...status, worker: true }, null, 2)}\n`, "utf8");
  } catch (err) {
    logStartup("[streamdeck-worker] status write failed", err);
  }
}

function writeFatalStatus(error) {
  writeStatus({
    supported: true,
    connected: false,
    phase: "error",
    worker: true,
    error: error?.message || String(error),
  });
}

async function main() {
  logStartup("[streamdeck-worker] starting");
  writeStatus({
    supported: true,
    connected: false,
    phase: "loading",
    worker: true,
    error: null,
  });

  process.on("uncaughtException", (err) => {
    logStartup("[streamdeck-worker] uncaughtException", err);
    writeFatalStatus(err);
    process.exit(1);
  });

  process.on("unhandledRejection", (reason) => {
    logStartup("[streamdeck-worker] unhandledRejection", reason);
    writeFatalStatus(reason instanceof Error ? reason : new Error(String(reason)));
    process.exit(1);
  });

  let startStreamDeck;
  let stopStreamDeck;
  let refreshStreamDeck;
  let getStreamDeckStatus;
  let setStreamDeckStatusListener;

  try {
    ({
      startStreamDeck,
      stopStreamDeck,
      refreshStreamDeck,
      getStreamDeckStatus,
      setStreamDeckStatusListener,
    } = await import("./streamdeckDevice.js"));
  } catch (err) {
    logStartup("[streamdeck-worker] module load failed", err);
    writeFatalStatus(
      new Error(
        `Stream Deck module failed to load: ${err.message || err}. Try reinstalling Riftbound OBS.`
      )
    );
    process.exit(1);
  }

  setStreamDeckStatusListener((s) => writeStatus(s));

  const publishStatus = () => writeStatus(getStreamDeckStatus());

  const shutdown = async (code = 0) => {
    try {
      if (existsSync(QUICK_CLOSE_FLAG)) {
        process.env.RIFTBOUND_SD_QUICK_CLOSE = "1";
        rmSync(QUICK_CLOSE_FLAG, { force: true });
      }
      await stopStreamDeck();
    } catch {
      /* ignore */
    }
    process.exit(code);
  };

  process.on("SIGTERM", () => shutdown(0));
  process.on("SIGINT", () => shutdown(0));

  try {
    logStartup("[streamdeck-worker] initDb…");
    writeStatus({ ...getStreamDeckStatus(), phase: "loading", error: null });
    await initDb();
    logStartup("[streamdeck-worker] initDb OK");
  } catch (err) {
    logStartup("[streamdeck-worker] initDb failed", err);
    writeFatalStatus(new Error(`Database init failed: ${err.message || err}`));
    process.exit(1);
  }

  try {
    await startStreamDeck();
    publishStatus();
    logStartup(`[streamdeck-worker] device init done — ${JSON.stringify(getStreamDeckStatus())}`);
  } catch (err) {
    logStartup("[streamdeck-worker] init failed", err);
    writeFatalStatus(err);
    process.exit(1);
  }

  const wsUrl = `ws://127.0.0.1:${DEFAULT_PORT}`;
  let ws = null;
  let refreshTimer = null;

  const scheduleRefresh = () => {
    clearTimeout(refreshTimer);
    refreshTimer = setTimeout(() => {
      refreshStreamDeck(false)
        .then(publishStatus)
        .catch((err) => logStartup("[streamdeck-worker] refresh failed", err));
    }, 300);
  };

  const connectWs = () => {
    ws = new WebSocket(wsUrl);
    ws.on("open", () => logStartup("[streamdeck-worker] ws connected"));
    ws.on("message", (raw) => {
      try {
        const msg = JSON.parse(String(raw));
        if (msg.type === "state") scheduleRefresh();
      } catch {
        /* ignore */
      }
    });
    ws.on("close", () => {
      setTimeout(connectWs, 2000);
    });
    ws.on("error", () => {
      /* reconnect via close */
    });
  };

  connectWs();
  setInterval(publishStatus, 3000);

  logStartup("[streamdeck-worker] running");
}

main().catch((err) => {
  logStartup("[streamdeck-worker] fatal", err);
  writeFatalStatus(err);
  process.exit(1);
});
