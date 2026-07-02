const { contextBridge } = require("electron");

contextBridge.exposeInMainWorld("riftboundDesktop", {
  platform: process.platform,
});
