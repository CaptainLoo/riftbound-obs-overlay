/**
 * Match tab: score, games, battlefield/champion selections, on-screen display.
 *
 * Rendering is split in two: `rebuild()` creates the DOM once per "structure
 * key" (format, game count, deck contents); `update()` only writes values into
 * existing nodes, so steppers and selects are never replaced mid-interaction and
 * WebSocket patches are cheap to apply.
 */
import { api } from "./api.js";
import { h, onAction, setText, setValue } from "./dom.js";
import { playerName } from "./players.js";
import { getData } from "./store.js";
import { toast } from "./toast.js";
import { clamp } from "./utils.js";

const PLAYER_IDS = ["p1", "p2"];
const GROUP_ORDER = ["Legend", "Champion", "Main deck", "Side deck"];
let structureKey = null;

const data = () => getData();
const $ = (id) => document.getElementById(id);

function cardName(id) {
  if (!id) return "";
  return data()?.cardsCache?.[id]?.name || id;
}

function player(id) {
  return data().players.find((p) => p.id === id);
}

function currentGame() {
  const m = data().match;
  const g = m.games[m.currentGame];
  if (g && !g.score) g.score = { p1: 0, p2: 0 };
  return g;
}

function toWin() {
  return { bo1: 1, bo3: 2, bo5: 3 }[data().match.format] || 2;
}

function matchWinner() {
  const s = data().match.score;
  if (s.p1 >= toWin()) return "p1";
  if (s.p2 >= toWin()) return "p2";
  return null;
}

function deckSignature(p) {
  const d = p.deck || {};
  return [
    (d.battlefields || []).map((e) => e.id).join(","),
    (d.champions || []).join(","),
    (p.displayCards || []).map((c) => `${c.id}:${c.label}`).join(","),
  ].join("|");
}

function computeStructureKey() {
  const m = data().match;
  return [m.format, m.games.length, ...PLAYER_IDS.map((id) => deckSignature(player(id)))].join("#");
}

// ---- builders (run on structure change only) -----------------------------

function buildScoreRow() {
  const row = $("score-row");
  row.replaceChildren(
    ...PLAYER_IDS.map((id) =>
      h(
        "div",
        { class: "score-player", dataset: { player: id } },
        h("span", { class: "name", dataset: { role: "name" } }),
        h(
          "div",
          { class: "stepper" },
          h("button", { type: "button", "aria-label": "Minus one point", dataset: { action: "score-dec", player: id } }, "−"),
          h("output", { class: "val", dataset: { role: "val" } }, "0"),
          h("button", { type: "button", "aria-label": "Plus one point", dataset: { action: "score-inc", player: id } }, "+")
        ),
        h("button", { type: "button", class: "btn win-btn", dataset: { action: "win", player: id } }, "Win game")
      )
    )
  );
}

function buildGameButtons() {
  const wrap = $("game-buttons");
  wrap.replaceChildren(
    ...data().match.games.map((_, idx) =>
      h("button", { type: "button", class: "seg", dataset: { action: "game", index: String(idx) } }, `Game ${idx + 1}`)
    )
  );
}

function optionList(ids, placeholder = "— none —") {
  return [h("option", { value: "" }, placeholder), ...ids.map((cid) => h("option", { value: cid }, cardName(cid)))];
}

function buildSelections() {
  const grid = $("selection-grid");
  grid.replaceChildren(
    ...PLAYER_IDS.map((id) => {
      const p = player(id);
      return h(
        "section",
        { class: "card-block selection-block", dataset: { player: id } },
        h("div", { class: "block-head" }, h("h2", { dataset: { role: "title" } }), h("span", { class: "chip chip-muted", dataset: { role: "game" } })),
        h(
          "div",
          { class: "field" },
          h("label", { for: `sel-${id}-battlefield` }, "Battlefield"),
          h("select", { id: `sel-${id}-battlefield`, dataset: { action: "sel", player: id, slot: "battlefield" } }, ...optionList(p.deck.battlefields.map((e) => e.id)))
        ),
        h(
          "div",
          { class: "field" },
          h("label", { for: `sel-${id}-champion` }, "Champion Unit"),
          h("select", { id: `sel-${id}-champion`, dataset: { action: "sel", player: id, slot: "champion" } }, ...optionList(p.deck.champions || []))
        )
      );
    })
  );
}

