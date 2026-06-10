import * as FS from "node:fs";
import * as Path from "node:path";

/** Read and parse a JSON file. Returns `null` when missing or unparseable. */
export function readJsonFile<T>(filePath: string): T | null {
  try {
    if (!FS.existsSync(filePath)) {
      return null;
    }
    return JSON.parse(FS.readFileSync(filePath, "utf8")) as T;
  } catch {
    return null;
  }
}

/**
 * Write JSON through a temp file + rename so readers never observe a
 * partially written file. Creates the parent directory when missing.
 */
export function writeJsonFileAtomic(filePath: string, value: unknown): void {
  const directory = Path.dirname(filePath);
  const tempPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  FS.mkdirSync(directory, { recursive: true });
  FS.writeFileSync(tempPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  FS.renameSync(tempPath, filePath);
}
