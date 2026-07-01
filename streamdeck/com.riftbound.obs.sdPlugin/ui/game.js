let settings = {};

$SD.onConnected(({ payload }) => {
  settings = payload.settings || {};
  document.getElementById("index").value = String(settings.index ?? 0);
  document.getElementById("index").addEventListener("change", () => {
    settings.index = Number(document.getElementById("index").value);
    $SD.setSettings(settings);
  });
});

$SD.onDidReceiveSettings(({ payload }) => {
  settings = payload.settings || {};
  document.getElementById("index").value = String(settings.index ?? 0);
});