function buildDisplayOptgroups(cards) {
  const byGroup = new Map();
  for (const c of cards) {
    if (!byGroup.has(c.group)) byGroup.set(c.group, []);
    byGroup.get(c.group).push(c);
  }
  const ordered = [...GROUP_ORDER.filter((g) => byGroup.has(g)), ...[...byGroup.keys()].filter((g) => !GROUP_ORDER.includes(g))];
  return ordered.map((label) =>
    h("optgroup", { label }, ...byGroup.get(label).map((c) => h("option", { value: c.id }, c.label || cardName(c.id))))
  );
}

function buildDisplay() {
  const grid = $("display-grid");
  grid.replaceChildren(
    ...PLAYER_IDS.map((id) => {
      const cards = player(id).displayCards || [];
      return h(
        "div",
        { class: "field display-field", dataset: { player: id } },
        h("label", { for: `display-${id}`, dataset: { role: "label" } }),
        h(
          "div",
          { class: "display-row" },
          h(
            "select",
            { id: `display-${id}`, dataset: { action: "display", player: id }, disabled: !cards.length },
            h("option", { value: "" }, cards.length ? "— choose a card —" : "No deck saved"),
            ...buildDisplayOptgroups(cards)
          ),
          h("button", { type: "button", class: "btn ghost", "aria-label": `Hide ${id === "p1" ? "player 1" : "player 2"} card`, dataset: { action: "hide-card", player: id } }, "Hide")
        )
      );
    })
  );
}

function rebuild() {
  buildScoreRow();
  buildGameButtons();
  buildSelections();
  buildDisplay();
}

// ---- value updates (run on every match/game/display patch) ---------------

function updateScoreValues() {
  const g = currentGame();
  for (const id of PLAYER_IDS) {
    const el = document.querySelector(`.score-player[data-player="${id}"]`);
    if (!el) continue;
    setText(el.querySelector('[data-role="name"]'), playerName(id));
    setText(el.querySelector('[data-role="val"]'), g?.score?.[id] ?? 0);
  }
  setText($("score-game-label"), `Game ${data().match.currentGame + 1}`);
}

function updateTally() {
  const m = data().match;
  setText($("tally-p1"), playerName("p1"));
  setText($("tally-p2"), playerName("p2"));
  setText($("tally-score"), `${m.score.p1} – ${m.score.p2}`);
  setText($("tally-fmt"), `${(m.format || "bo3").toUpperCase()} · first to ${toWin()}`);
  const winner = matchWinner();
  const note = $("winner-note");
  setText(note, winner ? `Match over — ${playerName(winner)} wins` : "");
  note?.classList.toggle("hidden", !winner);
  setValue($("match-format"), m.format || "bo3");
}

function updateGameButtons() {
  const cur = data().match.currentGame;
  $("game-buttons")
    ?.querySelectorAll("[data-index]")
    .forEach((b) => {
      const active = Number(b.dataset.index) === cur;
      b.classList.toggle("active", active);
      b.setAttribute("aria-pressed", String(active));
    });
}

function updateSelections() {
  const m = data().match;
  const game = m.games[m.currentGame];
  for (const id of PLAYER_IDS) {
    const block = document.querySelector(`.selection-block[data-player="${id}"]`);
    if (!block) continue;
    setText(block.querySelector('[data-role="title"]'), playerName(id));
    setText(block.querySelector('[data-role="game"]'), `Game ${m.currentGame + 1}`);
    setValue(block.querySelector('[data-slot="battlefield"]'), game?.battlefield?.[id] || "");
    setValue(block.querySelector('[data-slot="champion"]'), game?.champion?.[id] || "");
  }
}

function updateDisplay() {
  const d = data().display || {};
  for (const id of PLAYER_IDS) {
    const field = document.querySelector(`.display-field[data-player="${id}"]`);
    if (!field) continue;
    setText(field.querySelector('[data-role="label"]'), `${playerName(id)} — show a card`);
    const current = d.cards?.[id] || "";
    setValue(field.querySelector("select"), current);
    const hide = field.querySelector('[data-action="hide-card"]');
    if (hide) hide.disabled = !current;
  }
  setValue($("card-animation"), d.cardAnimation || "pop");
  const matchupBtn = $("show-matchup");
  if (matchupBtn) {
    const showing = d.mode === "matchup";
    setText(matchupBtn, showing ? "Hide matchup" : "Show matchup");
    matchupBtn.classList.toggle("active", showing);
  }
}

