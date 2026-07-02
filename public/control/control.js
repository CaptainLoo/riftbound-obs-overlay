import { connectState } from "/shared/ws.js";
import {
  frameClass,
  heightForWidth,
  layoutToCss,
  normalizeLayout,
  normalizeLayoutSlot,
  round,
  SLOT_RATIO,
  TEXT_SLOTS,
  widthForHeight,
} from "/shared/layout.js";

const SLOT_LABELS = {
  "p1.pseudo": "P1 · Name",
  "p2.pseudo": "P2 · Name",
  score: "Score",
  "p1.legend": "P1 · Legend",
  "p2.legend": "P2 · Legend",
  "p1.battlefield": "P1 · Battlefield",
  "p2.battlefield": "P2 · Battlefield",
  "p1.champion": "P1 · Champion",
  "p2.champion": "P2 · Champion",
  "p1.card": "P1 · Show card",
  "p2.card": "P2 · Show card",
  playArea: "Play area (camera)",
  "match.tally": "Match tally (1–0)",
};

const CATEGORY_LABELS = {
  legend: "Legend",
  champions: "Champion",
  maindeck: "Main deck",
  battlefields: "Battlefields",
  runes: "Runes",
  sideboard: "Side deck",
};

let data = null;
const previews = { p1: null, p2: null };
const decklistText = { p1: "", p2: "" };
const decklistFormat = { p1: "sections", p2: "sections" };
let selectedSlot = null;

// ---- helpers --------------------------------------------------------------

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
  return res.status === 204 ? null : res.json();
}

const toastEl = document.getElementById("toast");
let toastTimer = null;
function toast(msg, kind = "ok") {
  toastEl.textContent = msg;
  toastEl.className = `toast show ${kind}`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (toastEl.className = "toast"), 2200);
}

function cardName(id) {
  if (!id) return "";
  return data?.cardsCache?.[id]?.name || id;
}
function cardThumb(id) {
  return data?.cardsCache?.[id]?.thumbLocal || "";
}

function player(id) {
  return data.players.find((p) => p.id === id);
}

async function reload() {
  data = await api("/api/data");
  data.layout = normalizeLayout(data.layout);
  renderPlayers();
  renderMatch();
  renderStreamDeck();
  syncLayoutFromData();
}

// ---- Tabs -----------------------------------------------------------------

document.querySelectorAll(".tab").forEach((tab) => {
  tab.addEventListener("click", () => {
    document.querySelectorAll(".tab").forEach((t) => t.classList.remove("active"));
    document.querySelectorAll(".panel").forEach((p) => p.classList.remove("active"));
    tab.classList.add("active");
    document.getElementById(`tab-${tab.dataset.tab}`).classList.add("active");
  });
});

// ---- Players & decks ------------------------------------------------------

function renderPlayers() {
  const grid = document.getElementById("players-grid");
  grid.innerHTML = "";
  for (const id of ["p1", "p2"]) {
    const p = player(id);
    const block = document.createElement("div");
    block.className = "card-block";
    block.innerHTML = `
      <h2>${id === "p1" ? "Player 1" : "Player 2"}</h2>
      <div class="field">
        <label>Name</label>
        <input type="text" data-pseudo="${id}" value="${escapeAttr(p.pseudo)}" placeholder="Player name" />
      </div>
      <div class="field">
        <label>Decklist (sectioned text)</label>
        <textarea data-deck="${id}" placeholder="Legend:\n1 Legend\nChampion:\n1 Champion\nMainDeck:\n3 Card\nBattlefields:\n1 Battlefield\nRunes:\n6 Rune\nSideboard:\n2 Card">${escapeHtml(decklistText[id])}</textarea>
      </div>
      <div class="row">
        <span class="inline-lbl">Format</span>
        <select data-fmt="${id}" style="width: auto">
          <option value="sections" ${decklistFormat[id] === "sections" ? "selected" : ""}>Sectioned text</option>
          <option value="tts" ${decklistFormat[id] === "tts" ? "selected" : ""}>TTS / Piltover</option>
        </select>
        <button class="btn" data-analyze="${id}">Analyze</button>
        <button class="btn ghost" data-save="${id}">Save deck</button>
        <span class="hint" data-deckinfo="${id}">${deckSummary(p.deck)}</span>
      </div>
      <div class="preview" data-preview="${id}"></div>
    `;
    grid.appendChild(block);
  }

  grid.querySelectorAll("[data-pseudo]").forEach((input) => {
    input.addEventListener("change", async () => {
      await api(`/api/players/${input.dataset.pseudo}/pseudo`, {
        method: "POST",
        body: { pseudo: input.value },
      });
      toast("Name saved");
    });
  });

  grid.querySelectorAll("[data-deck]").forEach((ta) => {
    ta.addEventListener("input", () => (decklistText[ta.dataset.deck] = ta.value));
  });

  grid.querySelectorAll("[data-fmt]").forEach((sel) => {
    sel.addEventListener("change", () => (decklistFormat[sel.dataset.fmt] = sel.value));
  });

  grid.querySelectorAll("[data-analyze]").forEach((btn) => {
    btn.addEventListener("click", () => analyzeDeck(btn.dataset.analyze));
  });
  grid.querySelectorAll("[data-save]").forEach((btn) => {
    btn.addEventListener("click", () => saveDeck(btn.dataset.save));
  });

  for (const id of ["p1", "p2"]) if (previews[id]) renderPreview(id);
}

