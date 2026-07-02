import { connectState } from "/shared/ws.js";
import {
  frameClass,
  IMAGE_SLOTS,
  layoutToCss,
  normalizeLayout,
  updateSceneHoleMask,
  slotDomId,
} from "/shared/layout.js";

const stage = document.getElementById("stage");
const matchupEl = document.getElementById("matchup");
const layoutCssEl = document.getElementById("layout-runtime-css");
const sceneHoleEl = document.getElementById("scene-hole");

const CARD_SLOTS = new Set(["p1.card", "p2.card"]);
const HIDE_WHEN_EMPTY = new Set(["p1.card", "p2.card", "p1.battlefield", "p2.battlefield"]);
const ANIM_TYPES = ["none", "fade", "slide", "pop", "flip", "glow", "impact"];
const SCENE_MANAGED_TEXT = new Set(["score"]);
const cardAnimState = {};

const FRAME_LABELS = {
  "p1.legend": "Legend",
  "p2.legend": "Legend",
  "p1.battlefield": "Battlefield",
  "p2.battlefield": "Battlefield",
  "p1.card": "Card",
  "p2.card": "Card",
  playArea: "Camera",
};

const SLOT_DEFS = {
  "p1.pseudo": { kind: "text", get: (s) => s.players[0]?.pseudo },
  "p2.pseudo": { kind: "text", get: (s) => s.players[1]?.pseudo },
  score: { kind: "text", get: (s) => `${s.game.score.p1} - ${s.game.score.p2}` },
  playArea: { kind: "chrome", get: () => true },
  "match.tally": {
    kind: "tally",
    get: (s) => `${s.match.score.p1} – ${s.match.score.p2}`,
  },
  "p1.legend": {
    kind: "image",
    get: (s) => s.players[0]?.legend?.imageLocal || s.players[0]?.legend?.thumbLocal,
  },
  "p2.legend": {
    kind: "image",
    get: (s) => s.players[1]?.legend?.imageLocal || s.players[1]?.legend?.thumbLocal,
  },
  "p1.battlefield": { kind: "image", get: (s) => s.game.battlefield.p1?.thumbLocal },
  "p2.battlefield": { kind: "image", get: (s) => s.game.battlefield.p2?.thumbLocal },
  "p1.champion": { kind: "text", get: (s) => s.game.champion.p1?.name },
  "p2.champion": { kind: "text", get: (s) => s.game.champion.p2?.name },
  "p1.card": { kind: "image", get: (s) => s.display.cards?.p1?.imageLocal },
  "p2.card": { kind: "image", get: (s) => s.display.cards?.p2?.imageLocal },
};

const els = {};
let lastLayout = null;

function applyLayoutCss(layout) {
  if (layoutCssEl) layoutCssEl.textContent = layoutToCss(normalizeLayout(layout));
}

function applySceneCutout(layout) {
  const layers = document.querySelectorAll(".scene-layer");
  const active = updateSceneHoleMask(sceneHoleEl, layout?.playArea);
  layers.forEach((el) => {
    el.style.clipPath = "none";
    el.style.webkitClipPath = "none";
    if (active) {
      el.style.mask = "url(#scene-cutout-mask)";
      el.style.webkitMask = "url(#scene-cutout-mask)";
    } else {
      el.style.mask = "none";
      el.style.webkitMask = "none";
    }
  });
}

function ensureSlot(id, kind) {
  if (els[id]) return els[id];
  const el = document.createElement("div");
  const fc = frameClass(id);
  el.className = `slot slot-${kind}${fc ? ` ${fc}` : ""}`;
  el.id = slotDomId(id);

  if (kind === "image") {
    el.setAttribute("data-label", FRAME_LABELS[id] || "");
    const img = document.createElement("img");
    img.alt = "";
    el.appendChild(img);
    els[id] = { el, img };
  } else if (kind === "tally") {
    const inner = document.createElement("div");
    inner.className = "match-tally-inner";
    inner.innerHTML = `<span class="match-tally-label">Match · </span><strong class="match-tally-score"></strong>`;
    el.appendChild(inner);
    els[id] = { el, span: inner.querySelector(".match-tally-score") };
  } else if (kind === "chrome") {
    els[id] = { el };
  } else if (id === "p1.pseudo" || id === "p2.pseudo") {
    el.classList.add("slot-pseudo");
    const stack = document.createElement("div");
    stack.className = "pseudo-stack";
    const barTop = document.createElement("div");
    barTop.className = "pseudo-bar";
    barTop.setAttribute("aria-hidden", "true");
    const span = document.createElement("div");
    span.className = "slot-text";
    const barBottom = document.createElement("div");
    barBottom.className = "pseudo-bar";
    barBottom.setAttribute("aria-hidden", "true");
    stack.appendChild(barTop);
    stack.appendChild(span);
    stack.appendChild(barBottom);
    el.appendChild(stack);
    els[id] = { el, span, barTop, barBottom };
  } else {
    const span = document.createElement("div");
    span.className = "slot-text";
    el.appendChild(span);
    els[id] = { el, span };
  }
  stage.appendChild(el);
  return els[id];
}

function pseudoBarWidthPx(layout) {
  const unifiedPct = Math.max(layout["p1.pseudo"]?.width ?? 11, layout["p2.pseudo"]?.width ?? 11);
  const stageW = stage?.offsetWidth || window.innerWidth;
  return Math.round((unifiedPct / 100) * stageW);
}

