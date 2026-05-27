import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { describe, expect, it } from "vitest";
import { z } from "zod";

import { BROWSER_LAB_MCP_TOOLS } from "./browserLabTools.ts";

function tool(name: string) {
  const match = BROWSER_LAB_MCP_TOOLS.find((candidate) => candidate.name === name);
  if (!match) throw new Error(`Missing tool ${name}`);
  return match;
}

function toolInputSchema(name: string) {
  return z.object(tool(name).inputSchema);
}

describe("Browser Lab MCP tools", () => {
  it("declares an input schema for every tool", () => {
    expect(BROWSER_LAB_MCP_TOOLS).toHaveLength(38);
    expect(BROWSER_LAB_MCP_TOOLS.every((entry) => entry.inputSchema)).toBe(true);
  });

  it("validates the Browser Lab navigation shape", () => {
    expect(
      toolInputSchema("browser_lab_navigate").safeParse({ url: "http://localhost:8082" }),
    ).toMatchObject({
      success: true,
    });
    expect(
      toolInputSchema("browser_lab_navigate").safeParse({ target: "http://localhost:8082" }),
    ).toMatchObject({
      success: false,
    });
  });

  it("keeps supported top-level rule fields for desktop compatibility", () => {
    const parsed = toolInputSchema("traffic_lens_upsert_rule").safeParse({
      name: "Pause API",
      enabled: true,
      phase: "beforeRequest",
      action: "pause",
      scope: { urlPattern: "*/api/*" },
    });

    expect(parsed).toMatchObject({ success: true });
    if (!parsed.success) return;
    expect(parsed.data).toMatchObject({
      name: "Pause API",
      enabled: true,
      phase: "beforeRequest",
      action: "pause",
      scope: { urlPattern: "*/api/*" },
    });
  });

  it("advertises concrete input schemas over MCP", async () => {
    const transport = new StdioClientTransport({
      command: "bun",
      args: ["run", "src/mcp/browserLabRunner.ts"],
      env: {
        ...process.env,
        FENRIR_MCP_BACKEND_URL: "http://127.0.0.1:9",
        FENRIR_MCP_TOKEN: "test-token",
      },
    });
    const client = new Client({ name: "browser-lab-tools-test", version: "0.0.0" });

    try {
      await client.connect(transport);
      const result = await client.listTools();
      const navigate = result.tools.find((entry) => entry.name === "browser_lab_navigate");

      expect(navigate?.inputSchema).toMatchObject({
        type: "object",
        properties: {
          url: { type: "string" },
          tabId: { type: "string" },
        },
        required: ["url"],
      });
    } finally {
      await client.close();
    }
  });
});