function deckSummary(deck) {
  if (!deck) return "";
  const count = (a) => (a || []).reduce((s, e) => s + (e.quantity || 1), 0);
  const parts = [];
  if (deck.legend) parts.push("legend ✓");
  if (deck.champions?.length) parts.push(`${deck.champions.length} champion`);
  if (deck.maindeck?.length) parts.push(`${count(deck.maindeck)} main`);
  if (deck.battlefields?.length) parts.push(`${deck.battlefields.length} battlefields`);
  if (deck.runes?.length) parts.push(`${count(deck.runes)} runes`);
  if (deck.sideboard?.length) parts.push(`${count(deck.sideboard)} side`);
  return parts.length ? `Deck saved: ${parts.join(", ")}` : "No deck saved";
}

async function analyzeDeck(id) {
  const text = decklistText[id];
  if (!text.trim()) return toast("Paste a decklist first", "err");
  try {
    toast("Analyzing…");
    previews[id] = await api("/api/decklist/preview", {
      method: "POST",
      body: { text, format: decklistFormat[id] },
    });
    renderPreview(id);
    toast("Analysis done — check ambiguous cards");
  } catch (err) {
    toast("Analysis error: " + err.message, "err");
  }
}

function renderPreview(id) {
  const container = document.querySelector(`[data-preview="${id}"]`);
  const preview = previews[id];
  container.innerHTML = "";
  if (!preview) return;

  for (const [cat, entries] of Object.entries(preview)) {
    if (!entries.length) continue;
    const wrap = document.createElement("div");
    wrap.className = "preview-cat";
    wrap.innerHTML = `<h3>${CATEGORY_LABELS[cat] || cat}</h3>`;

    entries.forEach((entry, idx) => {
      const row = document.createElement("div");
      row.className = "entry" + (entry.ambiguous ? " ambiguous" : "");
      const thumb = entry.chosen
        ? entry.candidates.find((c) => c.card_id === entry.chosen)?.thumbnail_url || ""
        : "";

      let control;
      if (entry.candidates.length) {
        const options = entry.candidates
          .map(
            (c) =>
              `<option value="${c.card_id}" ${c.card_id === entry.chosen ? "selected" : ""}>${escapeHtml(
                c.name
              )} · ${c.card_id}</option>`
          )
          .join("");
        control = `<select data-pick="${cat}:${idx}">${options}</select>`;
      } else {
        control = `<span class="unresolved">Not found: "${escapeHtml(entry.name)}"</span>`;
      }

      row.innerHTML = `
        <img src="${thumb}" alt="" />
        <span class="qty">×${entry.quantity}</span>
        ${control}
      `;
      wrap.appendChild(row);
    });

    container.appendChild(wrap);
  }

  container.querySelectorAll("[data-pick]").forEach((sel) => {
    sel.addEventListener("change", () => {
      const [cat, idx] = sel.dataset.pick.split(":");
      previews[id][cat][Number(idx)].chosen = sel.value;
      const img = sel.parentElement.querySelector("img");
      const cand = previews[id][cat][Number(idx)].candidates.find((c) => c.card_id === sel.value);
      if (img && cand) img.src = cand.thumbnail_url || "";
    });
  });
}

async function saveDeck(id) {
  const preview = previews[id];
  if (!preview) return toast("Analyze the decklist first", "err");

  const mapEntries = (arr) =>
    (arr || [])
      .filter((e) => e.chosen)
      .map((e) => ({ id: e.chosen, quantity: e.quantity }));

  let champions = (preview.champions || []).filter((e) => e.chosen).map((e) => e.chosen);
  // No explicit Champion section (e.g. TTS import): offer every Unit of the
  // main deck as a champion candidate for the per-game selector.
  if (!champions.length) {
    champions = (preview.maindeck || [])
      .filter((e) => e.chosen && e.candidates.find((c) => c.card_id === e.chosen)?.type === "Unit")
      .map((e) => e.chosen);
  }

  const deck = {
    legend: preview.legend?.find((e) => e.chosen)?.chosen || null,
    champions,
    battlefields: mapEntries(preview.battlefields),
    maindeck: mapEntries(preview.maindeck),
    runes: mapEntries(preview.runes),
    sideboard: mapEntries(preview.sideboard),
  };

  try {
    toast("Saving & downloading images…");
    await api(`/api/players/${id}/deck`, { method: "POST", body: { deck } });
    await reload();
    toast("Deck saved");
  } catch (err) {
    toast("Error: " + err.message, "err");
  }
}

// ---- Match ----------------------------------------------------------------

function renderMatch() {
  updateMatchMeta();
  syncCardAnimation();
  renderTally();
  renderScore();
  renderGameButtons();
  renderSelections();
  renderDisplay();
}

function playerName(id) {
  const p = player(id);
  return p?.pseudo || (id === "p1" ? "Player 1" : "Player 2");
}

function matchWinner() {
  const toWin = { bo1: 1, bo3: 2, bo5: 3 }[data.match.format] || 2;
  const s = data.match.score;
  if (s.p1 >= toWin) return "p1";
  if (s.p2 >= toWin) return "p2";
  return null;
}

function updateMatchMeta() {
  const sel = document.getElementById("match-format");
  if (sel) sel.value = data.match.format || "bo3";
  const note = document.getElementById("winner-note");
  const winner = matchWinner();
  if (note) note.textContent = winner ? `Match over — ${playerName(winner)} wins` : "";
}

function renderTally() {
  const el = document.getElementById("match-tally");
  if (!el) return;
  const s = data.match.score;
  el.innerHTML =
    `Games won: ${escapeHtml(playerName("p1"))} ` +
    `<span class="tally-score">${s.p1} – ${s.p2}</span> ` +
    `${escapeHtml(playerName("p2"))}` +
    `<span class="tally-fmt">(${(data.match.format || "bo3").toUpperCase()})</span>`;
}

