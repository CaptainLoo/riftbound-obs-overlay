import { connectState } from "/shared/ws.js";
import {
  frameClass,
  layoutToCss,
  normalizeLayout,
  updateSceneHoleMask,
  slotDomId,
} from "/shared/layout.js";

const stage = document.getElementById("stage");
const matchupEl = document.getElementById("matchup");
const sceneEl = document.getElementById("scene");
const layoutCssEl = document.getElementById("layout-runtime-css");
const sceneHoleEl = document.getElementById("scene-hole");

const CARD_SLOTS = new Set(["p1.card", "p2.card"]);
const HIDE_WHEN_EMPTY = new Set(["p1.card", "p2.card", "p1.battlefield", "p2.battlefield"]);
const ANIM_TYPES = ["none", "fade", "slide", "pop", "flip", "glow", "impact"];
const SCENE_MANAGED_TEXT = new Set(["score"]);
const cardAnimState = {};

const MP_DELAY = {
  pseudo: 400,
  legend: 800,
  champion: 1600,
  battlefields: 2400,
  battlefieldStagger: 120,
  vs: 600,
};
const MP_EXIT_MS = 400;
const MP_SCENE_FADE_MS = 450;

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
let lastDisplayMode = null;
let matchupHash = "";
let matchupExitTimer = null;
let matchupEnterGen = 0;
let matchupStageHideTimer = null;

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
  } else {
    const span = document.createElement("div");
    span.className = "slot-text";
    el.appendChild(span);
    els[id] = { el, span };
  }
  stage.appendChild(el);
  return els[id];
}

