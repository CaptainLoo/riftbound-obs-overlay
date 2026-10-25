/**
 * Stream Deck HID worker. Runs in a separate process so native crashes cannot
 * take down the app. It holds no database: the server pushes a model over IPC
 * (see streamdeck/transport.js) and this process renders keys and forwards key
 * presses to the HTTP API.
 */
import { logStartup } from "./startupLog.js";
import { createTransport, isIpcAvailable } from "./streamdeck/transport.js";

const FIRST_MODEL_TIMEOUT_MS = 5000;

async function main() {
  logStartup("[streamdeck-worker] starting");

  if (!isIpcAvailable(process)) {
    logStartup("[streamdeck-worker] no IPC channel — the worker must be spawned by the server");
    process.exit(1);
  }
  const transport = createTransport(process);

  const fatal = (err) => {
    transport.sendStatus({
      supported: true,
      connected: false,
      phase: "error",
      worker: true,
      error: err?.message || String(err),
    });
    transport.flushStatus();
    setTimeout(() => process.exit(1), 50);
  };

  process.on("uncaughtException", (err) => {
    logStartup("[streamdeck-worker] uncaughtException", err);
    fatal(err);
  });
  process.on("unhandledRejection", (reason) => {
    logStartup("[streamdeck-worker] unhandledRejection", reason);
    fatal(reason instanceof Error ? reason : new Error(String(reason)));
  });

  transport.sendStatus({ supported: true, connected: false, phase: "loading", worker: true, error: null });

  let device;
  try {
    device = await import("./streamdeckDevice.js");
    logStartup("[streamdeck-worker] modules loaded");
  } catch (err) {
    logStartup("[streamdeck-worker] module load failed", err);
    fatal(new Error(`Stream Deck module failed to load: ${err.message || err}. Try reinstalling Riftbound OBS.`));
    return;
  }

  device.setStreamDeckStatusListener((s) => transport.sendStatus(s));

  let shuttingDown = false;
  const shutdown = async (quick = false) => {
    if (shuttingDown) return;
    shuttingDown = true;
    try {
      await device.stopStreamDeck({ quick });
    } catch {
      /* ignore */
    }
    transport.flushStatus();
    process.exit(0);
  };
  process.on("SIGTERM", () => shutdown(false));
  process.on("SIGINT", () => shutdown(false));
  process.on("disconnect", () => shutdown(true));

  // Wait for the first model before opening the device so the first draw is complete.
  const firstModel = new Promise((resolve) => {
    const timer = setTimeout(() => resolve(null), FIRST_MODEL_TIMEOUT_MS);
    transport.onModel(({ model }) => {
      clearTimeout(timer);
      resolve(model);
    });
  });
  transport.onModel(({ model }) => {
    device.setModel(model);
  });
  transport.onCommand((msg) => {
    if (msg.cmd === "refresh-images") {
      device.refreshStreamDeck(Boolean(msg.force)).catch((err) => logStartup("[streamdeck-worker] refresh-images failed", err));
    } else if (msg.cmd === "shutdown") {
      shutdown(Boolean(msg.quick));
    }
  });

  transport.sendReady();
  const model = await firstModel;
  if (model) {
    device.setModel(model, { refresh: false });
    logStartup("[streamdeck-worker] model received");
  } else {
    logStartup("[streamdeck-worker] no model received yet — starting with empty pages");
  }

  try {
    await device.startStreamDeck();
    logStartup(`[streamdeck-worker] device init done — ${JSON.stringify(device.getStreamDeckStatus())}`);
  } catch (err) {
    logStartup("[streamdeck-worker] init failed", err);
    fatal(err);
    return;
  }

  logStartup("[streamdeck-worker] running");
}

main().catch((err) => {
  logStartup("[streamdeck-worker] fatal", err);
  process.exit(1);
});
