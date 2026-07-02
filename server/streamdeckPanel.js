import { runPool } from "./streamdeckImageWarm.js";

export function getPanelLayout(deck) {
  const dims = deck.calculateFillPanelDimensions?.();
  if (!dims) return null;

  const buttons = deck.CONTROLS.filter(
    (c) => c.type === "button" && c.feedbackType === "lcd"
  );
  if (!buttons.length) return null;

  const rows = buttons.map((b) => b.row);
  const cols = buttons.map((b) => b.column);
  const minRow = Math.min(...rows);
  const minCol = Math.min(...cols);
  const keySize = buttons[0].pixelSize?.width || 96;

  return { width: dims.width, height: dims.height, minRow, minCol, keySize, buttons };
}

function solidKeyRgb(keySize, r, g, b) {
  const buf = Buffer.alloc(keySize * keySize * 3);
  for (let i = 0; i < keySize * keySize; i++) {
    buf[i * 3] = r;
    buf[i * 3 + 1] = g;
    buf[i * 3 + 2] = b;
  }
  return buf;
}

/**
 * Composite all page keys into one panel RGB buffer for fillPanelBuffer.
 */
export async function renderPagePanel(deck, page, cardsCache, renderKeyImage, getIconColorForKeyDef, {
  concurrency = 4,
} = {}) {
  const layout = getPanelLayout(deck);
  if (!layout) throw new Error("Device does not support panel fill");

  const { width, height, minRow, minCol, keySize, buttons } = layout;
  const keyRgb = new Map();

  const tasks = buttons.map((control) => async () => {
    const keyDef = page.keys.get(control.index);
    try {
      if (keyDef) {
        const rgb = await renderKeyImage(keyDef, cardsCache, keySize);
        keyRgb.set(control.index, rgb);
      } else {
        keyRgb.set(control.index, solidKeyRgb(keySize, 0, 0, 0));
      }
    } catch {
      const [r, g, b] = keyDef
        ? getIconColorForKeyDef(keyDef)
        : [0, 0, 0];
      keyRgb.set(control.index, solidKeyRgb(keySize, r, g, b));
    }
  });

  await runPool(tasks, concurrency);

  const sharp = (await import("sharp")).default;
  const composites = buttons.map((control) => {
    const rgb = keyRgb.get(control.index) || solidKeyRgb(keySize, 0, 0, 0);
    const left = (control.column - minCol) * keySize;
    const top = (control.row - minRow) * keySize;
    return {
      input: Buffer.from(rgb),
      raw: { width: keySize, height: keySize, channels: 3 },
      left,
      top,
    };
  });

  return sharp({
    create: { width, height, channels: 3, background: { r: 0, g: 0, b: 0 } },
  })
    .composite(composites)
    .removeAlpha()
    .raw({ channels: 3 })
    .toBuffer();
}
