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
const sceneLayers = Array.from(document.querySelectorAll(".scene-layer"));

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
const MP_MAX_DURATION_MS = 1300;
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
let matchupReadyFallbackTimer = null;

// ---- Layout -----------------------------------------------------------------

let lastLayoutCss = "";
let cachedLayout = null;
let sceneMaskActive = null;

function applyLayoutCss(layout) {
  if (!layoutCssEl) return;
  const css = layoutToCss(layout);
  if (css === lastLayoutCss) return;
  lastLayoutCss = css;
  layoutCssEl.textContent = css;
}

function applySceneCutout(layout) {
  const active = updateSceneHoleMask(sceneHoleEl, layout?.playArea);
  if (active === sceneMaskActive) return;
  sceneMaskActive = active;
  const mask = active ? "url(#scene-cutout-mask)" : "none";
  for (const el of sceneLayers) {
    el.style.clipPath = "none";
    el.style.webkitClipPath = "none";
    el.style.mask = mask;
    el.style.webkitMask = mask;
  }
}

// ---- Slots ------------------------------------------------------------------

function onAnimationStart(e) {
  e.currentTarget.classList.add("animating");
}
function onAnimationDone(e) {
  e.currentTarget.classList.remove("animating");
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
    img.decoding = "async";
    el.appendChild(img);
    if (CARD_SLOTS.has(id)) {
      el.addEventListener("animationstart", onAnimationStart);
      el.addEventListener("animationend", onAnimationDone);
      el.addEventListener("animationcancel", onAnimationDone);
    }
    els[id] = { el, img, gen: 0 };
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

function setText(node, value) {
  if (node.textContent !== value) node.textContent = value;
}

function setClass(node, value) {
  if (node.className !== value) node.className = value;
}

function clearCardAnimation(el) {
  for (const t of ANIM_TYPES) el.classList.remove(`anim-${t}`);
  el.classList.remove("anim-from-left", "anim-from-right", "animating");
}

function playCardAnimation(el, type, side) {
  clearCardAnimation(el);
  if (!type || type === "none") return;
  void el.offsetWidth;
  el.classList.add(`anim-${type}`);
  if (type === "slide") el.classList.add(side === "p1" ? "anim-from-left" : "anim-from-right");
}

/**
 * Decode an image off-DOM before swapping it into a slot, so the reveal never
 * shows a half-loaded frame. Resolves true when this request was the latest one
 * for the slot (a newer request cancels older ones).
 */
async function setSlotImage(slot, url) {
  if (slot.img.getAttribute("src") === url) return true;
  const gen = ++slot.gen;
  const pre = new Image();
  pre.decoding = "async";
  pre.src = url;
  try {
    await pre.decode();
  } catch {
    /* broken or unsupported image: still swap so the frame shows something */
  }
  if (slot.gen !== gen) return false;
  slot.img.src = url;
  return true;
}

function clearSlotImage(slot) {
  slot.gen += 1;
  if (slot.img.hasAttribute("src")) slot.img.removeAttribute("src");
}

const preloaded = new Set();
function preloadPlayerImages(state) {
  for (const pl of state.players || []) {
    const urls = [
      pl?.legend?.imageLocal,
      pl?.legend?.thumbLocal,
      pl?.champion?.imageLocal,
      ...(pl?.battlefields || []).map((b) => b?.thumbLocal),
    ];
    for (const url of urls) {
      if (!url || preloaded.has(url)) continue;
      preloaded.add(url);
      const img = new Image();
      img.decoding = "async";
      img.src = url;
    }
  }
}

function escapeText(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

// ---- Matchup ----------------------------------------------------------------

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

function matchupSettleBudgetMs(state) {
  const maxBf = Math.max(0, ...(state.players || []).map((p) => (p?.battlefields || []).length));
  const lastDelay = Math.max(
    MP_DELAY.pseudo,
    MP_DELAY.legend,
    MP_DELAY.champion,
    MP_DELAY.vs,
    MP_DELAY.battlefields + Math.max(0, maxBf - 1) * MP_DELAY.battlefieldStagger
  );
  return lastDelay + MP_MAX_DURATION_MS + 100;
}

function finishMatchupEnter() {
  clearTimeout(matchupReadyFallbackTimer);
  matchupReadyFallbackTimer = null;
  matchupEl.querySelectorAll(".mp-item").forEach((el) => {
    el.classList.add("mp-settled");
    el.style.willChange = "";
  });
  matchupEl.classList.remove("matchup-entering");
  matchupEl.classList.add("matchup-ready");
}

function bindMatchupAnimationEnd(state) {
  const items = [...matchupEl.querySelectorAll(".mp-item")];
  if (!items.length) {
    finishMatchupEnter();
    return;
  }

  let remaining = items.length;
  const onDone = (e) => {
    const el = e.currentTarget;
    el.removeEventListener("animationend", onDone);
    el.removeEventListener("animationcancel", onDone);
    el.classList.add("mp-settled");
    el.style.willChange = "";
    remaining -= 1;
    if (remaining <= 0) finishMatchupEnter();
  };

  for (const el of items) {
    el.addEventListener("animationend", onDone);
    el.addEventListener("animationcancel", onDone);
  }

  clearTimeout(matchupReadyFallbackTimer);
  matchupReadyFallbackTimer = setTimeout(() => {
    if (matchupEl.classList.contains("matchup-entering")) finishMatchupEnter();
  }, matchupSettleBudgetMs(state));
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
  clearTimeout(matchupReadyFallbackTimer);
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
  bindMatchupAnimationEnd(state);
  hideStageAfterFade();
}

function exitMatchup(onDone) {
  matchupEnterGen += 1;
  clearTimeout(matchupStageHideTimer);
  clearTimeout(matchupReadyFallbackTimer);
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

// ---- Scene + slots ----------------------------------------------------------

function formatLabel(fmt) {
  const map = { bo1: "Bo1", bo3: "Bo3", bo5: "Bo5" };
  return map[fmt] || String(fmt || "Bo3").toUpperCase();
}

const sceneNodes = {
  event: document.getElementById("scene-event"),
  p1: document.getElementById("scene-score-p1"),
  p2: document.getElementById("scene-score-p2"),
  game: document.getElementById("scene-game"),
};

function renderScene(state) {
  if (!sceneNodes.event) return;
  setText(sceneNodes.event, `Riftbound · ${formatLabel(state.match.format)}`);
  setText(sceneNodes.p1, String(state.game.score.p1));
  setText(sceneNodes.p2, String(state.game.score.p2));
  setText(sceneNodes.game, `Game ${state.match.currentGame + 1}`);
}

function renderImageSlot(id, slot, value, state) {
  const hasValue = value !== undefined && value !== null && value !== "";
  if (!hasValue) {
    clearSlotImage(slot);
    clearCardAnimation(slot.el);
    delete cardAnimState[id];
    return;
  }

  if (!CARD_SLOTS.has(id)) {
    setSlotImage(slot, value);
    return;
  }

  const side = id.startsWith("p1") ? "p1" : "p2";
  const anim = state.display.cardAnimation || "pop";
  const tick = state.display.cardReveal?.[side] ?? 0;
  const prev = cardAnimState[id] || { tick: -1, anim: "" };
  const shouldAnimate = tick !== prev.tick || anim !== prev.anim;
  cardAnimState[id] = { tick, anim };

  if (slot.img.getAttribute("src") === value) {
    if (shouldAnimate) playCardAnimation(slot.el, anim, side);
    return;
  }
  setSlotImage(slot, value).then((latest) => {
    if (latest && shouldAnimate) playCardAnimation(slot.el, anim, side);
  });
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
      renderImageSlot(id, slot, value, state);
    } else if (def.kind === "tally") {
      slot.el.classList.toggle("hidden", !show);
      if (slot.span) setText(slot.span, def.get(state) || "0 – 0");
    } else if (def.kind === "chrome") {
      slot.el.classList.toggle("hidden", !show);
    } else if (def.kind === "text") {
      const value = def.get(state);
      const hasValue = value !== undefined && value !== null && value !== "";
      slot.el.classList.toggle("hidden", !show || !hasValue);
      setText(slot.span, hasValue ? String(value) : "");
      setClass(slot.span, `slot-text align-${cfg.align || "left"}`);
    }
  }
}

function render(state, info = { type: "state", sections: [] }) {
  const sections = new Set(info.sections || []);
  const isFull = info.type !== "patch";
  const sceneChanged = isFull || sections.has("match") || sections.has("game");
  const layoutChanged = isFull || sections.has("layout") || !cachedLayout;
  const displayChanged =
    isFull ||
    sections.has("display") ||
    sections.has("players") ||
    sections.has("game") ||
    sections.has("match");

  if (sceneChanged) renderScene(state);
  if (isFull || sections.has("players")) preloadPlayerImages(state);

  if (layoutChanged) {
    cachedLayout = normalizeLayout(state.layout);
    applyLayoutCss(cachedLayout);
    applySceneCutout(cachedLayout);
  }
  const layout = cachedLayout;

  if (!displayChanged) return;

  const mode = state.display.mode === "matchup" ? "matchup" : "persistent";
  const prev = lastDisplayMode;

  if (mode === "matchup") {
    if (prev !== "matchup" || hashMatchup(state) !== matchupHash) {
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
