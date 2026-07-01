import { createWriteStream, mkdirSync, readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { deflateSync } from "node:zlib";

const ROOT = dirname(fileURLToPath(import.meta.url));
const OUT = join(ROOT, "com.riftbound.obs.sdPlugin", "imgs");
mkdirSync(OUT, { recursive: true });

// Minimal solid PNG generator (RGBA 144×144).
function solidPng(r, g, b) {
  const w = 144;
  const h = 144;
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) {
    const row = y * (w * 4 + 1);
    raw[row] = 0;
    for (let x = 0; x < w; x++) {
      const i = row + 1 + x * 4;
      raw[i] = r;
      raw[i + 1] = g;
      raw[i + 2] = b;
      raw[i + 3] = 255;
    }
  }
  const compressed = deflateSync(raw);
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;
  function chunk(type, data) {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const t = Buffer.from(type);
    const crcData = Buffer.concat([t, data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(crcData) >>> 0);
    return Buffer.concat([len, t, data, crc]);
  }
  return Buffer.concat([signature, chunk("IHDR", ihdr), chunk("IDAT", compressed), chunk("IEND", Buffer.alloc(0))]);
}

function crc32(buf) {
  let c = ~0;
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i];
    for (let k = 0; k < 8; k++) c = c & 1 ? (0xedb88320 ^ (c >>> 1)) : c >>> 1;
  }
  return ~c;
}

const icons = {
  "plugin-icon": [106, 166, 255],
  "action-show": [63, 185, 100],
  "action-hide": [226, 87, 76],
  "action-matchup": [255, 193, 7],
  "action-win": [156, 136, 255],
  "action-game": [79, 168, 204],
};

for (const [name, rgb] of Object.entries(icons)) {
  const png = solidPng(...rgb);
  for (const suffix of ["", "@2x"]) {
    const path = join(OUT, `${name}${suffix}.png`);
    createWriteStream(path).end(png);
  }
}

// Copy card thumb as plugin art if available.
const sampleThumb = join(ROOT, "..", "data", "cards");
if (existsSync(sampleThumb)) {
  /* optional future: use real card art */
}

console.log("Icons written to com.riftbound.obs.sdPlugin/imgs/");
