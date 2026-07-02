const { app, BrowserWindow, Menu, Tray, shell, nativeImage, dialog } = require("electron");
const path = require("path");

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

function showStartupError(title, message) {
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
  console.error("[main] uncaughtException:", err);
  showStartupError("Riftbound OBS crashed", err?.message || String(err));
});

async function loadStartServer() {
  const entry = app.isPackaged
    ? path.join(process.resourcesPath, "riftbound", "server", "index.js")
    : path.join(__dirname, "..", "server", "index.js");
  const mod = await import(`file://${entry.replace(/\\/g, "/")}`);
  return mod.startServer;
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
  if (closeServer && !isQuitting) {
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

function createTray() {
  const iconPath = path.join(__dirname, "icon.png");
  tray = new Tray(nativeImage.createFromPath(iconPath));
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
    icon: path.join(__dirname, "icon.png"),
    autoHideMenuBar: false,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  Menu.setApplicationMenu(buildMenu());
  mainWindow.once("ready-to-show", () => {
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.show();
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
  const startServer = await loadStartServer();
  const result = await startServer({ port: PORT, openBrowser: false });
  closeServer = result.close;
  createWindow(result.port);
  try {
    createTray();
  } catch (err) {
    console.error("[main] Tray failed:", err);
  }
}

app.whenReady().then(boot).catch((err) => {
  console.error(err);
  showStartupError("Riftbound OBS failed to start", err?.message || String(err));
  app.quit();
});

app.on("before-quit", async (event) => {
  if (shuttingDown) return;
  if (!closeServer) return;
  event.preventDefault();
  shuttingDown = true;
  isQuitting = true;
  try {
    await closeServer();
  } catch (err) {
    console.error(err);
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
