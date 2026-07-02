import { existsSync } from "node:fs";
import { basename, join } from "node:path";
import { CARDS_DIR } from "./paths.js";

let sharpLib = null;

async function getSharp() {
  if (!sharpLib) {
    sharpLib = (await import("sharp")).default;
  }
  return sharpLib;
}

export const ICON_COLORS = {
  hide: [226, 87, 76],
  matchup: [255, 193, 7],
  reset: [255, 120, 80],
  win: [156, 136, 255],
  game: [79, 168, 204],
  show: [63, 185, 100],
  nav: [90, 90, 100],
};

export function getIconColorForKeyDef(keyDef) {
  const icon =
    keyDef.type === "navPrev" || keyDef.type === "navNext" ? "nav" : keyDef.icon || "game";
  return ICON_COLORS[icon] || ICON_COLORS.game;
}

const labelCache = new Map();
const cardArtCache = new Map();
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

function assertRgbBuffer(buffer, size, label) {
  const expected = size * size * 3;
  if (buffer.length !== expected) {
    throw new Error(`${label}: expected ${expected} RGB bytes, got ${buffer.length}`);
  }
  return buffer;
}

async function localCardPath(thumbLocal) {
  if (!thumbLocal) return null;
  const file = basename(thumbLocal);
  const abs = join(CARDS_DIR, file);
  return existsSync(abs) ? abs : null;
}

export async function renderCardArtOnly(cardId, cardsCache, size = 96) {
  const cacheKey = `${size}:${cardId}`;
  if (cardArtCache.has(cacheKey)) return cardArtCache.get(cacheKey);

  const meta = cardsCache?.[cardId];
  const src = await localCardPath(meta?.thumbLocal || meta?.imageLocal);
  if (!src) return null;

  const sharp = await getSharp();
  const raw = await sharp(src)
    .resize(size, size, { fit: "cover", position: "centre" })
    .removeAlpha()
    .raw({ channels: 3 })
    .toBuffer();

  const rgb = assertRgbBuffer(raw, size, `card art ${cardId}`);
  cardArtCache.set(cacheKey, rgb);
  return rgb;
}

function activeBorderSvg(size) {
  const inset = 2;
  const stroke = 4;
  return Buffer.from(`<svg width="${size}" height="${size}" xmlns="http://www.w3.org/2000/svg">
  <rect x="${inset}" y="${inset}" width="${size - inset * 2}" height="${size - inset * 2}"
    fill="none" stroke="#3fb964" stroke-width="${stroke}"/>
</svg>`);
}

export async function renderLabelImage(label, iconKey, size = 96, options = {}) {
  const active = Boolean(options.active);
  const cacheKey = `${size}:${iconKey}:${label}:${active}`;
  if (labelCache.has(cacheKey)) return labelCache.get(cacheKey);

  const [r, g, b] = ICON_COLORS[iconKey] || ICON_COLORS.game;
  const lines = wrapLabel(label);
  const fontSize = lines.length > 2 ? 11 : lines.length > 1 ? 12 : 14;
  const lineHeight = fontSize + 3;
  const startY = Math.round((size - lines.length * lineHeight) / 2) + fontSize;
  const tspans = lines
    .map((line, i) => `<tspan x="50%" dy="${i === 0 ? 0 : lineHeight}">${escapeXml(line)}</tspan>`)
    .join("");

  const border = active
    ? `<rect x="2" y="2" width="${size - 4}" height="${size - 4}" fill="none" stroke="#3fb964" stroke-width="4"/>`
    : "";

  const svg = `<svg width="${size}" height="${size}" xmlns="http://www.w3.org/2000/svg">
  <rect width="100%" height="100%" fill="rgb(${r},${g},${b})"/>
  ${border}
  <text x="50%" y="${startY}" text-anchor="middle" fill="#ffffff" font-family="Segoe UI, Arial, sans-serif" font-size="${fontSize}" font-weight="600">${tspans}</text>
</svg>`;

  const sharp = await getSharp();
  const raw = await sharp(Buffer.from(svg))
    .resize(size, size)
    .removeAlpha()
    .raw({ channels: 3 })
    .toBuffer();
  const rgb = assertRgbBuffer(raw, size, `label ${label}`);
  labelCache.set(cacheKey, rgb);
  return rgb;
}

export async function renderCardKeyImage(cardId, cardsCache, label, size = 96, options = {}) {
  const active = Boolean(options.active);
  const cacheKey = `${size}:${cardId}:${label}:${active}`;
  if (cardCache.has(cacheKey)) return cardCache.get(cacheKey);

  const art = await renderCardArtOnly(cardId, cardsCache, size);
  if (!art) {
    return renderLabelImage(label || cardId, "show", size, { active });
  }

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

  const sharp = await getSharp();
  const composites = [{ input: overlaySvg, top: size - barH, left: 0 }];
  if (active) {
    composites.push({ input: activeBorderSvg(size), top: 0, left: 0 });
  }

  const raw = await sharp(art, { raw: { width: size, height: size, channels: 3 } })
    .composite(composites)
    .removeAlpha()
    .raw({ channels: 3 })
    .toBuffer();

  const rgb = assertRgbBuffer(raw, size, `card ${cardId}`);
  cardCache.set(cacheKey, rgb);
  return rgb;
}

export async function renderKeyImage(keyDef, cardsCache, size = 96) {
  const active = Boolean(keyDef.active);
  if (keyDef.type === "showCard" || keyDef.type === "battlefield") {
    const cardId = keyDef.cardId || keyDef.settings?.cardId;
    if (cardId) {
      return renderCardKeyImage(cardId, cardsCache, keyDef.label, size, { active });
    }
  }
  const icon = keyDef.type === "navPrev" || keyDef.type === "navNext" ? "nav" : keyDef.icon || "game";
  return renderLabelImage(keyDef.label, icon, size, { active });
}

export function invalidateCardCache(cardId) {
  if (!cardId) return;
  const needle = `:${cardId}`;
  for (const key of cardArtCache.keys()) {
    if (key.includes(needle)) cardArtCache.delete(key);
  }
  for (const key of cardCache.keys()) {
    if (key.includes(`:${cardId}:`)) cardCache.delete(key);
  }
}

export function clearImageCaches() {
  labelCache.clear();
  cardArtCache.clear();
  cardCache.clear();
}

/**
 * JPEG encoder for @elgato-stream-deck — bypasses @julusian/jpeg-turbo which can hang
 * when the native module is misbuilt. Falls back to jpeg-js if Sharp fails.
 */
export async function encodeJpegWithSharp(buffer, width, height, options) {
  const quality = options?.quality ?? 85;
  const pixelBuffer = Buffer.from(buffer.buffer, buffer.byteOffset, buffer.byteLength);

  try {
    const sharp = await getSharp();
    return sharp(pixelBuffer, {
      raw: { width, height, channels: 4 },
    })
      .jpeg({ quality })
      .toBuffer();
  } catch (sharpErr) {
    try {
      const jpegJS = await import("jpeg-js");
      const encoded = jpegJS.encode({ width, height, data: buffer }, quality);
      return encoded.data;
    } catch (jpegErr) {
      throw new Error(
        `JPEG encode failed (sharp: ${sharpErr.message}; jpeg-js: ${jpegErr.message})`
      );
    }
  }
}
