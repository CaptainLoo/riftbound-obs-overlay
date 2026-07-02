const { app, BrowserWindow, Menu, Tray, shell, nativeImage } = require("electron");
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

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.show();
      mainWindow.focus();
    }
  });
}

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

function createTray() {
  const iconPath = path.join(__dirname, "icon.png");
  tray = new Tray(nativeImage.createFromPath(iconPath));
  tray.setToolTip("Riftbound OBS");
  tray.setContextMenu(
    Menu.buildFromTemplate([
      {
        label: "Show control panel",
        click: () => {
          if (mainWindow) {
            mainWindow.show();
            mainWindow.focus();
          }
        },
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
  tray.on("double-click", () => {
    if (mainWindow) {
      mainWindow.show();
      mainWindow.focus();
    }
  });
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
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  Menu.setApplicationMenu(buildMenu());
  mainWindow.loadURL(`http://127.0.0.1:${port}/control`);

  mainWindow.on("close", (event) => {
    if (!isQuitting && process.platform === "darwin") {
      event.preventDefault();
      mainWindow.hide();
    }
  });
}

async function boot() {
  const startServer = await loadStartServer();
  const result = await startServer({ port: PORT, openBrowser: false });
  closeServer = result.close;
  createWindow(result.port);
  createTray();
}

app.whenReady().then(boot).catch((err) => {
  console.error(err);
  app.quit();
});

app.on("before-quit", async (event) => {
  if (!closeServer) return;
  event.preventDefault();
  isQuitting = true;
  try {
    await closeServer();
  } catch (err) {
    console.error(err);
  }
  closeServer = null;
  app.exit(0);
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    if (!isQuitting) {
      isQuitting = true;
      app.quit();
    }
  }
});

app.on("activate", () => {
  if (mainWindow) mainWindow.show();
});
