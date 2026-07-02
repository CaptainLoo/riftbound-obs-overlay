/**
 * Stable Electron updater entry (resources/updater — not patched).
 * Copies patchable server update scripts to AppData, then runs them detached.
 */
import { spawn } from "node:child_process";
import { appendFileSync, cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir, platform } from "node:os";
import { dirname, join } from "node:path";

const UPDATE_SCRIPTS = [
  "update-router.js",
  "update-reexec.js",
  "update-apply.js",
  "update-installer.js",
  "update-utils.js",
  "update-shutdown.js",
  "update-preflight.js",
  "launcher.js",
  "paths.js",
  "version.js",
];

function updatesDir() {
  const appData = process.env.APPDATA || join(homedir(), "AppData", "Roaming");
  return join(appData, "RiftboundOBS", "updates");
}

function runnerDir() {
  return join(updatesDir(), "runner");
}

function bootstrapLog(message) {
  const line = `[${new Date().toISOString()}] [bootstrap] ${message}`;
  console.log(line);
  try {
    mkdirSync(updatesDir(), { recursive: true });
    appendFileSync(join(updatesDir(), "update.log"), `${line}\n`, "utf8");
  } catch {
    /* ignore */
  }
}

function writeBootstrapStatus(patch) {
  try {
    mkdirSync(updatesDir(), { recursive: true });
    const path = join(updatesDir(), "apply-status.json");
    const current = existsSync(path) ? JSON.parse(readFileSync(path, "utf8")) : {};
    writeFileSync(
      path,
      `${JSON.stringify({ ...current, ...patch, at: new Date().toISOString() }, null, 2)}\n`,
      "utf8"
    );
  } catch {
    /* ignore */
  }
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
    const msg = `Server folder not found: ${serverDir}`;
    console.error(msg);
    writeBootstrapStatus({ phase: "failed", message: msg, error: msg });
    process.exit(1);
  }

  bootstrapLog("Copying update scripts to AppData runner…");
  writeBootstrapStatus({ phase: "spawned", message: "Bootstrap copying update scripts…", error: null });

  const outDir = runnerDir();
  rmSync(outDir, { recursive: true, force: true });
  mkdirSync(outDir, { recursive: true });
  writeFileSync(join(outDir, "package.json"), '{"type":"module"}\n', "utf8");

  for (const name of UPDATE_SCRIPTS) {
    const src = join(serverDir, name);
    if (!existsSync(src)) {
      const msg = `Missing update script: ${src}`;
      console.error(msg);
      writeBootstrapStatus({ phase: "failed", message: msg, error: msg });
      process.exit(1);
    }
    cpSync(src, join(outDir, name));
  }

  bootstrapLog("Launching updater router from AppData…");
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
  writeBootstrapStatus({ phase: "failed", message: err.message, error: err.message });
  process.exit(1);
});
