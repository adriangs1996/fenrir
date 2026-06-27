import { randomUUID } from "node:crypto";

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import type { ZodRawShapeCompat } from "@modelcontextprotocol/sdk/server/zod-compat.js";

import {
  formatWorkflowToolResult,
  workflowMcpToolsForMode,
  type WorkflowMcpMode,
} from "./workflowTools.ts";

const backendUrl = process.env.FENRIR_MCP_BACKEND_URL?.trim();
const token = process.env.FENRIR_MCP_TOKEN?.trim();
const projectId = process.env.FENRIR_MCP_WORKFLOW_PROJECT_ID?.trim();
const originThreadId = process.env.FENRIR_MCP_WORKFLOW_THREAD_ID?.trim();
const workflowRunId = process.env.FENRIR_MCP_WORKFLOW_RUN_ID?.trim();
const agentName = process.env.FENRIR_MCP_WORKFLOW_AGENT_NAME?.trim();
const mcpSessionId = randomUUID();
const mode: WorkflowMcpMode =
  process.env.FENRIR_MCP_WORKFLOW_MODE?.trim() === "collaboration" ? "collaboration" : "management";

if (
  !backendUrl ||
  !token ||
  !projectId ||
  !originThreadId ||
  (mode === "collaboration" && (!workflowRunId || !agentName))
) {
  console.error(
    "Workflow MCP runner missing required FENRIR_MCP_* environment for the selected mode.",
  );
  process.exit(1);
}

async function callTool(toolName: string, input: unknown): Promise<unknown> {
  const response = await fetch(`${backendUrl}/api/internal/mcp/workflows/call`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      toolName,
      input,
      projectId,
      originThreadId,
      mcpSessionId,
      mode,
      ...(workflowRunId ? { workflowRunId } : {}),
      ...(agentName ? { agentName } : {}),
    }),
  });
  const body = (await response.json().catch(() => null)) as {
    ok?: boolean;
    error?: unknown;
    result?: unknown;
  } | null;
  if (!response.ok || !body?.ok) {
    throw new Error(
      typeof body?.error === "string"
        ? body.error
        : `Workflow MCP call failed with HTTP ${response.status}.`,
    );
  }
  return body.result;
}

const server = new McpServer({
  name: "fenrir-workflows",
  version: "0.1.0",
});

for (const tool of workflowMcpToolsForMode(mode)) {
  server.registerTool(
    tool.name,
    {
      description: tool.description,
      inputSchema: tool.inputSchema as unknown as ZodRawShapeCompat,
    },
    async (input: unknown) => {
      const result = await callTool(tool.name, input);
      return formatWorkflowToolResult(result);
    },
  );
}

async function main(): Promise<void> {
  await server.connect(new StdioServerTransport());
}

void main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
