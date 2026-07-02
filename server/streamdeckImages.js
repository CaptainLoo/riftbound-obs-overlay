import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { basename, join } from "node:path";
import { CARDS_DIR } from "./paths.js";

let sharpLib = null;

async function getSharp() {
  if (!sharpLib) {
    sharpLib = (await import("sharp")).default;
  }
  return sharpLib;
}

const ICON_COLORS = {
  hide: [226, 87, 76],
  matchup: [255, 193, 7],
  reset: [255, 120, 80],
  win: [156, 136, 255],
  game: [79, 168, 204],
  show: [63, 185, 100],
  nav: [90, 90, 100],
};

const labelCache = new Map();
const cardCache = new Map();

function escapeXml(text) {
  return String(text)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function wrapLabel(text, max = 14) {
  const words = String(text || "").split(/\s+/);
  const lines = [];
  let line = "";
  for (const word of words) {
    const next = line ? `${line} ${word}` : word;
    if (next.length > max && line) {
      lines.push(line);
      line = word;
    } else {
      line = next;
    }
  }
  if (line) lines.push(line);
  return lines.slice(0, 3);
}

export async function renderLabelImage(label, iconKey, size = 96) {
  const cacheKey = `${size}:${iconKey}:${label}`;
  if (labelCache.has(cacheKey)) return labelCache.get(cacheKey);

  const [r, g, b] = ICON_COLORS[iconKey] || ICON_COLORS.game;
  const lines = wrapLabel(label);
  const fontSize = lines.length > 2 ? 11 : lines.length > 1 ? 12 : 14;
  const lineHeight = fontSize + 3;
  const startY = Math.round((size - lines.length * lineHeight) / 2) + fontSize;
  const tspans = lines
    .map((line, i) => `<tspan x="50%" dy="${i === 0 ? 0 : lineHeight}">${escapeXml(line)}</tspan>`)
    .join("");

  const svg = `<svg width="${size}" height="${size}" xmlns="http://www.w3.org/2000/svg">
  <rect width="100%" height="100%" fill="rgb(${r},${g},${b})"/>
  <text x="50%" y="${startY}" text-anchor="middle" fill="#ffffff" font-family="Segoe UI, Arial, sans-serif" font-size="${fontSize}" font-weight="600">${tspans}</text>
</svg>`;

  const sharp = await getSharp();
  const raw = await sharp(Buffer.from(svg))
    .resize(size, size)
    .flatten()
    .raw()
    .toBuffer();
  labelCache.set(cacheKey, raw);
  return raw;
}

async function localCardPath(thumbLocal) {
  if (!thumbLocal) return null;
  const file = basename(thumbLocal);
  const abs = join(CARDS_DIR, file);
  return existsSync(abs) ? abs : null;
}

export async function renderCardKeyImage(cardId, cardsCache, label, size = 96) {
  const cacheKey = `${size}:${cardId}:${label}`;
  if (cardCache.has(cacheKey)) return cardCache.get(cacheKey);

  const meta = cardsCache?.[cardId];
  const src = await localCardPath(meta?.thumbLocal || meta?.imageLocal);
  if (!src) {
    return renderLabelImage(label || cardId, "show", size);
  }

  const sharp = await getSharp();
  const resized = await sharp(src)
    .resize(size, size, { fit: "cover", position: "centre" })
    .jpeg({ quality: 88 })
    .toBuffer();

  const lines = wrapLabel(label, 12);
  const barH = lines.length > 1 ? 28 : 22;
  const fontSize = lines.length > 1 ? 9 : 10;
  const tspans = lines
    .map((line, i) => `<tspan x="50%" dy="${i === 0 ? 0 : 12}">${escapeXml(line)}</tspan>`)
    .join("");
  const overlaySvg = Buffer.from(`<svg width="${size}" height="${barH}" xmlns="http://www.w3.org/2000/svg">
  <rect width="100%" height="100%" fill="rgba(0,0,0,0.72)"/>
  <text x="50%" y="${fontSize + 2}" text-anchor="middle" fill="#ffffff" font-family="Segoe UI, Arial, sans-serif" font-size="${fontSize}" font-weight="600">${tspans}</text>
</svg>`);

  const jpeg = await sharp(resized)
    .composite([{ input: overlaySvg, top: size - barH, left: 0 }])
    .flatten()
    .raw()
    .toBuffer();

  cardCache.set(cacheKey, jpeg);
  return jpeg;
}

export async function renderKeyImage(keyDef, cardsCache, size = 96) {
  if (keyDef.type === "showCard" || keyDef.type === "battlefield") {
    const cardId = keyDef.cardId || keyDef.settings?.cardId;
    if (cardId) {
      return renderCardKeyImage(cardId, cardsCache, keyDef.label, size);
    }
  }
  const icon = keyDef.type === "navPrev" || keyDef.type === "navNext" ? "nav" : keyDef.icon || "game";
  return renderLabelImage(keyDef.label, icon, size);
}

export function clearImageCaches() {
  labelCache.clear();
  cardCache.clear();
}
