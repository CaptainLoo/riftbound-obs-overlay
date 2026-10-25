const { app, BrowserWindow, Menu, Tray, shell, nativeImage, dialog } = require("electron");
const path = require("path");
const fs = require("fs");
const os = require("os");

/** Same user-data folder as server/paths.js (Windows %APPDATA%, macOS Library/Application Support). */
function userDataDir() {
  if (process.platform === "win32") {
    return path.join(process.env.APPDATA || path.join(os.homedir(), "AppData", "Roaming"), "RiftboundOBS");
  }
  if (process.platform === "darwin") {
    return path.join(os.homedir(), "Library", "Application Support", "RiftboundOBS");
  }
  return path.join(os.homedir(), ".config", "riftbound-obs");
}

function startupLogPath() {
  return path.join(userDataDir(), "startup.log");
}

function logStartup(message, err) {
  const uptime = Math.round(process.uptime() * 1000);
  const line = `[${new Date().toISOString()}] [main +${uptime}ms] ${message}${
    err ? ` — ${err && (err.stack || err.message || String(err))}` : ""
  }`;
  try {
    fs.mkdirSync(path.dirname(startupLogPath()), { recursive: true });
    fs.appendFileSync(startupLogPath(), `${line}\n`, "utf8");
  } catch {
    /* ignore */
  }
  console.error(line);
}

logStartup("Electron main starting");

/**
 * GPU policy: hardware acceleration stays on (the layout editor hosts a live
 * overlay iframe with masks and transforms). If the GPU process dies during the
 * first seconds, write an opt-out flag and relaunch once in software mode.
 */
const GPU_OPT_OUT_FLAG = path.join(path.dirname(startupLogPath()), "disable-gpu");
const GPU_WATCH_MS = 30000;
if (fs.existsSync(GPU_OPT_OUT_FLAG) || process.env.RIFTBOUND_DISABLE_GPU === "1") {
  app.disableHardwareAcceleration();
  logStartup("Hardware acceleration disabled (opt-out flag)");
}
app.on("child-process-gone", (_event, details) => {
  if (details?.type !== "GPU") return;
  logStartup(`[main] GPU process gone: ${details.reason}`);
  const early = process.uptime() * 1000 < GPU_WATCH_MS;
  if (!early || fs.existsSync(GPU_OPT_OUT_FLAG)) return;
  if (["clean-exit", "killed"].includes(details.reason)) return;
  try {
    fs.writeFileSync(GPU_OPT_OUT_FLAG, `${new Date().toISOString()} ${details.reason}\n`, "utf8");
  } catch {
    /* ignore */
  }
  logStartup("Relaunching with hardware acceleration disabled");
  // The opt-out flag written above is what stops a relaunch loop.
  app.relaunch();
  app.exit(0);
});

process.env.RIFTBOUND_ELECTRON = "1";
if (!app.isPackaged) {
  process.env.RIFTBOUND_DEV = "1";
}
process.env.RIFTBOUND_INSTALL_ROOT = app.isPackaged
  ? path.dirname(process.execPath)
  : path.join(__dirname, "..");

const PORT = Number(process.env.PORT) || 7474;
const OVERLAY_URL = `http://127.0.0.1:${PORT}/overlay`;

let mainWindow = null;
let tray = null;
let closeServer = null;
let isQuitting = false;
let shuttingDown = false;
let attachedToExistingServer = false;

function showStartupError(title, message) {
  logStartup(`ERROR: ${title}`, message);
  try {
    dialog.showErrorBox(title, message);
  } catch {
    console.error(`${title}: ${message}`);
  }
}

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.whenReady().then(() => {
    showStartupError(
      "Riftbound OBS",
      "Another copy is already running.\n\nClose Riftbound OBS.exe in Task Manager, then launch again."
    );
  });
  app.quit();
} else {
  app.on("second-instance", () => {
    showMainWindow();
  });
}

process.on("uncaughtException", (err) => {
  logStartup("[main] uncaughtException", err);
  showStartupError("Riftbound OBS crashed", err?.message || String(err));
});

process.on("unhandledRejection", (reason) => {
  logStartup("[main] unhandledRejection", reason);
});

async function probeLocalServer(port) {
  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/version`);
    return res.ok;
  } catch {
    return false;
  }
}

async function loadStartServer() {
  const entry = app.isPackaged
    ? path.join(process.resourcesPath, "riftbound", "server", "index.js")
    : path.join(__dirname, "..", "server", "index.js");
  const mod = await import(`file://${entry.replace(/\\/g, "/")}`);
  return mod;
}

function buildMenu() {
  return Menu.buildFromTemplate([
    {
      label: "Riftbound OBS",
      submenu: [
        {
          label: "Copy overlay URL",
          click: () => {
            const { clipboard } = require("electron");
            clipboard.writeText(OVERLAY_URL);
          },
        },
        {
          label: "Open overlay in browser",
          click: () => shell.openExternal(OVERLAY_URL),
        },
        { type: "separator" },
        { role: "quit" },
      ],
    },
    { role: "editMenu" },
    { role: "viewMenu" },
  ]);
}