async function winGame(pid) {
  await api("/api/match/win", { method: "POST", body: { player: pid } });
  await reload();
  toast(`${playerName(pid)} wins the game`);
}

async function changeGameBy(delta) {
  const idx = clamp(data.match.currentGame + delta, 0, data.match.games.length - 1);
  if (idx === data.match.currentGame) return;
  await api("/api/match", { method: "POST", body: { currentGame: idx } });
  data.match.currentGame = idx;
  renderGameButtons();
  renderSelections();
  updateScoreValues();
}

async function toggleMatchup() {
  const showing = data.display?.mode === "matchup";
  await api(showing ? "/api/display/clear" : "/api/display/matchup", { method: "POST" });
  if (data.display) data.display.mode = showing ? "persistent" : "matchup";
  toast(showing ? "Matchup hidden" : "Matchup shown");
}

async function hidePlayerCard(pid) {
  await api("/api/display/clear", { method: "POST", body: { player: pid } });
  if (data.display?.cards) data.display.cards[pid] = null;
  const sel = document.querySelector(`[data-display="${pid}"]`);
  if (sel) sel.value = "";
  updateHideCardButtons();
  toast(`${playerName(pid)} card hidden`);
}

async function hideDisplay() {
  await api("/api/display/clear", { method: "POST" });
  if (data.display) {
    data.display.mode = "persistent";
    if (data.display.cards) {
      data.display.cards.p1 = null;
      data.display.cards.p2 = null;
    }
  }
  document.querySelectorAll("[data-display]").forEach((s) => (s.value = ""));
  updateHideCardButtons();
  toast("All cards hidden");
}

function updateHideCardButtons() {
  for (const id of ["p1", "p2"]) {
    const btn = document.querySelector(`[data-hide-card="${id}"]`);
    if (btn) btn.disabled = !data.display?.cards?.[id];
  }
}

function currentGameScore() {
  const g = data.match.games[data.match.currentGame];
  if (!g.score) g.score = { p1: 0, p2: 0 };
  return g.score;
}

function renderScore() {
  const row = document.getElementById("score-row");
  row.innerHTML = "";
  const gi = data.match.currentGame;
  const gscore = currentGameScore();
  for (const id of ["p1", "p2"]) {
    const el = document.createElement("div");
    el.className = "score-player";
    el.innerHTML = `
      <span class="name">${escapeHtml(playerName(id))}</span>
      <div class="stepper">
        <button data-score-dec="${id}">−</button>
        <span class="val">${gscore[id]}</span>
        <button data-score-inc="${id}">+</button>
      </div>
      <button class="win-btn" data-win="${id}">Win game</button>`;
    row.appendChild(el);
  }
  const label = document.createElement("span");
  label.className = "inline-lbl";
  label.textContent = `Points · Game ${gi + 1}`;
  row.appendChild(label);
  row.querySelectorAll("[data-score-inc]").forEach((b) =>
    b.addEventListener("click", () => changeScore(b.dataset.scoreInc, 1))
  );
  row.querySelectorAll("[data-score-dec]").forEach((b) =>
    b.addEventListener("click", () => changeScore(b.dataset.scoreDec, -1))
  );
  row.querySelectorAll("[data-win]").forEach((b) =>
    b.addEventListener("click", () => winGame(b.dataset.win))
  );
}

async function changeScore(id, delta) {
  const next = Math.max(0, currentGameScore()[id] + delta);
  currentGameScore()[id] = next;
  updateScoreValues();
  await api("/api/match", { method: "POST", body: { score: { [id]: next } } });
}

// Update the point values / label in place without rebuilding the row, so the
// stepper buttons never get detached mid-click (e.g. by a live WS update).
function updateScoreValues() {
  const row = document.getElementById("score-row");
  if (!row) return;
  const vals = row.querySelectorAll(".score-player .val");
  if (!vals.length) return renderScore();
  const gscore = currentGameScore();
  ["p1", "p2"].forEach((id, i) => {
    if (vals[i]) vals[i].textContent = gscore[id];
  });
  const label = row.querySelector(".inline-lbl");
  if (label) label.textContent = `Points · Game ${data.match.currentGame + 1}`;
}

function renderGameButtons() {
  const wrap = document.getElementById("game-buttons");
  wrap.innerHTML = "";
  data.match.games.forEach((_, idx) => {
    const b = document.createElement("button");
    b.textContent = `Game ${idx + 1}`;
    if (idx === data.match.currentGame) b.classList.add("active");
    b.addEventListener("click", async () => {
      await api("/api/match", { method: "POST", body: { currentGame: idx } });
      data.match.currentGame = idx;
      renderGameButtons();
      renderSelections();
      updateScoreValues();
    });
    wrap.appendChild(b);
  });
}

function renderSelections() {
  const grid = document.getElementById("selection-grid");
  grid.innerHTML = "";
  const gi = data.match.currentGame;
  const game = data.match.games[gi];

  for (const id of ["p1", "p2"]) {
    const p = player(id);
    const block = document.createElement("div");
    block.className = "card-block";

    const bfOptions = optionList(
      p.deck.battlefields.map((e) => e.id),
      game.battlefield[id]
    );
    const champOptions = optionList(p.deck.champions || [], game.champion[id]);

    block.innerHTML = `
      <h2>${escapeHtml(playerName(id))} — Game ${gi + 1}</h2>
      <div class="field">
        <label>Battlefield</label>
        <select data-sel="${id}:battlefield">${bfOptions}</select>
      </div>
      <div class="field">
        <label>Champion Unit</label>
        <select data-sel="${id}:champion">${champOptions}</select>
      </div>`;
    grid.appendChild(block);
  }

  grid.querySelectorAll("[data-sel]").forEach((sel) => {
    sel.addEventListener("change", async () => {
      const [pid, slot] = sel.dataset.sel.split(":");
      await api("/api/match/selection", {
        method: "POST",
        body: { gameIndex: gi, player: pid, slot, cardId: sel.value || null },
      });
      data.match.games[gi][slot][pid] = sel.value || null;
      toast("Selection shown on screen");
    });
  });
}

