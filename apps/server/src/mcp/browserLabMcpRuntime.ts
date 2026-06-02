import { randomBytes } from "node:crypto";

import { DEFAULT_PORT, type ServerConfigShape } from "../config";
import { getElectronNodeRunnerEnv, resolveMcpRunnerPath } from "./mcpRunnerRuntime.ts";

const browserLabMcpToken = randomBytes(32).toString("hex");

export function getBrowserLabMcpToken(): string {
  return browserLabMcpToken;
}

export function getBrowserLabMcpBackendUrl(config?: Pick<ServerConfigShape, "port">): string {
  return `http://127.0.0.1:${config?.port ?? DEFAULT_PORT}`;
}

export function resolveBrowserLabMcpRunnerPath(): string {
  return resolveMcpRunnerPath(import.meta.url, "browserLabRunner");
}

export function getBrowserLabMcpRunnerEnv(): Record<string, string> {
  return getElectronNodeRunnerEnv();
}
