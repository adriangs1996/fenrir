import { existsSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { DEFAULT_PORT, type ServerConfigShape } from "../config";

const browserLabMcpToken = randomBytes(32).toString("hex");

export function getBrowserLabMcpToken(): string {
  return browserLabMcpToken;
}

export function getBrowserLabMcpBackendUrl(config?: Pick<ServerConfigShape, "port">): string {
  return `http://127.0.0.1:${config?.port ?? DEFAULT_PORT}`;
}

export function resolveBrowserLabMcpRunnerPath(): string {
  const dir = dirname(fileURLToPath(import.meta.url));
  const candidates = [
    join(dir, "mcp", "browserLabRunner.mjs"),
    join(dir, "mcp", "browserLabRunner.js"),
    join(dir, "mcp", "browserLabRunner.cjs"),
    join(dir, "browserLabRunner.ts"),
    join(dir, "browserLabRunner.js"),
    join(dir, "browserLabRunner.mjs"),
    join(dir, "browserLabRunner.cjs"),
  ];
  return candidates.find((candidate) => existsSync(candidate)) ?? candidates[0]!;
}

export function getBrowserLabMcpRunnerEnv(): Record<string, string> {
  return process.env.ELECTRON_RUN_AS_NODE
    ? { ELECTRON_RUN_AS_NODE: process.env.ELECTRON_RUN_AS_NODE }
    : {};
}