function optionList(ids, current) {
  const empty = `<option value="">— none —</option>`;
  const opts = ids
    .map(
      (cid) =>
        `<option value="${cid}" ${cid === current ? "selected" : ""}>${escapeHtml(cardName(cid))}</option>`
    )
    .join("");
  return empty + opts;
}

function syncCardAnimation() {
  const sel = document.getElementById("card-animation");
  if (sel && data.display?.cardAnimation) sel.value = data.display.cardAnimation;
}

async function setCardAnimation(value) {
  await api("/api/display/animation", { method: "POST", body: { animation: value } });
  if (data.display) data.display.cardAnimation = value;
  toast("Animation: " + value);
}

function renderDisplay() {
  const grid = document.getElementById("display-grid");
  grid.innerHTML = "";
  for (const id of ["p1", "p2"]) {
    const p = player(id);
    const block = document.createElement("div");
    block.className = "field";

    const current = data.display?.cards?.[id] || "";
    const cards = p.displayCards || [];
    const groupOrder = ["Legend", "Champion", "Main deck", "Side deck"];
    const byGroup = new Map();
    for (const c of cards) {
      if (!byGroup.has(c.group)) byGroup.set(c.group, []);
      byGroup.get(c.group).push(c);
    }
    const optgroups = groupOrder
      .filter((g) => byGroup.has(g))
      .map(
        (label) =>
          `<optgroup label="${label}">${byGroup
            .get(label)
            .map(
              (c) =>
                `<option value="${c.id}" ${c.id === current ? "selected" : ""}>${escapeHtml(c.label || cardName(c.id))}</option>`
            )
            .join("")}</optgroup>`
      )
      .join("");

    block.innerHTML = `
      <label>${escapeHtml(playerName(id))} — show a card</label>
      <div class="display-row">
        <select data-display="${id}">
          <option value="">— choose a card —</option>
          ${optgroups}
        </select>
        <button type="button" class="btn ghost small" data-hide-card="${id}" ${current ? "" : "disabled"}>Hide card</button>
      </div>`;
    grid.appendChild(block);
  }

  grid.querySelectorAll("[data-display]").forEach((sel) => {
    sel.addEventListener("change", async () => {
      const pid = sel.dataset.display;
      await api("/api/display/card", {
        method: "POST",
        body: { player: pid, cardId: sel.value || null },
      });
      if (!data.display.cards) data.display.cards = { p1: null, p2: null };
      data.display.cards[pid] = sel.value || null;
      updateHideCardButtons();
      if (sel.value) toast("Card shown: " + cardName(sel.value));
      else toast("Card hidden");
    });
  });

  grid.querySelectorAll("[data-hide-card]").forEach((btn) => {
    btn.addEventListener("click", () => hidePlayerCard(btn.dataset.hideCard));
  });
}

document.getElementById("hide-card").addEventListener("click", hideDisplay);
document.getElementById("show-matchup").addEventListener("click", toggleMatchup);

// ---- Stream Deck (native HID) ---------------------------------------------

async function renderStreamDeck() {
  const badge = document.getElementById("sd-hid-status");
  const detail = document.getElementById("sd-hid-detail");
  const hint = document.getElementById("sd-hid-hint");
  const deckStatus = document.getElementById("sd-deck-status");
  if (!badge) return;

  try {
    const res = await fetch("/api/streamdeck");
    const info = await res.json();

    if (!info.supported) {
      badge.textContent = "Windows desktop app only";
      badge.className = "sd-status-badge sd-status-warn";
      detail.textContent =
        "Native Stream Deck control runs inside Riftbound OBS on Windows. Use the HTTP hot URLs on macOS or in dev mode.";
      if (hint) hint.textContent = "";
    } else if (info.connected) {
      badge.textContent = `Connected — ${info.productName || "Stream Deck"}`;
      badge.className = "sd-status-badge sd-status-ok";
      const parts = [];
      if (info.pageCount) {
        parts.push(`Page ${(info.currentPage ?? 0) + 1} / ${info.pageCount}`);
      }
      if (info.pageNames?.length) {
        const name = info.pageNames[info.currentPage ?? 0];
        if (name) parts.push(name);
      }
      if (info.firmwareVersion) parts.push(`FW ${info.firmwareVersion}`);
      detail.textContent = parts.join(" · ");
      if (hint) hint.textContent = info.hint || "";
    } else if (info.error) {
      badge.textContent = "Error";
      badge.className = "sd-status-badge sd-status-err";
      detail.textContent = info.error;
      if (hint) {
        hint.textContent =
          info.hint || "Quit the Elgato Stream Deck app completely, then click Reconnect.";
      }
    } else {
      badge.textContent = "Not detected";
      badge.className = "sd-status-badge sd-status-warn";
      detail.textContent = "Plug in your Stream Deck and keep Riftbound OBS running.";
      if (hint) hint.textContent = info.hint || "";
    }

    if (deckStatus && data) {
      const counts = ["p1", "p2"].map((id) => {
        const p = player(id);
        const n = p.displayCards?.length ?? 0;
        return `${playerName(id)}: ${n} cards`;
      });
      deckStatus.textContent = `Deck keys — ${counts.join(" · ")}. Keys refresh automatically after deck changes.`;
    }
  } catch (err) {
    badge.textContent = "Unavailable";
    badge.className = "sd-status-badge sd-status-err";
    if (detail) detail.textContent = err.message;
  }
}

