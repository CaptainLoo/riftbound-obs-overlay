/** Players & Decks tab: names, decklist import, preview, save. */
import { api } from "./api.js";
import { CATEGORY_LABELS } from "./constants.js";
import { h, onAction, setText, setValue } from "./dom.js";
import { getData, reloadData } from "./store.js";
import { toast } from "./toast.js";
import { escapeHtml } from "./utils.js";

const PLAYER_IDS = ["p1", "p2"];
const previews = { p1: null, p2: null };
const decklistText = { p1: "", p2: "" };
const decklistFormat = { p1: "sections", p2: "sections" };
const PLACEHOLDER =
  "Legend:\n1 Pyke, Bloodharbor Ripper\n\nChampion:\n1 Pyke, Dockside Butcher\n\nMainDeck:\n3 Falling Star\n3 Gust\n\nBattlefields:\n1 Void Gate\n\nRunes:\n6 Fury Rune\n\nSideboard:\n2 Acceptable Losses";

let built = false;

function player(id) {
  return getData().players.find((p) => p.id === id);
}

export function playerName(id) {
  const p = player(id);
  return p?.pseudo || (id === "p1" ? "Player 1" : "Player 2");
}

export function deckSummary(deck) {
  if (!deck) return "";
  const count = (a) => (a || []).reduce((s, e) => s + (e.quantity || 1), 0);
  const parts = [];
  if (deck.legend) parts.push("legend ✓");
  if (deck.champions?.length) parts.push(`${deck.champions.length} champion`);
  if (deck.maindeck?.length) parts.push(`${count(deck.maindeck)} main`);
  if (deck.battlefields?.length) parts.push(`${deck.battlefields.length} battlefields`);
  if (deck.runes?.length) parts.push(`${count(deck.runes)} runes`);
  if (deck.sideboard?.length) parts.push(`${count(deck.sideboard)} side`);
  return parts.length ? `Deck saved · ${parts.join(", ")}` : "";
}

function buildPlayerBlock(id) {
  const p = player(id);
  return h(
    "section",
    { class: "card-block player-block", dataset: { player: id } },
    h("div", { class: "block-head" }, h("h2", {}, id === "p1" ? "Player 1" : "Player 2"), h("span", { class: "chip", dataset: { role: "deckinfo" } })),
    h(
      "div",
      { class: "field" },
      h("label", { for: `pseudo-${id}` }, "Name"),
      h("input", { type: "text", id: `pseudo-${id}`, value: p.pseudo, placeholder: "Player name", dataset: { action: "pseudo", player: id }, autocomplete: "off" })
    ),
    h(
      "div",
      { class: "field" },
      h("label", { for: `deck-${id}` }, "Decklist"),
      h("textarea", { id: `deck-${id}`, placeholder: PLACEHOLDER, spellcheck: false, dataset: { action: "deck-text", player: id } }, decklistText[id])
    ),
    h(
      "div",
      { class: "row deck-actions" },
      h(
        "select",
        { class: "compact", title: "Import format", dataset: { action: "deck-format", player: id } },
        h("option", { value: "sections", selected: decklistFormat[id] === "sections" }, "Sectioned text"),
        h("option", { value: "tts", selected: decklistFormat[id] === "tts" }, "TTS / Piltover")
      ),
      h("button", { type: "button", class: "btn", dataset: { action: "analyze", player: id } }, "Analyze"),
      h("button", { type: "button", class: "btn primary", dataset: { action: "save", player: id } }, "Save deck")
    ),
    h("div", { class: "preview", dataset: { role: "preview" } }, h("p", { class: "empty" }, "Paste a decklist and click Analyze to resolve every card."))
  );
}

function blockEl(id) {
  return document.querySelector(`.player-block[data-player="${id}"]`);
}

export function renderPlayers() {
  const grid = document.getElementById("players-grid");
  if (!grid) return;
  if (!built) {
    grid.replaceChildren(...PLAYER_IDS.map(buildPlayerBlock));
    built = true;
  }
  for (const id of PLAYER_IDS) {
    const p = player(id);
    const block = blockEl(id);
    if (!block || !p) continue;
    setValue(block.querySelector(`[data-action="pseudo"]`), p.pseudo);
    const info = block.querySelector('[data-role="deckinfo"]');
    const summary = deckSummary(p.deck);
    setText(info, summary || "No deck saved");
    info.classList.toggle("chip-ok", Boolean(summary));
    info.classList.toggle("chip-muted", !summary);
    if (previews[id]) renderPreview(id);
  }
}

