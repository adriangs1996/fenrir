import { randomBytes } from "node:crypto";

import { DEFAULT_PORT, type ServerConfigShape } from "../config";
import { getElectronNodeRunnerEnv, resolveMcpRunnerPath } from "./mcpRunnerRuntime.ts";

const workflowMcpToken = randomBytes(32).toString("hex");

export function getWorkflowMcpToken(): string {
  return workflowMcpToken;
}

export function getWorkflowMcpBackendUrl(config?: Pick<ServerConfigShape, "port">): string {
  return `http://127.0.0.1:${config?.port ?? DEFAULT_PORT}`;
}

export function resolveWorkflowMcpRunnerPath(): string {
  return resolveMcpRunnerPath(import.meta.url, "workflowRunner");
}

export function getWorkflowMcpRunnerEnv(): Record<string, string> {
  return getElectronNodeRunnerEnv();
}
