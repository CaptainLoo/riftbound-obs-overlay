let settings = {};

$SD.onConnected(({ payload }) => {
  settings = payload.settings || {};
  document.getElementById("player").value = settings.player || "p1";
  document.getElementById("player").addEventListener("change", () => {
    settings.player = document.getElementById("player").value;
    $SD.setSettings(settings);
  });
});

$SD.onDidReceiveSettings(({ payload }) => {
  settings = payload.settings || {};
  document.getElementById("player").value = settings.player || "p1";
});
