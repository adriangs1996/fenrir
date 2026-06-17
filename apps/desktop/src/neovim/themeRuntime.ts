import * as FS from "node:fs";
import * as Path from "node:path";

import { app } from "electron";

import { EMBEDDED_NVIM_THEME_RUNTIME_FILES } from "./embeddedThemeRuntime";
import { FENRIR_DARK_THEME_RUNTIME_FILES } from "./fenrirDarkThemeRuntime";

const MANIFEST_FILE = ".fenrir-theme-runtime.json";

const EMBEDDED_THEME_RUNTIME_FILES = [
  ...FENRIR_DARK_THEME_RUNTIME_FILES,
  ...EMBEDDED_NVIM_THEME_RUNTIME_FILES,
] as const;

function runtimeDir(): string {
  return Path.join(app.getPath("userData"), "neovim", "theme-runtime");
}

function assertSafeRuntimePath(relativePath: string): void {
  if (
    relativePath.length === 0 ||
    Path.isAbsolute(relativePath) ||
    relativePath.split(/[\\/]/).includes("..")
  ) {
    throw new Error(`Unsafe embedded Neovim runtime path: ${relativePath}`);
  }
}

function readPreviousManifest(root: string): readonly string[] {
  const manifestPath = Path.join(root, MANIFEST_FILE);
  try {
    const parsed = JSON.parse(FS.readFileSync(manifestPath, "utf8")) as unknown;
    if (
      parsed &&
      typeof parsed === "object" &&
      Array.isArray((parsed as { files?: unknown }).files)
    ) {
      return (parsed as { files: unknown[] }).files.filter(
        (file): file is string => typeof file === "string",
      );
    }
  } catch {
    return [];
  }
  return [];
}

function writeIfChanged(filePath: string, contents: string): void {
  try {
    if (FS.existsSync(filePath) && FS.readFileSync(filePath, "utf8") === contents) {
      return;
    }
  } catch {
    // Fall through to rewrite the file.
  }

  FS.mkdirSync(Path.dirname(filePath), { recursive: true });
  const tempPath = `${filePath}.${process.pid}.tmp`;
  FS.writeFileSync(tempPath, contents, "utf8");
  FS.renameSync(tempPath, filePath);
}

export function ensureEmbeddedThemeRuntime(): string {
  const root = runtimeDir();
  FS.mkdirSync(root, { recursive: true });

  const nextFiles = new Set<string>();
  for (const file of EMBEDDED_THEME_RUNTIME_FILES) {
    assertSafeRuntimePath(file.path);
    nextFiles.add(file.path);
  }

  for (const previousPath of readPreviousManifest(root)) {
    if (nextFiles.has(previousPath)) {
      continue;
    }
    assertSafeRuntimePath(previousPath);
    try {
      FS.rmSync(Path.join(root, previousPath), { force: true });
    } catch {
      // Best-effort cleanup only.
    }
  }

  for (const file of EMBEDDED_THEME_RUNTIME_FILES) {
    writeIfChanged(Path.join(root, file.path), file.contents);
  }

  writeIfChanged(
    Path.join(root, MANIFEST_FILE),
    `${JSON.stringify({ files: [...nextFiles].toSorted() }, null, 2)}\n`,
  );

  return root;
}

export function createEmbeddedThemeRuntimeCommand(): string {
  const root = ensureEmbeddedThemeRuntime();
  const escapedRoot = JSON.stringify(root);
  return `lua vim.opt.runtimepath:prepend(${escapedRoot}); vim.opt.packpath:prepend(${escapedRoot})`;
}
