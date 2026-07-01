/** Shared layout math + CSS generation for control panel and overlay. */

export const CARD_PORTRAIT = 744 / 1039;
export const CARD_LANDSCAPE = 1039 / 744;
export const CANVAS_RATIO = 16 / 9;

export const SLOT_RATIO = {
  "p1.legend": CARD_PORTRAIT,
  "p2.legend": CARD_PORTRAIT,
  "p1.battlefield": CARD_LANDSCAPE,
  "p2.battlefield": CARD_LANDSCAPE,
  "p1.card": CARD_PORTRAIT,
  "p2.card": CARD_PORTRAIT,
};

export const IMAGE_SLOTS = new Set(Object.keys(SLOT_RATIO));

export const CHROME_SLOTS = new Set(["playArea"]);

export const TEXT_SLOTS = new Set([
  "p1.pseudo",
  "p2.pseudo",
  "score",
  "p1.champion",
  "p2.champion",
  "match.tally",
]);

export function slotDomId(id) {
  return `slot-${id.replace(/\./g, "-")}`;
}

export function frameClass(id) {
  if (id === "playArea") return "frame-play-area";
  if (id === "match.tally") return "frame-match-tally";
  if (id.endsWith(".legend")) return "frame-legend";
  if (id.endsWith(".battlefield")) return "frame-battlefield";
  if (id.endsWith(".card")) return "frame-card";
  return "";
}

/** Matches `.slot-chrome.frame-play-area { border-radius: 12px }` on a 1920×1080 canvas. */
export const PLAY_AREA_RADIUS_PX = 12;

/** Update the SVG mask hole (0–1 coords) for a rounded camera cutout. */
export function updateSceneHoleMask(holeEl, playArea) {
  if (!holeEl || !playArea || playArea.visible === false) return false;
  const rx = PLAY_AREA_RADIUS_PX / 1920;
  const ry = PLAY_AREA_RADIUS_PX / 1080;
  holeEl.setAttribute("x", String(playArea.x / 100));
  holeEl.setAttribute("y", String(playArea.y / 100));
  holeEl.setAttribute("width", String(playArea.width / 100));
  holeEl.setAttribute("height", String(playArea.height / 100));
  holeEl.setAttribute("rx", String(rx));
  holeEl.setAttribute("ry", String(ry));
  return true;
}

export function heightForWidth(ratio, widthPct) {
  return (widthPct * CANVAS_RATIO) / ratio;
}

export function widthForHeight(ratio, heightPct) {
  return (heightPct * ratio) / CANVAS_RATIO;
}

export function round(v) {
  return Math.round(v * 10) / 10;
}

/** Keep image slots at the correct card aspect ratio (744×1039 portrait, 1039×744 battlefield). */
export function normalizeSlot(slotId, cfg) {
  const c = { ...cfg };
  const ratio = SLOT_RATIO[slotId];
  if (!ratio) return c;

  c.height = round(heightForWidth(ratio, c.width));
  if (c.y + c.height > 100) {
    c.height = round(Math.max(2, 100 - c.y));
    c.width = round(widthForHeight(ratio, c.height));
  }
  if (c.x + c.width > 100) {
    c.width = round(Math.max(2, 100 - c.x));
    c.height = round(heightForWidth(ratio, c.width));
  }
  return c;
}

export function normalizeLayoutSlot(slotId, cfg) {
  if (SLOT_RATIO[slotId]) return normalizeSlot(slotId, cfg);
  return cfg;
}

export function normalizeLayout(layout) {
  const out = { ...layout };
  for (const id of IMAGE_SLOTS) {
    if (out[id]) out[id] = normalizeSlot(id, out[id]);
  }
  return out;
}

export function layoutToCss(layout) {
  const lines = [
    "/* Live overlay — positions update when you edit Layout */",
    "#stage { position: fixed; inset: 0; z-index: 10; pointer-events: none; }",
    "",
  ];

  for (const [id, cfg] of Object.entries(layout)) {
    const sel = `#${slotDomId(id)}`;
    lines.push(`${sel} {`);
    lines.push(`  left: ${round(cfg.x)}%;`);
    lines.push(`  top: ${round(cfg.y)}%;`);
    lines.push(`  width: ${round(cfg.width)}%;`);
    lines.push(`  height: ${round(cfg.height)}%;`);
    lines.push(`  display: ${cfg.visible === false ? "none" : "flex"};`);
    if (SLOT_RATIO[id]) {
      const ratio = SLOT_RATIO[id];
      lines.push(`  aspect-ratio: ${ratio < 1 ? "744 / 1039" : "1039 / 744"};`);
    }
    if (id === "playArea") lines.push(`  z-index: 5;`);
    if (id === "match.tally") lines.push(`  z-index: 25;`);
    lines.push(`}`);

    if (TEXT_SLOTS.has(id)) {
      lines.push(`${sel} .slot-text${id === "match.tally" ? `, ${sel} .match-tally-inner` : ""} {`);
      lines.push(`  font-size: ${cfg.fontSize ?? 3}vh;`);
      lines.push(`  color: ${cfg.color ?? "#ffffff"};`);
      lines.push(`  text-align: ${cfg.align || "left"};`);
      lines.push(`}`);
    }
    lines.push("");
  }
  return lines.join("\n").trimEnd();
}
