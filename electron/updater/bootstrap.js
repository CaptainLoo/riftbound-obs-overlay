/**
 * Stable Electron updater entry (resources/updater — not patched).
 * Copies patchable server update scripts to AppData, then runs them detached.
 */
import { spawn } from "node:child_process";
import { cpSync, existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { homedir, platform } from "node:os";
import { dirname, join } from "node:path";

const UPDATE_SCRIPTS = [
  "update-router.js",
  "update-reexec.js",
  "update-apply.js",
  "update-installer.js",
  "update-utils.js",
  "launcher.js",
  "paths.js",
  "version.js",
];

function runnerDir() {
  const appData = process.env.APPDATA || join(homedir(), "AppData", "Roaming");
  return join(appData, "RiftboundOBS", "updates", "runner");
}

async function main() {
  if (platform() !== "win32") {
    console.error("Updater bootstrap: Windows only.");
    process.exit(1);
  }

  const installRoot = (process.env.RIFTBOUND_INSTALL_ROOT || dirname(process.execPath)).replace(
    /[\\/]+$/,
    ""
  );
  const serverDir = join(installRoot, "resources", "riftbound", "server");
  if (!existsSync(serverDir)) {
    console.error(`Server folder not found: ${serverDir}`);
    process.exit(1);
  }

  const outDir = runnerDir();
  rmSync(outDir, { recursive: true, force: true });
  mkdirSync(outDir, { recursive: true });
  writeFileSync(join(outDir, "package.json"), '{"type":"module"}\n', "utf8");

  for (const name of UPDATE_SCRIPTS) {
    const src = join(serverDir, name);
    if (!existsSync(src)) {
      console.error(`Missing update script: ${src}`);
      process.exit(1);
    }
    cpSync(src, join(outDir, name));
  }

  const child = spawn(process.execPath, [join(outDir, "update-router.js")], {
    detached: true,
    stdio: "ignore",
    cwd: installRoot,
    env: {
      ...process.env,
      ELECTRON_RUN_AS_NODE: "1",
      RIFTBOUND_ELECTRON: "1",
      RIFTBOUND_INSTALL_ROOT: installRoot,
      RIFTBOUND_UPDATE_RUNNER: "1",
    },
    windowsHide: false,
  });
  child.unref();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
