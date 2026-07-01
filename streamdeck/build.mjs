import { build } from "esbuild";
import { cpSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = dirname(fileURLToPath(import.meta.url));
const OUT = join(ROOT, "com.riftbound.obs.sdPlugin", "bin");

mkdirSync(OUT, { recursive: true });

await build({
  entryPoints: [join(ROOT, "src", "plugin.ts")],
  bundle: true,
  outfile: join(OUT, "plugin.js"),
  platform: "node",
  format: "cjs",
  target: "node20",
  sourcemap: true,
  logLevel: "info",
});

console.log("Stream Deck plugin built → com.riftbound.obs.sdPlugin/bin/plugin.js");
