/**
 * Route pending update to patch apply or installer apply.
 */
import { pathToFileURL } from "node:url";
import { reexecUpdateFromRunnerIfNeeded } from "./update-reexec.js";

async function main() {
  const { existsSync, readFileSync } = await import("node:fs");
  const { pendingPath } = await import("./update-utils.js");

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
  reexecUpdateFromRunnerIfNeeded()
    .then((reexecuted) => {
      if (reexecuted) {
        process.exit(0);
        return;
      }
      return main();
    })
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}
