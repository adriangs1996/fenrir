import { existsSync, mkdtempSync, readdirSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { $ } from "bun";

const log = (message: string) => console.log(`[install-desktop-mac] ${message}`);

const APP_NAME = "Fenrir.app";
const DEST = `/Applications/${APP_NAME}`;

const arch = process.argv[2] ?? "arm64";
if (arch !== "arm64" && arch !== "x64") {
  console.error(`[install-desktop-mac] Unsupported arch '${arch}'. Use 'arm64' or 'x64'.`);
  process.exit(1);
}
if (process.platform !== "darwin") {
  console.error("[install-desktop-mac] macOS only.");
  process.exit(1);
}

const repoRoot = resolve(import.meta.dirname, "..");
const releaseDir = join(repoRoot, "release");

const findLatestDmg = (): string => {
  if (!existsSync(releaseDir)) {
    throw new Error(`Release dir not found: ${releaseDir}. Run dist:desktop:dmg:${arch} first.`);
  }
  const suffix = `-${arch}.dmg`;
  const candidates = readdirSync(releaseDir)
    .filter((f) => f.endsWith(suffix))
    .map((f) => join(releaseDir, f))
    .map((p) => ({ path: p, mtime: statSync(p).mtimeMs }))
    .toSorted((a, b) => b.mtime - a.mtime);
  if (candidates.length === 0) {
    throw new Error(`No *${suffix} found in ${releaseDir}.`);
  }
  return candidates[0]!.path;
};

const quitRunningApp = async () => {
  const pgrep = await $`pgrep -x Fenrir`.nothrow().quiet();
  if (pgrep.exitCode !== 0) return;
  log("Quitting running Fenrir...");
  await $`osascript -e ${'tell application "Fenrir" to quit'}`.nothrow().quiet();
  await Bun.sleep(1000);
  await $`pkill -x Fenrir`.nothrow().quiet();
};

const dmg = findLatestDmg();
log(`Installing from: ${dmg}`);

await quitRunningApp();

const mountPoint = mkdtempSync(join(tmpdir(), "fenrir-dmg-"));
const detach = async () => {
  await $`hdiutil detach ${mountPoint} -quiet`.nothrow().quiet();
  try {
    rmSync(mountPoint, { recursive: true, force: true });
  } catch {}
};

try {
  await $`hdiutil attach ${dmg} -nobrowse -readonly -mountpoint ${mountPoint}`.quiet();

  const src = join(mountPoint, APP_NAME);
  if (!existsSync(src)) {
    throw new Error(`${APP_NAME} not found inside DMG at ${src}`);
  }

  if (existsSync(DEST)) {
    log(`Removing existing ${DEST}`);
    rmSync(DEST, { recursive: true, force: true });
  }

  log(`Copying to ${DEST}`);
  await $`cp -R ${src} ${DEST}`;
  await $`xattr -dr com.apple.quarantine ${DEST}`.nothrow().quiet();

  const versionResult = await $`defaults read ${`${DEST}/Contents/Info`} CFBundleShortVersionString`
    .nothrow()
    .quiet();
  const version = versionResult.exitCode === 0 ? versionResult.stdout.toString().trim() : "?";
  log(`Done. Installed Fenrir ${version} at ${DEST}`);
} finally {
  await detach();
}
