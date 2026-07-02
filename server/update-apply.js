/**
 * Apply a downloaded patch on Windows (called by Update Riftbound.bat after server exit).
 */
import { spawn, execSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  appendFileSync,
  cpSync,
  createReadStream,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { homedir, platform } from "node:os";
import { join } from "node:path";

function normalizePath(p) {
  if (!p || typeof p !== "string") return process.cwd();
  return p.replace(/^["']+|["']+$/g, "").replace(/[\\/]+$/, "");
}

function updatesDir() {
  if (platform() === "win32") {
    const appData = process.env.APPDATA || join(homedir(), "AppData", "Roaming");
    return join(appData, "RiftboundOBS", "updates");
  }
  return join(homedir(), ".config", "riftbound-obs", "updates");
}

function logPath() {
  return join(updatesDir(), "update.log");
}

function log(message) {
  const line = `[${new Date().toISOString()}] ${message}`;
  console.log(line);
  try {
    mkdirSync(updatesDir(), { recursive: true });
    appendFileSync(logPath(), `${line}\n`, "utf8");
  } catch {
    /* ignore logging failures */
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function sha256File(filePath) {
  return new Promise((resolve, reject) => {
    const hash = createHash("sha256");
    createReadStream(filePath)
      .on("data", (c) => hash.update(c))
      .on("error", reject)
      .on("end", () => resolve(hash.digest("hex")));
  });
}

function expandZip(zipPath, destDir) {
  if (platform() !== "win32") {
    execSync(`unzip -q -o "${zipPath}" -d "${destDir}"`, { stdio: "inherit" });
    return;
  }
  mkdirSync(destDir, { recursive: true });
  execSync(
    `powershell -NoProfile -Command "Expand-Archive -LiteralPath '${zipPath.replace(/'/g, "''")}' -DestinationPath '${destDir.replace(/'/g, "''")}' -Force"`,
    { stdio: "inherit" }
  );
}

function installStreamDeckPlugin(installRootDir) {
  const src = join(installRootDir, "streamdeck-plugin", "com.riftbound.obs.sdPlugin");
  if (!existsSync(src)) {
    log("No streamdeck-plugin in patch — skipping.");
    return;
  }
  const appData = process.env.APPDATA || join(homedir(), "AppData", "Roaming");
  const dest = join(appData, "Elgato", "StreamDeck", "Plugins", "com.riftbound.obs.sdPlugin");
  rmSync(dest, { recursive: true, force: true });
  cpSync(src, dest, { recursive: true });
  log(`Stream Deck plugin installed → ${dest}`);
}

function runNpmCi(installRootDir) {
  const nodeExe = join(installRootDir, "node", "node.exe");
  if (!existsSync(nodeExe)) {
    log("Bundled node not found — skipping npm ci.");
    return;
  }
  const npmCli = join(installRootDir, "node_modules", "npm", "bin", "npm-cli.js");
  if (existsSync(npmCli)) {
    execSync(`"${nodeExe}" "${npmCli}" ci --omit=dev`, { cwd: installRootDir, stdio: "inherit" });
    return;
  }
  execSync(`"${nodeExe}" -e "require('child_process').execSync('npm ci --omit=dev',{stdio:'inherit'})"`, {
    cwd: installRootDir,
    stdio: "inherit",
    shell: true,
  });
}

async function copyTreeWithRetry(src, dest, attempts = 8) {
  if (!existsSync(src)) return;
  let lastErr;
  for (let i = 0; i < attempts; i++) {
    try {
      rmSync(dest, { recursive: true, force: true });
      cpSync(src, dest, { recursive: true });
      return;
    } catch (err) {
      lastErr = err;
      log(`Copy retry ${i + 1}/${attempts} for ${src}: ${err.message}`);
      if (i < attempts - 1) await sleep(1000);
    }
  }
  throw lastErr;
}

async function copyFileWithRetry(src, dest, attempts = 8) {
  if (!existsSync(src)) return;
  let lastErr;
  for (let i = 0; i < attempts; i++) {
    try {
      cpSync(src, dest);
      return;
    } catch (err) {
      lastErr = err;
      log(`File copy retry ${i + 1}/${attempts} for ${src}: ${err.message}`);
      if (i < attempts - 1) await sleep(1000);
    }
  }
  throw lastErr;
}

function restartApp(installRoot) {
  const startBat = join(installRoot, "Start Riftbound.bat");
  if (!existsSync(startBat)) {
    log(`Start Riftbound.bat not found in ${installRoot}`);
    return;
  }
  log(`Restarting app → ${startBat}`);
  spawn("cmd.exe", ["/c", "start", "Riftbound OBS", "/D", installRoot, startBat], {
    detached: true,
    stdio: "ignore",
    windowsHide: false,
  }).unref();
}

async function main() {
  mkdirSync(updatesDir(), { recursive: true });
  writeFileSync(logPath(), `[${new Date().toISOString()}] --- update start ---\n`, "utf8");

  const pendingPath = join(updatesDir(), "pending.json");
  if (!existsSync(pendingPath)) {
    log("No pending update (missing pending.json).");
    process.exit(1);
  }

  const pending = JSON.parse(readFileSync(pendingPath, "utf8"));
  const installRoot = normalizePath(pending.installRoot || process.cwd());
  log(`Install root: ${installRoot}`);
  if (!existsSync(installRoot)) {
    log(`Install folder not found: ${installRoot}`);
    process.exit(1);
  }

  const zipPath = pending.patchZip;
  if (!existsSync(zipPath)) {
    log(`Patch zip not found: ${zipPath}`);
    process.exit(1);
  }

  if (pending.sha256) {
    const hash = await sha256File(zipPath);
    if (hash !== pending.sha256) {
      log("SHA256 mismatch — aborting.");
      process.exit(1);
    }
  }

  const extractDir = join(updatesDir(), "extract");
  rmSync(extractDir, { recursive: true, force: true });
  log("Extracting patch…");
  expandZip(zipPath, extractDir);

  const oldLock = existsSync(join(installRoot, "package-lock.json"))
    ? readFileSync(join(installRoot, "package-lock.json"), "utf8")
    : null;
  const newLockPath = join(extractDir, "package-lock.json");
  const newLock = existsSync(newLockPath) ? readFileSync(newLockPath, "utf8") : null;
  const depsChanged = Boolean(newLock && newLock !== oldLock);

  log(`Copying files to ${installRoot}`);
  await copyTreeWithRetry(join(extractDir, "server"), join(installRoot, "server"));
  await copyTreeWithRetry(join(extractDir, "public"), join(installRoot, "public"));
  await copyTreeWithRetry(join(extractDir, "streamdeck-plugin"), join(installRoot, "streamdeck-plugin"));

  for (const name of ["package.json", "package-lock.json"]) {
    const src = join(extractDir, name);
    if (existsSync(src)) await copyFileWithRetry(src, join(installRoot, name));
  }

  for (const bat of [
    "Start Riftbound.bat",
    "Update Riftbound.bat",
    "Install Stream Deck plugin.bat",
    "Import Stream Deck profile.bat",
  ]) {
    const src = join(extractDir, bat);
    if (existsSync(src)) await copyFileWithRetry(src, join(installRoot, bat));
  }

  if (pending.depsChanged || depsChanged) {
    log("Dependencies changed — running npm ci…");
    runNpmCi(installRoot);
  }

  installStreamDeckPlugin(installRoot);

  rmSync(pendingPath, { force: true });
  writeFileSync(
    join(updatesDir(), "last-update.json"),
    JSON.stringify({ version: pending.version, appliedAt: new Date().toISOString() }, null, 2)
  );

  log(`Update applied successfully (v${pending.version}).`);
  if (pending.restart) {
    restartApp(installRoot);
  }
}

main().catch((err) => {
  log(`Update failed: ${err.stack || err.message}`);
  process.exit(1);
});