const sdReconnect = document.getElementById("sd-reconnect");
if (sdReconnect) {
  sdReconnect.addEventListener("click", async () => {
    sdReconnect.disabled = true;
    const prev = sdReconnect.textContent;
    sdReconnect.textContent = "Reconnecting…";
    try {
      const res = await fetch("/api/streamdeck/reconnect", { method: "POST" });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || res.statusText || "Reconnect failed");
      toast(body.connected ? "Stream Deck connected" : "Stream Deck not detected");
      await renderStreamDeck();
    } catch (err) {
      toast("Reconnect failed: " + err.message, "err");
      await renderStreamDeck();
    } finally {
      sdReconnect.disabled = false;
      sdReconnect.textContent = prev;
    }
  });
}

document.getElementById("card-animation").addEventListener("change", (e) => {
  setCardAnimation(e.target.value).catch((err) => toast("Error: " + err.message, "err"));
});

document.getElementById("match-format").addEventListener("change", async (e) => {
  await api("/api/match/format", { method: "POST", body: { format: e.target.value } });
  await reload();
  toast("Format: " + e.target.value.toUpperCase());
});

// Keyboard shortcuts (ignored while typing in a field).
document.addEventListener("keydown", (e) => {
  const tag = (e.target.tagName || "").toLowerCase();
  if (tag === "input" || tag === "textarea" || tag === "select" || e.target.isContentEditable) return;
  if (e.metaKey || e.ctrlKey || e.altKey) return;
  const key = e.key.toLowerCase();
  const actions = {
    arrowleft: () => changeGameBy(-1),
    arrowright: () => changeGameBy(1),
    a: () => winGame("p1"),
    p: () => winGame("p2"),
    m: () => toggleMatchup(),
    h: () => hideDisplay(),
    escape: () => hideDisplay(),
  };
  const fn = actions[key];
  if (fn) {
    e.preventDefault();
    fn();
  }
});

document.getElementById("reset-match").addEventListener("click", async () => {
  if (!confirm("Reset the match? Points, games won, current game and battlefield/champion selections will be cleared (decks and names are kept).")) {
    return;
  }
  try {
    await api("/api/match/reset", { method: "POST" });
    await reload();
    toast("Match reset");
  } catch (err) {
    toast("Error: " + err.message, "err");
  }
});

// ---- Layout editor --------------------------------------------------------

const stage = document.getElementById("layout-stage");
let layoutPersistTimer = null;
let layoutLiveTimer = null;
let layoutDragging = 0;

function layoutHandlesEl() {
  return document.getElementById("layout-handles");
}

function ensureLayoutStage() {
  if (!document.getElementById("layout-live-overlay")) {
    stage.innerHTML = "";
    const iframe = document.createElement("iframe");
    iframe.id = "layout-live-overlay";
    iframe.className = "layout-live-overlay";
    iframe.src = "/overlay/";
    iframe.title = "Live overlay preview";
    const handles = document.createElement("div");
    handles.id = "layout-handles";
    handles.className = "layout-handles";
    stage.appendChild(iframe);
    stage.appendChild(handles);
  }
  return layoutHandlesEl();
}

function slotSelector(slotId) {
  return `.lslot[data-slot="${cssEscape(slotId)}"]`;
}

function renderLayoutCss() {
  const out = document.getElementById("layout-css-out");
  if (out && data?.layout) out.textContent = layoutToCss(data.layout);
}

function pushLayoutLive(slotId) {
  if (!data?.layout?.[slotId]) return;
  renderLayoutCss();
  clearTimeout(layoutLiveTimer);
  layoutLiveTimer = setTimeout(() => {
    api("/api/layout/live", {
      method: "POST",
      body: { slot: slotId, props: data.layout[slotId] },
    }).catch(() => {});
  }, 32);
}

function queueLayoutPersist(slotId) {
  clearTimeout(layoutPersistTimer);
  layoutPersistTimer = setTimeout(() => persistLayout(slotId), 450);
}

async function persistLayout(slotId) {
  try {
    await api("/api/layout", {
      method: "POST",
      body: { slot: slotId, props: data.layout[slotId] },
    });
  } catch (err) {
    toast("Layout error: " + err.message, "err");
  }
}

function applyLayoutChange(slotId) {
  const handles = layoutHandlesEl();
  const el = handles?.querySelector(slotSelector(slotId));
  if (el) positionSlot(el, data.layout[slotId]);
  pushLayoutLive(slotId);
  queueLayoutPersist(slotId);
}

function buildLayoutEditor() {
  const handles = ensureLayoutStage();
  handles.innerHTML = "";
  data.layout = normalizeLayout(data.layout);
  for (const [slotId, cfg] of Object.entries(data.layout)) {
    const el = document.createElement("div");
    const fc = frameClass(slotId);
    el.className = `lslot${fc ? ` lslot-frame ${fc}` : " lslot-text"}${slotId === "playArea" ? " lslot-play" : ""}`;
    el.dataset.slot = slotId;
    el.innerHTML = `<span>${SLOT_LABELS[slotId] || slotId}</span><div class="handle"></div>`;
    positionSlot(el, cfg);
    attachDrag(el, slotId);
    handles.appendChild(el);
  }
  renderProps();
  renderLayoutCss();
}

function positionSlot(el, cfg) {
  el.style.left = `${cfg.x}%`;
  el.style.top = `${cfg.y}%`;
  el.style.width = `${cfg.width}%`;
  el.style.height = `${cfg.height}%`;
  el.style.display = cfg.visible === false ? "none" : "flex";
}

