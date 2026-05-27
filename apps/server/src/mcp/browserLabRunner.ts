#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { BROWSER_LAB_MCP_TOOLS, truncateBrowserLabToolResult } from "./browserLabTools.ts";

const backendUrl = process.env.FENRIR_MCP_BACKEND_URL?.trim();
const token = process.env.FENRIR_MCP_TOKEN?.trim();

if (!backendUrl || !token) {
  console.error("Browser Lab MCP runner missing FENRIR_MCP_BACKEND_URL or FENRIR_MCP_TOKEN.");
  process.exit(1);
}

async function callTool(toolName: string, input: unknown): Promise<unknown> {
  const response = await fetch(`${backendUrl}/api/internal/mcp/browser-lab/call`, {
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
        : `Browser Lab MCP call failed with HTTP ${response.status}.`,
    );
  }
  return body.result;
}

const server = new McpServer({
  name: "fenrir-browser-lab",
  version: "0.1.0",
});

for (const tool of BROWSER_LAB_MCP_TOOLS) {
  server.registerTool(
    tool.name,
    {
      description: tool.description,
      inputSchema: {},
    },
    async (input: unknown) => {
      const result = await callTool(tool.name, input);
      if (
        tool.name === "browser_lab_screenshot" &&
        result &&
        typeof result === "object" &&
        typeof (result as { data?: unknown }).data === "string"
      ) {
        return {
          content: [
            {
              type: "image",
              data: (result as { data: string }).data,
              mimeType:
                typeof (result as { mimeType?: unknown }).mimeType === "string"
                  ? (result as { mimeType: string }).mimeType
                  : "image/png",
            },
          ],
        };
      }
      return {
        content: [{ type: "text", text: truncateBrowserLabToolResult(result) }],
      };
    },
  );
}

await server.connect(new StdioServerTransport());