async function analyzeDeck(id) {
  const text = decklistText[id];
  if (!text.trim()) return toast("Paste a decklist first", "err");
  const btn = blockEl(id)?.querySelector('[data-action="analyze"]');
  if (btn) btn.disabled = true;
  try {
    toast("Analyzing…");
    previews[id] = await api("/api/decklist/preview", {
      method: "POST",
      body: { text, format: decklistFormat[id] },
    });
    renderPreview(id);
    const ambiguous = Object.values(previews[id]).flat().filter((e) => e.ambiguous).length;
    toast(ambiguous ? `Analysis done — ${ambiguous} card(s) to check` : "Analysis done", ambiguous ? "warn" : "ok");
  } catch (err) {
    toast("Analysis error: " + err.message, "err");
  } finally {
    if (btn) btn.disabled = false;
  }
}

function renderPreview(id) {
  const container = blockEl(id)?.querySelector('[data-role="preview"]');
  const preview = previews[id];
  if (!container) return;
  container.innerHTML = "";
  if (!preview) {
    container.append(h("p", { class: "empty" }, "Paste a decklist and click Analyze to resolve every card."));
    return;
  }

  const total = Object.values(preview).flat().length;
  const ambiguous = Object.values(preview).flat().filter((e) => e.ambiguous).length;
  container.append(
    h(
      "div",
      { class: "preview-summary" },
      h("strong", {}, `${total} lines`),
      ambiguous ? h("span", { class: "chip chip-warn" }, `${ambiguous} to check`) : h("span", { class: "chip chip-ok" }, "All resolved")
    )
  );

  for (const [cat, entries] of Object.entries(preview)) {
    if (!entries.length) continue;
    const wrap = h("div", { class: "preview-cat" }, h("h3", {}, CATEGORY_LABELS[cat] || cat));
    entries.forEach((entry, idx) => {
      const thumb = entry.chosen ? entry.candidates.find((c) => c.card_id === entry.chosen)?.thumbnail_url || "" : "";
      let control;
      if (entry.candidates.length) {
        control = h(
          "select",
          { dataset: { action: "pick", player: id, pick: `${cat}:${idx}` } },
          ...entry.candidates.map((c) =>
            h("option", { value: c.card_id, selected: c.card_id === entry.chosen }, `${c.name} · ${c.card_id}`)
          )
        );
      } else {
        control = h("span", { class: "unresolved" }, entry.error || `Not found: "${entry.name}"`);
      }
      wrap.append(
        h(
          "div",
          { class: `entry${entry.ambiguous ? " ambiguous" : ""}` },
          h("img", { src: thumb, alt: "", width: 32, height: 32, loading: "lazy" }),
          h("span", { class: "qty" }, `×${entry.quantity}`),
          control
        )
      );
    });
    container.append(wrap);
  }
}

async function saveDeck(id) {
  const preview = previews[id];
  if (!preview) return toast("Analyze the decklist first", "err");

  const mapEntries = (arr) =>
    (arr || [])
      .filter((e) => e.chosen)
      .map((e) => ({ id: e.chosen, quantity: e.quantity }));

  let champions = (preview.champions || []).filter((e) => e.chosen).map((e) => e.chosen);
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

  const btn = blockEl(id)?.querySelector('[data-action="save"]');
  if (btn) btn.disabled = true;
  try {
    toast("Saving deck…");
    const res = await api(`/api/players/${id}/deck`, { method: "POST", body: { deck } });
    // The server broadcasts a players patch (and another when background images land);
    // refresh now so the summary is right even before the first patch.
    await reloadData();
    renderPlayers();
    const pending = Number(res?.pendingImages) || 0;
    toast(pending ? `Deck saved — ${pending} card images still downloading` : "Deck saved");
  } catch (err) {
    toast("Error: " + err.message, "err");
  } finally {
    if (btn) btn.disabled = false;
  }
}

export function initPlayers() {
  onAction("change", "pseudo", async (el) => {
    await api(`/api/players/${el.dataset.player}/pseudo`, { method: "POST", body: { pseudo: el.value } });
    toast("Name saved");
  });
  onAction("input", "deck-text", (el) => {
    decklistText[el.dataset.player] = el.value;
  });
  onAction("change", "deck-format", (el) => {
    decklistFormat[el.dataset.player] = el.value;
  });
  onAction("click", "analyze", (el) => analyzeDeck(el.dataset.player));
  onAction("click", "save", (el) => saveDeck(el.dataset.player));
  onAction("change", "pick", (el) => {
    const id = el.dataset.player;
    const [cat, idx] = el.dataset.pick.split(":");
    const entry = previews[id]?.[cat]?.[Number(idx)];
    if (!entry) return;
    entry.chosen = el.value;
    const img = el.parentElement.querySelector("img");
    const cand = entry.candidates.find((c) => c.card_id === el.value);
    if (img && cand) img.src = cand.thumbnail_url || "";
  });
}
