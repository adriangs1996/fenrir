import { randomBytes } from "node:crypto";

import { DEFAULT_PORT, type ServerConfigShape } from "../config";
import { getElectronNodeRunnerEnv, resolveMcpRunnerPath } from "./mcpRunnerRuntime.ts";

const remoteHostMcpToken = randomBytes(32).toString("hex");

export function getRemoteHostMcpToken(): string {
  return remoteHostMcpToken;
}

export function getRemoteHostMcpBackendUrl(config?: Pick<ServerConfigShape, "port">): string {
  return `http://127.0.0.1:${config?.port ?? DEFAULT_PORT}`;
}

export function resolveRemoteHostMcpRunnerPath(): string {
  return resolveMcpRunnerPath(import.meta.url, "remoteHostRunner");
}

export function getRemoteHostMcpRunnerEnv(): Record<string, string> {
  return getElectronNodeRunnerEnv();
}