function showMainWindow() {
  if (mainWindow && !mainWindow.isDestroyed()) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
    return;
  }
  if (!isQuitting) {
    createWindow(PORT);
  }
}

function destroyTray() {
  if (tray) {
    try {
      tray.destroy();
    } catch {
      /* ignore */
    }
    tray = null;
  }
}

function trayIconPath() {
  if (app.isPackaged) {
    const external = path.join(process.resourcesPath, "icon.png");
    if (fs.existsSync(external)) return external;
  }
  return path.join(__dirname, "icon.png");
}

function createTray() {
  if (process.env.RIFTBOUND_NO_TRAY === "1") {
    logStartup("Tray skipped (RIFTBOUND_NO_TRAY=1)");
    return;
  }
  const iconPath = trayIconPath();
  const icon = nativeImage.createFromPath(iconPath);
  if (icon.isEmpty()) {
    logStartup(`Tray skipped — icon empty (${iconPath})`);
    return;
  }
  tray = new Tray(icon);
  tray.setToolTip("Riftbound OBS");
  tray.setContextMenu(
    Menu.buildFromTemplate([
      {
        label: "Show control panel",
        click: () => showMainWindow(),
      },
      {
        label: "Copy overlay URL",
        click: () => {
          const { clipboard } = require("electron");
          clipboard.writeText(OVERLAY_URL);
        },
      },
      { type: "separator" },
      {
        label: "Quit",
        click: () => {
          isQuitting = true;
          app.quit();
        },
      },
    ])
  );
  tray.on("double-click", () => showMainWindow());
}

let serverReady = false;

function loadControl(port) {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  mainWindow.loadURL(`http://127.0.0.1:${port}/control`).catch((err) => {
    showStartupError("Control panel failed to load", err?.message || String(err));
  });
}

function createWindow(port) {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 900,
    minWidth: 960,
    minHeight: 640,
    title: "Riftbound OBS — Control",
    icon: trayIconPath(),
    autoHideMenuBar: false,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
    backgroundColor: "#0e1117",
  });

  Menu.setApplicationMenu(buildMenu());

  mainWindow.webContents.on("render-process-gone", (_event, details) => {
    logStartup("[main] render-process-gone", details);
  });

  mainWindow.once("ready-to-show", () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.show();
      logStartup("Control window shown");
    }
  });
  mainWindow.webContents.on("did-finish-load", () => {
    const url = mainWindow?.webContents.getURL() || "";
    logStartup(url.startsWith("file:") ? "Loading page shown" : "Control page loaded");
  });

  if (serverReady) {
    loadControl(port);
  } else {
    mainWindow.loadFile(path.join(__dirname, "loading.html")).catch(() => {});
  }

  mainWindow.on("closed", () => {
    mainWindow = null;
  });

  mainWindow.on("close", (event) => {
    if (!isQuitting && process.platform === "darwin") {
      event.preventDefault();
      mainWindow.hide();
      return;
    }
    if (!isQuitting) {
      isQuitting = true;
    }
  });
}

async function boot() {
  // Show the window immediately; the renderer spawns while the server boots.
  createWindow(PORT);

  logStartup("Loading server…");
  const { startServer, registerShutdownForUpdate } = await loadStartServer();
  logStartup("Starting server…");
  try {
    const result = await startServer({ port: PORT, openBrowser: false });
    closeServer = result.close;
    logStartup(`Server ready on port ${result.port}`);
  } catch (err) {
    const portBusy = /already in use|EADDRINUSE/i.test(String(err?.message || err));
    if (portBusy && (await probeLocalServer(PORT))) {
      attachedToExistingServer = true;
      logStartup(`Port ${PORT} busy — attached to existing Riftbound server`);
    } else {
      throw err;
    }
  }
  serverReady = true;
  loadControl(PORT);

  registerShutdownForUpdate(async () => {
    isQuitting = true;
    shuttingDown = true;
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.destroy();
      mainWindow = null;
    }
    if (closeServer) await closeServer();
    destroyTray();
  });

  setTimeout(() => {
    try {
      createTray();
      logStartup("Tray created");
    } catch (err) {
      logStartup("[main] Tray failed", err);
    }
  }, 1500);
}

app.whenReady().then(boot).catch((err) => {
  logStartup("Boot failed", err);
  showStartupError("Riftbound OBS failed to start", err?.message || String(err));
  app.quit();
});

app.on("before-quit", async (event) => {
  if (shuttingDown) return;
  if (!closeServer) {
    logStartup("Quit without stopping server (attached mode or no server)");
    return;
  }
  event.preventDefault();
  shuttingDown = true;
  isQuitting = true;
  try {
    logStartup("Stopping server…");
    await closeServer();
    logStartup("Server stopped");
  } catch (err) {
    logStartup("Server stop error", err);
  }
  closeServer = null;
  destroyTray();
  mainWindow = null;
  app.exit(0);
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin" && !isQuitting) {
    isQuitting = true;
    app.quit();
  }
});

app.on("activate", () => {
  showMainWindow();
});
