const GAME_ICONS = {
  riftbound: { label: "RB", className: "riftbound", desc: "Overlay Riftbound avec decks, matchs Bo1/Bo3/Bo5 et Stream Deck." },
  pokemon: { label: "PK", className: "pokemon", desc: "Overlay Pokémon TCG — même interface pour l'instant, personnalisation à venir." },
};

async function api(path, opts = {}) {
  const res = await fetch(path, {
    headers: { "Content-Type": "application/json" },
    ...opts,
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  if (!res.ok) {
    const txt = await res.text().catch(() => res.statusText);
    try {
      const parsed = JSON.parse(txt);
      throw new Error(parsed.error || txt);
    } catch (err) {
      if (err instanceof Error && err.message !== txt) throw err;
      throw new Error(txt);
    }
  }
  return res.json();
}

async function selectGame(gameId) {
  const result = await api("/api/session/game", { method: "POST", body: { gameId } });
  window.location.href = result.redirect || "/control";
}

function renderGameCard(game, activeGameId) {
  const meta = GAME_ICONS[game.id] || { label: game.name.slice(0, 2).toUpperCase(), className: "", desc: "Configurer l'overlay pour ce jeu." };
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "game-card";
  if (game.id === activeGameId) btn.classList.add("active-session");
  btn.dataset.gameId = game.id;

  btn.innerHTML = `
    <div class="game-card-icon ${meta.className}">${meta.label}</div>
    <p class="game-card-name">${game.name}</p>
    <p class="game-card-desc">${meta.desc}</p>
  `;

  btn.addEventListener("click", async () => {
    btn.classList.add("loading");
    try {
      await selectGame(game.id);
    } catch (err) {
      btn.classList.remove("loading");
      alert(err.message || "Impossible de sélectionner ce jeu.");
    }
  });

  return btn;
}

async function init() {
  const [games, session] = await Promise.all([api("/api/games"), api("/api/session")]);

  const grid = document.getElementById("game-grid");
  for (const game of games) {
    grid.appendChild(renderGameCard(game, session.activeGame));
  }

  if (session.activeGame && session.gameName) {
    const wrap = document.getElementById("continue-wrap");
    const nameEl = document.getElementById("continue-game-name");
    const btn = document.getElementById("continue-btn");
    nameEl.textContent = session.gameName;
    wrap.classList.remove("hidden");
    btn.addEventListener("click", () => {
      window.location.href = session.controlPath || "/control";
    });
  }
}

init().catch((err) => {
  document.getElementById("game-grid").innerHTML = `<p class="home-hint">Erreur : ${err.message}</p>`;
});
