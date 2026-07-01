let settings = {};

function saveSettings(next) {
  settings = { ...settings, ...next };
  $SD.setSettings(settings);
}

async function fetchDeck(player) {
  const res = await fetch("http://127.0.0.1:7474/api/streamdeck");
  if (!res.ok) throw new Error("App offline");
  const data = await res.json();
  return data.players.find((p) => p.id === player);
}

async function fillCards() {
  const status = document.getElementById("status");
  const cardSel = document.getElementById("card");
  const player = document.getElementById("player").value;
  try {
    const p = await fetchDeck(player);
    cardSel.innerHTML = "";
    if (!p?.cards?.length) {
      status.textContent = "Import decks in the control panel first.";
      return;
    }
    for (const c of p.cards) {
      const opt = document.createElement("option");
      opt.value = c.id;
      opt.textContent = c.label || c.name;
      cardSel.appendChild(opt);
    }
    if (settings.cardId) cardSel.value = settings.cardId;
    status.textContent = `${p.pseudo || player} — ${p.cards.length} cards synced`;
  } catch {
    status.textContent = "Start Riftbound OBS first (port 7474).";
  }
}

function bindForm() {
  document.getElementById("player").value = settings.player || "p1";
  document.getElementById("player").addEventListener("change", () => {
    saveSettings({ player: document.getElementById("player").value });
    fillCards();
  });
  document.getElementById("card").addEventListener("change", () => {
    saveSettings({ cardId: document.getElementById("card").value });
  });
  fillCards();
}

$SD.onConnected(({ payload }) => {
  settings = payload.settings || {};
  bindForm();
});

$SD.onDidReceiveSettings(({ payload }) => {
  settings = payload.settings || {};
  document.getElementById("player").value = settings.player || "p1";
  if (settings.cardId) document.getElementById("card").value = settings.cardId;
});
