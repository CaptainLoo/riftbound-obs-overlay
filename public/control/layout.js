/** Layout tab: drag/resize blocks over a live overlay preview. */
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
import { api } from "./api.js";
import { SLOT_LABELS } from "./constants.js";
import { h, onAction, setText } from "./dom.js";
import { getData } from "./store.js";
import { toast } from "./toast.js";
import { clamp, cssEscape } from "./utils.js";

const data = () => getData();
let stage = null;
let selectedSlot = null;
let layoutPersistTimer = null;
let layoutLiveTimer = null;
let layoutDragging = 0;
let lastCss = "";

const slotLabel = (slotId) => SLOT_LABELS[slotId] || slotId;

export function isLayoutDragging() {
  return layoutDragging > 0;
}

function handlesEl() {
  return document.getElementById("layout-handles");
}

function ensureStage() {
  stage = stage || document.getElementById("layout-stage");
  if (!document.getElementById("layout-live-overlay")) {
    stage.replaceChildren(
      h("iframe", { id: "layout-live-overlay", class: "layout-live-overlay", src: "/overlay/", title: "Live overlay preview", loading: "lazy" }),
      h("div", { id: "layout-handles", class: "layout-handles" })
    );
  }
  return handlesEl();
}

function slotSelector(slotId) {
  return `.lslot[data-slot="${cssEscape(slotId)}"]`;
}

function renderLayoutCss() {
  const out = document.getElementById("layout-css-out");
  if (!out || !data()?.layout) return;
  const css = layoutToCss(data().layout);
  if (css !== lastCss) {
    lastCss = css;
    out.textContent = css;
  }
}

function pushLayoutLive(slotId) {
  if (!data()?.layout?.[slotId]) return;
  renderLayoutCss();
  clearTimeout(layoutLiveTimer);
  layoutLiveTimer = setTimeout(() => {
    api("/api/layout/live", { method: "POST", body: { slot: slotId, props: data().layout[slotId] } }).catch(() => {});
  }, 32);
}

function queueLayoutPersist(slotId) {
  clearTimeout(layoutPersistTimer);
  layoutPersistTimer = setTimeout(() => persistLayout(slotId), 450);
}

async function persistLayout(slotId) {
  try {
    await api("/api/layout", { method: "POST", body: { slot: slotId, props: data().layout[slotId] } });
  } catch (err) {
    toast("Layout error: " + err.message, "err");
  }
}

function positionSlot(el, cfg) {
  el.style.left = `${cfg.x}%`;
  el.style.top = `${cfg.y}%`;
  el.style.width = `${cfg.width}%`;
  el.style.height = `${cfg.height}%`;
  el.style.display = cfg.visible === false ? "none" : "flex";
}

function applyLayoutChange(slotId) {
  const el = handlesEl()?.querySelector(slotSelector(slotId));
  if (el) positionSlot(el, data().layout[slotId]);
  pushLayoutLive(slotId);
  queueLayoutPersist(slotId);
}

function buildLayoutEditor() {
  const handles = ensureStage();
  handles.innerHTML = "";
  data().layout = normalizeLayout(data().layout);
  for (const [slotId, cfg] of Object.entries(data().layout)) {
    const fc = frameClass(slotId);
    const el = h(
      "div",
      {
        class: `lslot${fc ? ` lslot-frame ${fc}` : " lslot-text"}${slotId === "playArea" ? " lslot-play" : ""}`,
        dataset: { slot: slotId },
        tabindex: "0",
        role: "button",
        "aria-label": slotLabel(slotId),
      },
      h("span", {}, slotLabel(slotId)),
      h("div", { class: "handle", "aria-hidden": "true" })
    );
    positionSlot(el, cfg);
    attachDrag(el, slotId);
    handles.appendChild(el);
  }
  renderProps();
  renderLayoutCss();
}

export function syncLayoutFromData() {
  const handles = handlesEl();
  if (!handles?.children.length) {
    buildLayoutEditor();
    return;
  }
  for (const el of handles.children) {
    const cfg = data().layout[el.dataset.slot];
    if (cfg) positionSlot(el, cfg);
  }
  renderLayoutCss();
  if (selectedSlot) renderProps();
}

function attachDrag(el, slotId) {
  const handle = el.querySelector(".handle");

  el.addEventListener("focus", () => selectSlot(slotId));
  el.addEventListener("keydown", (e) => {
    const step = e.shiftKey ? 1 : 0.2;
    const cfg = data().layout[slotId];
    const moves = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] };
    const mv = moves[e.key];
    if (!mv) return;
    e.preventDefault();
    cfg.x = round(clamp(cfg.x + mv[0], 0, 100 - cfg.width));
    cfg.y = round(clamp(cfg.y + mv[1], 0, 100 - cfg.height));
    positionSlot(el, cfg);
    renderProps();
    applyLayoutChange(slotId);
  });

  el.addEventListener("pointerdown", (e) => {
    if (e.target === handle) return;
    selectSlot(slotId);
    const rect = stage.getBoundingClientRect();
    const cfg = data().layout[slotId];
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
      el.removeEventListener("pointercancel", up);
      layoutDragging = Math.max(0, layoutDragging - 1);
      clearTimeout(layoutLiveTimer);
      pushLayoutLive(slotId);
      clearTimeout(layoutPersistTimer);
      persistLayout(slotId);
    };
    el.addEventListener("pointermove", move);
    el.addEventListener("pointerup", up);
    el.addEventListener("pointercancel", up);
  });

  handle.addEventListener("pointerdown", (e) => {
    e.stopPropagation();
    selectSlot(slotId);
    const rect = stage.getBoundingClientRect();
    const cfg = data().layout[slotId];
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
      let hgt;
      if (ratio) {
        hgt = heightForWidth(ratio, w);
        if (cfg.y + hgt > 100) {
          hgt = 100 - cfg.y;
          w = widthForHeight(ratio, hgt);
        }
      } else {
        const dh = ((ev.clientY - startY) / rect.height) * 100;
        hgt = clamp(origH + dh, 2, 100 - cfg.y);
      }
      cfg.width = w;
      cfg.height = hgt;
      Object.assign(cfg, normalizeLayoutSlot(slotId, cfg));
      positionSlot(el, cfg);
      renderProps();
      pushLayoutLive(slotId);
    };
    const up = () => {
      handle.removeEventListener("pointermove", move);
      handle.removeEventListener("pointerup", up);
      handle.removeEventListener("pointercancel", up);
      layoutDragging = Math.max(0, layoutDragging - 1);
      clearTimeout(layoutLiveTimer);
      pushLayoutLive(slotId);
      clearTimeout(layoutPersistTimer);
      persistLayout(slotId);
    };
    handle.addEventListener("pointermove", move);
    handle.addEventListener("pointerup", up);
    handle.addEventListener("pointercancel", up);
  });
}