function syncLayoutFromData() {
  const handles = layoutHandlesEl();
  if (!handles?.children.length) {
    buildLayoutEditor();
    return;
  }
  for (const el of handles.children) {
    const cfg = data.layout[el.dataset.slot];
    if (cfg) positionSlot(el, cfg);
  }
  renderLayoutCss();
}

function attachDrag(el, slotId) {
  const handle = el.querySelector(".handle");

  el.addEventListener("pointerdown", (e) => {
    if (e.target === handle) return;
    selectSlot(slotId);
    const rect = stage.getBoundingClientRect();
    const cfg = data.layout[slotId];
    const startX = e.clientX;
    const startY = e.clientY;
    const origX = cfg.x;
    const origY = cfg.y;
    el.setPointerCapture(e.pointerId);
    layoutDragging += 1;

    const move = (ev) => {
      const dx = ((ev.clientX - startX) / rect.width) * 100;
      const dy = ((ev.clientY - startY) / rect.height) * 100;
      cfg.x = clamp(origX + dx, 0, 100 - cfg.width);
      cfg.y = clamp(origY + dy, 0, 100 - cfg.height);
      positionSlot(el, cfg);
      renderProps();
      pushLayoutLive(slotId);
    };
    const up = () => {
      el.removeEventListener("pointermove", move);
      el.removeEventListener("pointerup", up);
      layoutDragging = Math.max(0, layoutDragging - 1);
      clearTimeout(layoutLiveTimer);
      pushLayoutLive(slotId);
      clearTimeout(layoutPersistTimer);
      persistLayout(slotId);
    };
    el.addEventListener("pointermove", move);
    el.addEventListener("pointerup", up);
  });

  handle.addEventListener("pointerdown", (e) => {
    e.stopPropagation();
    selectSlot(slotId);
    const rect = stage.getBoundingClientRect();
    const cfg = data.layout[slotId];
    const startX = e.clientX;
    const startY = e.clientY;
    const origW = cfg.width;
    const origH = cfg.height;
    const ratio = SLOT_RATIO[slotId];
    handle.setPointerCapture(e.pointerId);
    layoutDragging += 1;

    const move = (ev) => {
      const dw = ((ev.clientX - startX) / rect.width) * 100;
      let w = clamp(origW + dw, 2, 100 - cfg.x);
      let h;
      if (ratio) {
        h = heightForWidth(ratio, w);
        if (cfg.y + h > 100) {
          h = 100 - cfg.y;
          w = widthForHeight(ratio, h);
        }
      } else {
        const dh = ((ev.clientY - startY) / rect.height) * 100;
        h = clamp(origH + dh, 2, 100 - cfg.y);
      }
      cfg.width = w;
      cfg.height = h;
      Object.assign(cfg, normalizeLayoutSlot(slotId, cfg));
      positionSlot(el, cfg);
      renderProps();
      pushLayoutLive(slotId);
    };
    const up = () => {
      handle.removeEventListener("pointermove", move);
      handle.removeEventListener("pointerup", up);
      layoutDragging = Math.max(0, layoutDragging - 1);
      clearTimeout(layoutLiveTimer);
      pushLayoutLive(slotId);
      clearTimeout(layoutPersistTimer);
      persistLayout(slotId);
    };
    handle.addEventListener("pointermove", move);
    handle.addEventListener("pointerup", up);
  });
}

function selectSlot(slotId) {
  selectedSlot = slotId;
  layoutHandlesEl()?.querySelectorAll(".lslot").forEach((el) =>
    el.classList.toggle("selected", el.dataset.slot === slotId)
  );
  renderProps();
}

function renderProps() {
  const body = document.getElementById("layout-props-body");
  if (!selectedSlot) {
    body.innerHTML = `<p class="hint">Select a block to edit it.</p>`;
    return;
  }
  const cfg = data.layout[selectedSlot];
  const isText = TEXT_SLOTS.has(selectedSlot);

  body.innerHTML = `
    <p class="hint">${SLOT_LABELS[selectedSlot] || selectedSlot}</p>
    <div class="prop-grid">
      <div><label>X %</label><input type="number" step="0.5" data-prop="x" value="${round(cfg.x)}" /></div>
      <div><label>Y %</label><input type="number" step="0.5" data-prop="y" value="${round(cfg.y)}" /></div>
      <div><label>Width %</label><input type="number" step="0.5" data-prop="width" value="${round(cfg.width)}" /></div>
      <div><label>Height %</label><input type="number" step="0.5" data-prop="height" value="${round(cfg.height)}" /></div>
      ${
        isText
          ? `<div><label>Font (vh)</label><input type="number" step="0.1" data-prop="fontSize" value="${cfg.fontSize ?? 3}" /></div>
             <div><label>Color</label><input type="text" data-prop="color" value="${cfg.color ?? "#ffffff"}" /></div>
             <div class="full"><label>Alignment</label>
               <select data-prop="align">
                 <option value="left" ${cfg.align === "left" ? "selected" : ""}>Left</option>
                 <option value="center" ${cfg.align === "center" ? "selected" : ""}>Center</option>
                 <option value="right" ${cfg.align === "right" ? "selected" : ""}>Right</option>
               </select></div>`
          : ""
      }
      <div class="full">
        <label><input type="checkbox" data-prop="visible" ${cfg.visible !== false ? "checked" : ""} /> Visible</label>
      </div>
    </div>`;

  body.querySelectorAll("[data-prop]").forEach((input) => {
    const onEdit = () => {
      const key = input.dataset.prop;
      let value;
      if (input.type === "checkbox") value = input.checked;
      else if (input.type === "number") value = parseFloat(input.value);
      else value = input.value;
      if (input.type === "number" && Number.isNaN(value)) return;
      cfg[key] = value;
      if (SLOT_RATIO[selectedSlot]) {
        Object.assign(cfg, normalizeLayoutSlot(selectedSlot, cfg));
      }
      const el = layoutHandlesEl()?.querySelector(slotSelector(selectedSlot));
      if (el) positionSlot(el, cfg);
      applyLayoutChange(selectedSlot);
      if (SLOT_RATIO[selectedSlot] && (key === "width" || key === "height")) renderProps();
    };
    input.addEventListener(input.type === "checkbox" || input.tagName === "SELECT" ? "change" : "input", onEdit);
  });
}

