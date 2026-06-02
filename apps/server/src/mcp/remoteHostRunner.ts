import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import type { ZodRawShapeCompat } from "@modelcontextprotocol/sdk/server/zod-compat.js";

import { formatRemoteHostToolResult, REMOTE_HOST_MCP_TOOLS } from "./remoteHostTools.ts";

const backendUrl = process.env.FENRIR_MCP_BACKEND_URL?.trim();
const token = process.env.FENRIR_MCP_TOKEN?.trim();

if (!backendUrl || !token) {
  console.error("Remote Host MCP runner missing FENRIR_MCP_BACKEND_URL or FENRIR_MCP_TOKEN.");
  process.exit(1);
}

async function callTool(toolName: string, input: unknown): Promise<unknown> {
  const response = await fetch(`${backendUrl}/api/internal/mcp/remote-host/call`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ toolName, input }),
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
        : `Remote Host MCP call failed with HTTP ${response.status}.`,
    );
  }
  return body.result;
}

const server = new McpServer({
  name: "fenrir-remote-host",
  version: "0.1.0",
});

for (const tool of REMOTE_HOST_MCP_TOOLS) {
  server.registerTool(
    tool.name,
    {
      description: tool.description,
      inputSchema: tool.inputSchema as unknown as ZodRawShapeCompat,
    },
    async (input: unknown) => {
      const result = await callTool(tool.name, input);
      return formatRemoteHostToolResult(result);
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
