/**
 * Apply a downloaded patch on Windows (called by Update Riftbound.bat after server exit).
 */
import { spawn, execSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  cpSync,
  createReadStream,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { homedir, platform } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const installRoot = process.argv[2] ? process.argv[2].replace(/\\$/, "") : process.cwd();

function updatesDir() {
  if (platform() === "win32") {
    const appData = process.env.APPDATA || join(homedir(), "AppData", "Roaming");
    return join(appData, "RiftboundOBS", "updates");
  }
  return join(homedir(), ".config", "riftbound-obs", "updates");
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
    console.log("No streamdeck-plugin in patch — skipping.");
    return;
  }
  const appData = process.env.APPDATA || join(homedir(), "AppData", "Roaming");
  const dest = join(appData, "Elgato", "StreamDeck", "Plugins", "com.riftbound.obs.sdPlugin");
  rmSync(dest, { recursive: true, force: true });
  cpSync(src, dest, { recursive: true });
  console.log("Stream Deck plugin installed →", dest);
}

function runNpmCi(installRootDir) {
  const nodeExe = join(installRootDir, "node", "node.exe");
  if (!existsSync(nodeExe)) {
    console.log("Bundled node not found — skipping npm ci.");
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

function copyTree(src, dest) {
  if (!existsSync(src)) return;
  rmSync(dest, { recursive: true, force: true });
  cpSync(src, dest, { recursive: true });
}

async function main() {
  const pendingPath = join(updatesDir(), "pending.json");
  if (!existsSync(pendingPath)) {
    console.error("No pending update (missing pending.json).");
    process.exit(1);
  }

  const pending = JSON.parse(readFileSync(pendingPath, "utf8"));
  const zipPath = pending.patchZip;
  if (!existsSync(zipPath)) {
    console.error("Patch zip not found:", zipPath);
    process.exit(1);
  }

  if (pending.sha256) {
    const hash = await sha256File(zipPath);
    if (hash !== pending.sha256) {
      console.error("SHA256 mismatch — aborting.");
      process.exit(1);
    }
  }

  const extractDir = join(updatesDir(), "extract");
  rmSync(extractDir, { recursive: true, force: true });
  console.log("Extracting patch…");
  expandZip(zipPath, extractDir);

  const oldLock = existsSync(join(installRoot, "package-lock.json"))
    ? readFileSync(join(installRoot, "package-lock.json"), "utf8")
    : null;
  const newLockPath = join(extractDir, "package-lock.json");
  const newLock = existsSync(newLockPath) ? readFileSync(newLockPath, "utf8") : null;
  const depsChanged = Boolean(newLock && newLock !== oldLock);

  console.log("Copying files to", installRoot);
  copyTree(join(extractDir, "server"), join(installRoot, "server"));
  copyTree(join(extractDir, "public"), join(installRoot, "public"));
  copyTree(join(extractDir, "streamdeck-plugin"), join(installRoot, "streamdeck-plugin"));

  for (const name of ["package.json", "package-lock.json"]) {
    const src = join(extractDir, name);
    if (existsSync(src)) cpSync(src, join(installRoot, name));
  }

  for (const bat of [
    "Start Riftbound.bat",
    "Update Riftbound.bat",
    "Install Stream Deck plugin.bat",
    "Import Stream Deck profile.bat",
  ]) {
    const src = join(extractDir, bat);
    if (existsSync(src)) cpSync(src, join(installRoot, bat));
  }

  if (pending.depsChanged || depsChanged) {
    console.log("Dependencies changed — running npm ci…");
    runNpmCi(installRoot);
  }

  installStreamDeckPlugin(installRoot);

  rmSync(pendingPath, { force: true });
  writeFileSync(
    join(updatesDir(), "last-update.json"),
    JSON.stringify({ version: pending.version, appliedAt: new Date().toISOString() }, null, 2)
  );

  console.log("Update applied successfully.");
  if (pending.restart) {
    const startBat = join(installRoot, "Start Riftbound.bat");
    if (existsSync(startBat)) {
      console.log("Restarting app…");
      spawn("cmd.exe", ["/c", "start", '""', startBat], {
        detached: true,
        stdio: "ignore",
        cwd: installRoot,
      }).unref();
    }
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
