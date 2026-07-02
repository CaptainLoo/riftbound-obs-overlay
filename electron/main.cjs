const { app, BrowserWindow, Menu, Tray, shell, nativeImage, dialog } = require("electron");
const path = require("path");
const fs = require("fs");
const os = require("os");

function startupLogPath() {
  const appData = process.env.APPDATA || path.join(os.homedir(), "AppData", "Roaming");
  return path.join(appData, "RiftboundOBS", "startup.log");
}

function logStartup(message, err) {
  const line = `[${new Date().toISOString()}] ${message}${
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

// Avoid GPU-related startup crashes on some Windows setups.
app.disableHardwareAcceleration();

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
  if ((closeServer || attachedToExistingServer) && !isQuitting) {
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
      sandbox: false,
    },
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

  mainWindow.loadURL(`http://127.0.0.1:${port}/control`).catch((err) => {
    showStartupError("Control panel failed to load", err?.message || String(err));
  });

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

  registerShutdownForUpdate(async () => {
    isQuitting = true;
    shuttingDown = true;
    if (closeServer) await closeServer();
    destroyTray();
  });

  createWindow(PORT);
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