function applyPseudoBarWidths(layout) {
  const barPx = pseudoBarWidthPx(layout);
  for (const id of ["p1.pseudo", "p2.pseudo"]) {
    const slot = els[id];
    if (!slot?.barTop) continue;
    slot.barTop.style.width = `${barPx}px`;
    slot.barBottom.style.width = `${barPx}px`;
  }
  document.querySelectorAll(".mp-pseudo-stack .pseudo-bar").forEach((bar) => {
    bar.style.width = `${barPx}px`;
  });
}
  for (const t of ANIM_TYPES) el.classList.remove(`anim-${t}`);
  el.classList.remove("anim-from-left", "anim-from-right");
}

function playCardAnimation(el, type, side) {
  clearCardAnimation(el);
  if (!type || type === "none") return;
  void el.offsetWidth;
  el.classList.add(`anim-${type}`);
  if (type === "slide") el.classList.add(side === "p1" ? "anim-from-left" : "anim-from-right");
}

function sideHtml(player) {
  if (!player) return "";
  const legend = player.legend?.imageLocal
    ? `<div class="mp-legend"><img src="${player.legend.imageLocal}" alt="" /></div>`
    : "";
  const champion = player.champion?.imageLocal
    ? `<div class="mp-champion"><span class="mp-label">Champion</span><img src="${player.champion.imageLocal}" alt="" /></div>`
    : "";
  const bfs = (player.battlefields || [])
    .map((b) => (b?.thumbLocal ? `<img src="${b.thumbLocal}" alt="" />` : ""))
    .join("");
  const battlefields = bfs
    ? `<span class="mp-label">Battlefields</span><div class="mp-battlefields">${bfs}</div>`
    : "";
  return `
    <div class="mp-side">
      <div class="pseudo-stack mp-pseudo-stack">
        <div class="pseudo-bar" aria-hidden="true"></div>
        <div class="mp-pseudo">${escapeText(player.pseudo || "")}</div>
        <div class="pseudo-bar" aria-hidden="true"></div>
      </div>
      ${legend}
      ${champion}
      ${battlefields}
    </div>`;
}

function escapeText(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

function renderMatchup(state) {
  matchupEl.innerHTML = `${sideHtml(state.players[0])}<div class="mp-vs">VS</div>${sideHtml(state.players[1])}`;
  applyPseudoBarWidths(normalizeLayout(state.layout));
}

function formatLabel(fmt) {
  const map = { bo1: "Bo1", bo3: "Bo3", bo5: "Bo5" };
  return map[fmt] || String(fmt || "Bo3").toUpperCase();
}

function renderScene(state) {
  const eventEl = document.getElementById("scene-event");
  if (!eventEl) return;

  eventEl.textContent = `Riftbound · ${formatLabel(state.match.format)}`;
  document.getElementById("scene-score-p1").textContent = state.game.score.p1;
  document.getElementById("scene-score-p2").textContent = state.game.score.p2;
  document.getElementById("scene-game").textContent = `Game ${state.match.currentGame + 1}`;
}

function render(state) {
  renderScene(state);

  const layout = normalizeLayout(state.layout);
  lastLayout = layout;
  applyLayoutCss(layout);
  applySceneCutout(layout);

  const matchupMode = state.display.mode === "matchup";
  matchupEl.classList.toggle("show", matchupMode);
  document.getElementById("scene")?.classList.toggle("hidden", matchupMode);
  stage.style.display = matchupMode ? "none" : "block";
  if (matchupMode) {
    renderMatchup(state);
    return;
  }

  for (const [id, def] of Object.entries(SLOT_DEFS)) {
    if (SCENE_MANAGED_TEXT.has(id)) continue;

    const cfg = layout[id];
    if (!cfg) continue;
    const slot = ensureSlot(id, def.kind);
    const show = cfg.visible !== false;

    if (def.kind === "image") {
      const value = def.get(state);
      const hasValue = value !== undefined && value !== null && value !== "";
      const onDemandCard = CARD_SLOTS.has(id);
      const hideWhenEmpty = HIDE_WHEN_EMPTY.has(id);
      slot.el.classList.toggle("hidden", !show || (hideWhenEmpty && !hasValue));
      slot.el.classList.toggle("empty", !hideWhenEmpty && !hasValue);

      if (hasValue && slot.img.getAttribute("src") !== value) {
        slot.img.src = value;
      } else if (!hasValue) {
        slot.img.removeAttribute("src");
        clearCardAnimation(slot.el);
        delete cardAnimState[id];
      }

      if (CARD_SLOTS.has(id) && hasValue) {
        const side = id.startsWith("p1") ? "p1" : "p2";
        const anim = state.display.cardAnimation || "pop";
        const tick = state.display.cardReveal?.[side] ?? 0;
        const prev = cardAnimState[id] || { tick: -1, anim: "" };
        if (tick !== prev.tick || anim !== prev.anim) {
          playCardAnimation(slot.el, anim, side);
          cardAnimState[id] = { tick, anim };
        }
      }
    } else if (def.kind === "tally") {
      slot.el.classList.toggle("hidden", !show);
      if (slot.span) slot.span.textContent = def.get(state) || "0 – 0";
    } else if (def.kind === "chrome") {
      slot.el.classList.toggle("hidden", !show);
    } else if (def.kind === "text") {
      const value = def.get(state);
      const hasValue = value !== undefined && value !== null && value !== "";
      slot.el.classList.toggle("hidden", !show || !hasValue);
      slot.span.textContent = hasValue ? value : "";
      slot.span.className = `slot-text align-${cfg.align || "left"}`;
    }
  }

  applyPseudoBarWidths(layout);
}

connectState(render);
window.addEventListener("resize", () => {
  if (lastLayout) applyPseudoBarWidths(lastLayout);
});