/** Full render: rebuilds only when the structure key changed, then updates values. */
export function renderMatch() {
  if (!data()) return;
  const key = computeStructureKey();
  if (key !== structureKey) {
    structureKey = key;
    rebuild();
  }
  updateScoreValues();
  updateTally();
  updateGameButtons();
  updateSelections();
  updateDisplay();
}

// ---- actions ---------------------------------------------------------------

export async function winGame(pid) {
  await api("/api/match/win", { method: "POST", body: { player: pid } });
  toast(`${playerName(pid)} wins the game`);
}

export async function changeGameBy(delta) {
  const m = data().match;
  const idx = clamp(m.currentGame + delta, 0, m.games.length - 1);
  if (idx === m.currentGame) return;
  await selectGame(idx);
}

async function selectGame(idx) {
  data().match.currentGame = idx;
  updateGameButtons();
  updateScoreValues();
  updateSelections();
  await api("/api/match", { method: "POST", body: { currentGame: idx } });
}

async function changeScore(id, delta) {
  const g = currentGame();
  const next = Math.max(0, (g.score[id] || 0) + delta);
  g.score[id] = next;
  updateScoreValues();
  await api("/api/match", { method: "POST", body: { score: { [id]: next } } });
}

export async function toggleMatchup() {
  const d = data().display || {};
  const showing = d.mode === "matchup";
  d.mode = showing ? "persistent" : "matchup";
  updateDisplay();
  await api(showing ? "/api/display/clear" : "/api/display/matchup", { method: "POST" });
  toast(showing ? "Matchup hidden" : "Matchup shown");
}

export async function hideDisplay() {
  const d = data().display || {};
  d.mode = "persistent";
  d.cards = { p1: null, p2: null };
  updateDisplay();
  await api("/api/display/clear", { method: "POST" });
  toast("All cards hidden");
}

async function hidePlayerCard(pid) {
  const d = data().display || {};
  if (d.cards) d.cards[pid] = null;
  updateDisplay();
  await api("/api/display/clear", { method: "POST", body: { player: pid } });
  toast(`${playerName(pid)} card hidden`);
}

export function initMatch() {
  onAction("click", "score-inc", (el) => changeScore(el.dataset.player, 1));
  onAction("click", "score-dec", (el) => changeScore(el.dataset.player, -1));
  onAction("click", "win", (el) => winGame(el.dataset.player));
  onAction("click", "game", (el) => selectGame(Number(el.dataset.index)));
  onAction("click", "hide-card", (el) => hidePlayerCard(el.dataset.player));
  onAction("click", "hide-all", () => hideDisplay());
  onAction("click", "show-matchup", () => toggleMatchup());
  onAction("click", "reset-match", async () => {
    if (!confirm("Reset the match? Points, games won, current game and battlefield/champion selections will be cleared (decks and names are kept).")) return;
    await api("/api/match/reset", { method: "POST" });
    toast("Match reset");
  });
  onAction("change", "match-format", async (el) => {
    await api("/api/match/format", { method: "POST", body: { format: el.value } });
    toast("Format: " + el.value.toUpperCase());
  });
  onAction("change", "card-animation", async (el) => {
    data().display.cardAnimation = el.value;
    await api("/api/display/animation", { method: "POST", body: { animation: el.value } });
    toast("Animation: " + el.value);
  });
  onAction("change", "sel", async (el) => {
    const { player: pid, slot } = el.dataset;
    const m = data().match;
    const game = m.games[m.currentGame];
    if (game) game[slot][pid] = el.value || null;
    await api("/api/match/selection", {
      method: "POST",
      body: { gameIndex: m.currentGame, player: pid, slot, cardId: el.value || null },
    });
    toast("Selection shown on screen");
  });
  onAction("change", "display", async (el) => {
    const pid = el.dataset.player;
    const d = data().display;
    if (!d.cards) d.cards = { p1: null, p2: null };
    d.cards[pid] = el.value || null;
    updateDisplay();
    await api("/api/display/card", { method: "POST", body: { player: pid, cardId: el.value || null } });
    toast(el.value ? "Card shown: " + cardName(el.value) : "Card hidden");
  });
}