function clearCardAnimation(el) {
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

function escapeText(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

function hashMatchup(state) {
  const parts = [];
  for (const pl of state.players || []) {
    parts.push(pl?.pseudo || "");
    parts.push(pl?.legend?.imageLocal || "");
    parts.push(pl?.champion?.imageLocal || "");
    for (const bf of pl?.battlefields || []) parts.push(bf?.thumbLocal || "");
  }
  return parts.join("|");
}

function sideHtml(player, sideClass) {
  if (!player) return "";
  const chunks = [];

  chunks.push(
    `<div class="mp-item mp-pseudo-item" style="--mp-delay:${MP_DELAY.pseudo}ms"><div class="mp-pseudo">${escapeText(player.pseudo || "")}</div></div>`
  );

  if (player.legend?.imageLocal) {
    chunks.push(
      `<div class="mp-item mp-legend-item" style="--mp-delay:${MP_DELAY.legend}ms;--mp-duration:1.3s"><div class="mp-legend"><img src="${player.legend.imageLocal}" alt="" /></div></div>`
    );
  }

  if (player.champion?.imageLocal) {
    chunks.push(
      `<div class="mp-item mp-champion-item" style="--mp-delay:${MP_DELAY.champion}ms;--mp-duration:1.2s"><div class="mp-champion"><span class="mp-label">Champion</span><img src="${player.champion.imageLocal}" alt="" /></div></div>`
    );
  }

  const bfs = (player.battlefields || []).filter((b) => b?.thumbLocal);
  if (bfs.length) {
    const imgs = bfs
      .map((b, i) => {
        const delay = MP_DELAY.battlefields + i * MP_DELAY.battlefieldStagger;
        return `<img class="mp-item mp-bf-card" src="${b.thumbLocal}" alt="" style="--mp-delay:${delay}ms;--mp-duration:1s" />`;
      })
      .join("");
    chunks.push(
      `<div class="mp-battlefields-block"><span class="mp-label mp-item" style="--mp-delay:${MP_DELAY.battlefields}ms">Battlefields</span><div class="mp-battlefields">${imgs}</div></div>`
    );
  }

  return `<div class="mp-side ${sideClass}">${chunks.join("")}</div>`;
}

function buildMatchupDom(state) {
  matchupEl.innerHTML = `${sideHtml(state.players[0], "mp-side-left")}<div class="mp-vs mp-item mp-vs-item" style="--mp-delay:${MP_DELAY.vs}ms;--mp-duration:0.9s">VS</div>${sideHtml(state.players[1], "mp-side-right")}`;
}

function preloadMatchupImages(root) {
  const imgs = [...root.querySelectorAll("img")];
  return Promise.all(
    imgs.map(
      (img) =>
        new Promise((resolve) => {
          const done = () => {
            if (typeof img.decode === "function") {
              img.decode().then(resolve).catch(resolve);
            } else {
              resolve();
            }
          };
          if (img.complete && img.naturalWidth > 0) done();
          else {
            img.addEventListener("load", done, { once: true });
            img.addEventListener("error", resolve, { once: true });
          }
        })
    )
  );
}

function clearMatchupItemState() {
  matchupEl.querySelectorAll(".mp-item").forEach((el) => {
    el.classList.remove("mp-settled");
    el.style.willChange = "";
  });
}

function bindMatchupAnimationEnd() {
  const items = [...matchupEl.querySelectorAll(".mp-item")];
  if (!items.length) {
    matchupEl.classList.remove("matchup-entering");
    matchupEl.classList.add("matchup-ready");
    return;
  }

  let remaining = items.length;
  const onEnd = (e) => {
    const el = e.currentTarget;
    el.classList.add("mp-settled");
    el.style.willChange = "";
    remaining -= 1;
    if (remaining <= 0) {
      matchupEl.classList.remove("matchup-entering");
      matchupEl.classList.add("matchup-ready");
    }
  };

  for (const el of items) {
    el.addEventListener("animationend", onEnd, { once: true });
  }
}

function hideStageAfterFade() {
  clearTimeout(matchupStageHideTimer);
  matchupStageHideTimer = setTimeout(() => {
    if (!matchupEl.classList.contains("show")) return;
    stage.classList.add("stage-hidden");
    stage.style.display = "none";
  }, MP_SCENE_FADE_MS);
}

function showStageForGame() {
  clearTimeout(matchupStageHideTimer);
  stage.style.display = "block";
  stage.classList.remove("stage-exiting", "stage-hidden");
  sceneEl?.classList.remove("scene-exiting");
}

async function enterMatchup(state) {
  const gen = ++matchupEnterGen;
  const hash = hashMatchup(state);
  const needRebuild = hash !== matchupHash || !matchupEl.children.length;
  matchupHash = hash;

  clearTimeout(matchupExitTimer);
  matchupEl.classList.remove("matchup-exiting", "matchup-ready");
  if (needRebuild) {
    buildMatchupDom(state);
    clearMatchupItemState();
  }

  sceneEl?.classList.add("scene-exiting");
  stage.classList.remove("stage-hidden");
  stage.style.display = "block";
  stage.classList.add("stage-exiting");

  matchupEl.classList.add("show");

  await preloadMatchupImages(matchupEl);
  if (gen !== matchupEnterGen) return;

  void matchupEl.offsetWidth;
  matchupEl.classList.add("matchup-entering");
  bindMatchupAnimationEnd();
  hideStageAfterFade();
}

function exitMatchup(onDone) {
  matchupEnterGen += 1;
  clearTimeout(matchupStageHideTimer);
  matchupEl.classList.remove("matchup-entering", "matchup-ready");
  matchupEl.classList.add("matchup-exiting");
  showStageForGame();

  clearTimeout(matchupExitTimer);
  matchupExitTimer = setTimeout(() => {
    matchupEl.classList.remove("show", "matchup-exiting");
    clearMatchupItemState();
    onDone?.();
  }, MP_EXIT_MS);
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

function renderGameSlots(state, layout) {
  for (const [id, def] of Object.entries(SLOT_DEFS)) {
    if (SCENE_MANAGED_TEXT.has(id)) continue;

    const cfg = layout[id];
    if (!cfg) continue;
    const slot = ensureSlot(id, def.kind);
    const show = cfg.visible !== false;

    if (def.kind === "image") {
      const value = def.get(state);
      const hasValue = value !== undefined && value !== null && value !== "";
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
}

function render(state) {
  renderScene(state);

  const layout = normalizeLayout(state.layout);
  applyLayoutCss(layout);
  applySceneCutout(layout);

  const mode = state.display.mode === "matchup" ? "matchup" : "persistent";
  const prev = lastDisplayMode;

  if (mode === "matchup") {
    if (prev !== "matchup") {
      enterMatchup(state);
    } else if (hashMatchup(state) !== matchupHash) {
      enterMatchup(state);
    }
    lastDisplayMode = mode;
    return;
  }

  if (prev === "matchup") {
    lastDisplayMode = mode;
    exitMatchup(() => renderGameSlots(state, layout));
    return;
  }

  lastDisplayMode = mode;
  showStageForGame();
  renderGameSlots(state, layout);
}

connectState(render);
