/**
 * Route pending update to patch apply or installer apply.
 */
import { pathToFileURL } from "node:url";
import { existsSync, readFileSync } from "node:fs";
import { pendingPath } from "./update-utils.js";

async function main() {
  if (!existsSync(pendingPath())) {
    console.error("No pending update.");
    process.exit(1);
  }
  const pending = JSON.parse(readFileSync(pendingPath(), "utf8"));
  if (pending.mode === "installer") {
    const { mainFromCli } = await import("./update-installer.js");
    await mainFromCli();
    return;
  }
  const { runPatchApply } = await import("./update-apply.js");
  await runPatchApply();
}

const isCli =
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href;

if (isCli) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