document.getElementById("save-layout").addEventListener("click", async () => {
  try {
    clearTimeout(layoutPersistTimer);
    await api("/api/layout", { method: "POST", body: { layout: data.layout } });
    renderLayoutCss();
    toast("Layout saved");
  } catch (err) {
    toast("Error: " + err.message, "err");
  }
});

document.getElementById("reset-layout").addEventListener("click", async () => {
  await api("/api/layout/reset", { method: "POST" });
  await reload();
  buildLayoutEditor();
  toast("Layout reset");
});

// ---- utils ----------------------------------------------------------------

function clamp(v, min, max) {
  return Math.max(min, Math.min(max, v));
}
function escapeHtml(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
function escapeAttr(s) {
  return escapeHtml(s);
}
function cssEscape(s) {
  return s.replace(/([.:])/g, "\\$1");
}

// ---- boot -----------------------------------------------------------------

// Live updates: refresh score/game display if changed elsewhere (e.g. Companion).
connectState((state) => {
  if (!data) return;
  data.match.score = state.match.score; // games won
  data.match.currentGame = state.match.currentGame;
  const g = data.match.games[state.match.currentGame];
  if (g && state.game?.score) g.score = { p1: state.game.score.p1, p2: state.game.score.p2 };
  data.display = data.display || {};
  data.display.mode = state.display.mode;
  if (state.display.cardAnimation) data.display.cardAnimation = state.display.cardAnimation;
  syncCardAnimation();
  if (state.layout && !layoutDragging) {
    data.layout = normalizeLayout(state.layout);
    syncLayoutFromData();
    if (selectedSlot) renderProps();
  }
  if (state.display?.cards) {
    data.display = data.display || {};
    data.display.cards = {
      p1: state.display.cards.p1?.id ?? null,
      p2: state.display.cards.p2?.id ?? null,
    };
    updateHideCardButtons();
  }
  const matchTab = document.getElementById("tab-match");
  if (matchTab && matchTab.classList.contains("active")) {
    updateMatchMeta();
    renderTally();
    updateScoreValues();
    renderGameButtons();
  }
});

reload()
  .then(() => buildLayoutEditor())
  .catch((err) => toast("Failed to load: " + err.message, "err"));

// ---- In-app updates (Windows portable / installer) ------------------------

const updateBanner = document.getElementById("update-banner");
const updateTitle = document.getElementById("update-banner-title");
const updateDetail = document.getElementById("update-banner-detail");
const updateNotes = document.getElementById("update-banner-notes");
const updateDownloadBtn = document.getElementById("update-download");
const updateApplyBtn = document.getElementById("update-apply");
const updateDismissBtn = document.getElementById("update-dismiss");
const updateCheckBtn = document.getElementById("update-check");
const updateProgressWrap = document.getElementById("update-progress-wrap");
const updateProgressBar = document.getElementById("update-progress-bar");
const appVersionEl = document.getElementById("app-version");

const UPDATE_RECHECK_MS = 6 * 60 * 60 * 1000;
let updateState = null;
let updateDismissedVersion = null;

function formatUpdateSize(state) {
  if (state.updateMode === "installer" && state.installer?.size) {
    const mb = Math.round(state.installer.size / (1024 * 1024));
    return `~${mb} MB (full installer)`;
  }
  return "~1 MB (light patch)";
}

function setUpdateProgress(percent) {
  if (!updateProgressWrap || !updateProgressBar) return;
  if (percent == null) {
    updateProgressWrap.classList.add("hidden");
    updateProgressBar.style.width = "0%";
    return;
  }
  updateProgressWrap.classList.remove("hidden");
  updateProgressBar.style.width = `${Math.max(0, Math.min(100, percent))}%`;
}

function setUpdateUi(state) {
  updateState = state;
  if (appVersionEl && state?.currentVersion) {
    appVersionEl.textContent = `v${state.currentVersion}`;
  }
  if (updateCheckBtn) {
    updateCheckBtn.classList.toggle("hidden", !state?.supported);
  }
  if (!updateBanner) return;

  if (!state?.supported) {
    updateBanner.classList.add("hidden");
    return;
  }

  if (state.error && !state.updateAvailable && !state.downloaded?.ready) {
    updateBanner.classList.remove("hidden");
    updateTitle.textContent = "Update check failed";
    updateDetail.textContent = state.error;
    updateNotes.classList.add("hidden");
    updateDownloadBtn.disabled = true;
    updateApplyBtn.disabled = true;
    setUpdateProgress(null);
    return;
  }

  const showBanner =
    (state.updateAvailable || state.downloaded?.ready) &&
    updateDismissedVersion !== (state.downloaded?.version || state.latestVersion);

  if (!showBanner) {
    updateBanner.classList.add("hidden");
    setUpdateProgress(null);
    return;
  }

  updateBanner.classList.remove("hidden");

  if (state.installType === "portable" && state.installer) {
    updateNotes.textContent =
      "Tip: the Windows installer is recommended for more reliable updates. Download it from GitHub Releases when convenient.";
    updateNotes.classList.remove("hidden");
  }

  if (state.downloaded?.ready) {
    const modeLabel = state.downloaded.mode === "installer" ? "full installer" : "patch";
    updateTitle.textContent = `Update v${state.downloaded.version} ready`;
    updateDetail.textContent = `${modeLabel} downloaded. Click Install & restart.`;
    updateDownloadBtn.disabled = true;
    updateApplyBtn.disabled = false;
    setUpdateProgress(null);
  } else if (state.updateAvailable) {
    const modeLabel = state.updateMode === "installer" ? "Full update" : "Patch update";
    updateTitle.textContent = `${modeLabel}: v${state.latestVersion} available`;
    updateDetail.textContent = `You are on v${state.currentVersion}. Download size ${formatUpdateSize(state)}.`;
    updateDownloadBtn.disabled = false;
    updateApplyBtn.disabled = true;
    setUpdateProgress(null);
  }

  if (state.notes?.trim() && state.installType !== "portable") {
    updateNotes.textContent = state.notes.trim();
    updateNotes.classList.remove("hidden");
  } else if (!state.installType || state.installType !== "portable") {
    updateNotes.classList.add("hidden");
  }
}

async function checkUpdates() {
  try {
    const state = await api("/api/update/check");
    setUpdateUi(state);
    return state;
  } catch (err) {
    if (updateBanner) {
      updateBanner.classList.remove("hidden");
      updateTitle.textContent = "Update check failed";
      updateDetail.textContent = err.message;
      updateDownloadBtn.disabled = true;
      updateApplyBtn.disabled = true;
    }
    if (appVersionEl) {
      try {
        const v = await api("/api/version");
        appVersionEl.textContent = v.version ? `v${v.version}` : "";
      } catch {
        /* ignore */
      }
    }
    return null;
  }
}

async function pollDownloadProgress() {
  for (let i = 0; i < 120; i++) {
    await new Promise((resolve) => setTimeout(resolve, 500));
    try {
      const p = await api("/api/update/progress");
      if (p.status === "downloading") {
        const label = p.percent != null ? `${p.percent}%` : "…";
        updateDetail.textContent = `Downloading… ${label}`;
        setUpdateProgress(p.percent ?? (p.total ? Math.round((p.received / p.total) * 100) : 50));
      }
      if (p.status === "complete") {
        setUpdateProgress(100);
        return;
      }
    } catch {
      /* server may still be finishing */
    }
  }
}

updateDownloadBtn?.addEventListener("click", async () => {
  updateDownloadBtn.disabled = true;
  updateDetail.textContent = "Downloading…";
  setUpdateProgress(0);
  const progressPoll = pollDownloadProgress();
  try {
    await api("/api/update/download", { method: "POST" });
    await progressPoll;
    toast("Update downloaded", "ok");
    await checkUpdates();
  } catch (err) {
    toast(err.message, "err");
    updateDownloadBtn.disabled = false;
    setUpdateProgress(null);
    await checkUpdates();
  }
});

function compareSemverClient(a, b) {
  const pa = String(a).split(".").map((n) => parseInt(n, 10) || 0);
  const pb = String(b).split(".").map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < 3; i++) {
    const da = pa[i] || 0;
    const db = pb[i] || 0;
    if (da > db) return 1;
    if (da < db) return -1;
  }
  return 0;
}

