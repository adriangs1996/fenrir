import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export function resolveMcpRunnerPath(moduleUrl: string, runnerBaseName: string): string {
  const dir = dirname(fileURLToPath(moduleUrl));
  const candidates = [
    join(dir, "mcp", `${runnerBaseName}.mjs`),
    join(dir, "mcp", `${runnerBaseName}.js`),
    join(dir, "mcp", `${runnerBaseName}.cjs`),
    join(dir, `${runnerBaseName}.ts`),
    join(dir, `${runnerBaseName}.js`),
    join(dir, `${runnerBaseName}.mjs`),
    join(dir, `${runnerBaseName}.cjs`),
  ];
  const resolved = candidates.find((candidate) => existsSync(candidate));
  if (resolved) {
    return resolved;
  }
  throw new Error(
    `Could not find MCP runner '${runnerBaseName}'. Checked: ${candidates.join(", ")}`,
  );
}

export function getElectronNodeRunnerEnv(): Record<string, string> {
  return process.env.ELECTRON_RUN_AS_NODE
    ? { ELECTRON_RUN_AS_NODE: process.env.ELECTRON_RUN_AS_NODE }
    : {};
}