function selectSlot(slotId) {
  if (selectedSlot === slotId) return;
  selectedSlot = slotId;
  handlesEl()
    ?.querySelectorAll(".lslot")
    .forEach((el) => el.classList.toggle("selected", el.dataset.slot === slotId));
  renderProps(true);
}

let propsSlot = null;

/** Rebuild the properties form when the selected slot changes; otherwise only refresh values. */
function renderProps(force = false) {
  const body = document.getElementById("layout-props-body");
  if (!body) return;
  if (!selectedSlot) {
    body.replaceChildren(h("p", { class: "empty" }, "Select a block on the scene to edit it. Arrow keys nudge the selected block."));
    propsSlot = null;
    return;
  }
  const cfg = data().layout[selectedSlot];
  const isText = TEXT_SLOTS.has(selectedSlot);

  if (force || propsSlot !== selectedSlot) {
    propsSlot = selectedSlot;
    const num = (key, label, step = "0.5") =>
      h("div", {}, h("label", {}, label), h("input", { type: "number", step, inputmode: "decimal", dataset: { action: "prop", prop: key } }));
    body.replaceChildren(
      h("p", { class: "props-title" }, slotLabel(selectedSlot)),
      h(
        "div",
        { class: "prop-grid" },
        num("x", "X %"),
        num("y", "Y %"),
        num("width", "Width %"),
        num("height", "Height %"),
        ...(isText
          ? [
              num("fontSize", "Font (vh)", "0.1"),
              h("div", {}, h("label", {}, "Color"), h("input", { type: "text", dataset: { action: "prop", prop: "color" } })),
              h(
                "div",
                { class: "full" },
                h("label", {}, "Alignment"),
                h(
                  "select",
                  { dataset: { action: "prop", prop: "align" } },
                  h("option", { value: "left" }, "Left"),
                  h("option", { value: "center" }, "Center"),
                  h("option", { value: "right" }, "Right")
                )
              ),
            ]
          : []),
        h(
          "div",
          { class: "full" },
          h("label", { class: "check" }, h("input", { type: "checkbox", dataset: { action: "prop", prop: "visible" } }), " Visible on overlay")
        )
      )
    );
  }

  for (const input of body.querySelectorAll("[data-prop]")) {
    if (document.activeElement === input) continue;
    const key = input.dataset.prop;
    if (input.type === "checkbox") input.checked = cfg.visible !== false;
    else if (input.type === "number") input.value = key === "fontSize" ? (cfg.fontSize ?? 3) : round(cfg[key]);
    else if (key === "color") input.value = cfg.color ?? "#ffffff";
    else if (key === "align") input.value = cfg.align || "left";
  }
}

function onPropEdit(input) {
  if (!selectedSlot) return;
  const cfg = data().layout[selectedSlot];
  const key = input.dataset.prop;
  let value;
  if (input.type === "checkbox") value = input.checked;
  else if (input.type === "number") value = parseFloat(input.value);
  else value = input.value;
  if (input.type === "number" && Number.isNaN(value)) return;
  cfg[key] = value;
  if (SLOT_RATIO[selectedSlot]) Object.assign(cfg, normalizeLayoutSlot(selectedSlot, cfg));
  applyLayoutChange(selectedSlot);
  if (SLOT_RATIO[selectedSlot] && (key === "width" || key === "height")) renderProps();
}

export function initLayout() {
  stage = document.getElementById("layout-stage");
  onAction("input", "prop", (el) => {
    if (el.type !== "checkbox" && el.tagName !== "SELECT") onPropEdit(el);
  });
  onAction("change", "prop", (el) => {
    if (el.type === "checkbox" || el.tagName === "SELECT") onPropEdit(el);
  });
  onAction("click", "save-layout", async () => {
    clearTimeout(layoutPersistTimer);
    await api("/api/layout", { method: "POST", body: { layout: data().layout } });
    renderLayoutCss();
    toast("Layout saved");
  });
  onAction("click", "reset-layout", async () => {
    if (!confirm("Reset the layout to its defaults?")) return;
    await api("/api/layout/reset", { method: "POST" });
    toast("Layout reset");
  });
  onAction("click", "copy-css", async () => {
    const css = document.getElementById("layout-css-out")?.textContent || "";
    try {
      await navigator.clipboard.writeText(css);
      toast("CSS copied");
    } catch {
      toast("Copy failed — select the text manually", "err");
    }
  });
  buildLayoutEditor();
}

export function layoutStatus() {
  return { selectedSlot };
}

export { setText };