async function pollAfterUpdate(expectedVersion) {
  const maxAttempts = 45;
  for (let i = 0; i < maxAttempts; i++) {
    await new Promise((resolve) => setTimeout(resolve, 2000));
    try {
      const res = await fetch("/api/version", { cache: "no-store" });
      if (!res.ok) continue;
      const info = await res.json();
      if (expectedVersion && compareSemverClient(info.version, expectedVersion) < 0) {
        updateDetail.textContent = `Restarting… waiting for v${expectedVersion} (${i + 1}/${maxAttempts})`;
        continue;
      }
      updateDetail.textContent = info.version
        ? `Updated to v${info.version}. Reloading…`
        : "Update complete. Reloading…";
      setTimeout(() => location.reload(), 800);
      return;
    } catch {
      updateDetail.textContent = `Restarting… (${i + 1}/${maxAttempts})`;
    }
  }
  updateDetail.textContent =
    "Server did not restart. Launch Riftbound OBS manually, or check %APPDATA%\\RiftboundOBS\\updates\\update.log";
  updateApplyBtn.disabled = false;
}

updateApplyBtn?.addEventListener("click", async () => {
  if (!confirm("Install the update and restart the app? The control panel will close briefly.")) return;
  updateApplyBtn.disabled = true;
  updateDetail.textContent = "Installing…";
  try {
    const expectedVersion = updateState?.downloaded?.version || updateState?.latestVersion;
    const result = await api("/api/update/apply", {
      method: "POST",
      body: { applyToken: updateState?.applyToken },
    });
    updateDetail.textContent = "Restarting…";
    pollAfterUpdate(result.expectedVersion || expectedVersion);
  } catch (err) {
    toast(err.message, "err");
    updateApplyBtn.disabled = false;
    await checkUpdates();
  }
});

updateDismissBtn?.addEventListener("click", () => {
  updateDismissedVersion = updateState?.downloaded?.version || updateState?.latestVersion;
  updateBanner?.classList.add("hidden");
});

updateCheckBtn?.addEventListener("click", async () => {
  updateCheckBtn.disabled = true;
  await checkUpdates();
  updateCheckBtn.disabled = false;
});

checkUpdates();
setInterval(() => {
  if (document.visibilityState === "visible") checkUpdates();
}, UPDATE_RECHECK_MS);
