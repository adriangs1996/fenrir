import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { describe, expect, it } from "vitest";
import { z } from "zod";

import { BROWSER_LAB_MCP_TOOLS, formatBrowserLabToolResult } from "./browserLabTools.ts";

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
    expect(BROWSER_LAB_MCP_TOOLS).toHaveLength(50);
    expect(BROWSER_LAB_MCP_TOOLS.every((entry) => entry.inputSchema)).toBe(true);
  });

  it("validates the Browser Lab navigation shape", () => {
    expect(
      toolInputSchema("browser_lab_navigate").safeParse({ url: "http://localhost:8082" }),
    ).toMatchObject({
      success: true,
    });
    expect(
      toolInputSchema("browser_lab_navigate").safeParse({
        url: "file:///Users/adrian/demo.html",
      }),
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

  it("allows tabs to be created directly in a Browser Lab profile", () => {
    expect(
      toolInputSchema("browser_lab_create_tab").safeParse({
        url: "http://localhost:8082",
        profileId: "github-adrian",
      }),
    ).toMatchObject({
      success: true,
    });

    expect(
      toolInputSchema("browser_lab_create_tab_in_profile").safeParse({
        url: "http://localhost:8082",
      }),
    ).toMatchObject({
      success: false,
    });
  });

  it("exposes profile management schemas for persistent browser sessions", () => {
    expect(
      toolInputSchema("traffic_lens_create_profile").safeParse({
        name: "GitHub Adrian",
        notes: "Logged into the development GitHub account.",
      }),
    ).toMatchObject({
      success: true,
    });

    expect(
      toolInputSchema("traffic_lens_update_profile").safeParse({
        id: "github-adrian",
        partitionKey: "persist:traffic-lens:github-adrian",
      }),
    ).toMatchObject({
      success: true,
    });
  });

  it("exposes profile-scoped cookie and storage tools", () => {
    expect(
      toolInputSchema("traffic_lens_get_cookies_for_origin").safeParse({
        profileId: "github-adrian",
        origin: "https://github.com",
      }),
    ).toMatchObject({
      success: true,
    });

    expect(
      toolInputSchema("traffic_lens_set_cookie_for_origin").safeParse({
        profileId: "github-adrian",
        url: "https://github.com",
        name: "logged_in",
        value: "yes",
        sameSite: "lax",
      }),
    ).toMatchObject({
      success: true,
    });
  });

  it("formats Browser Lab screenshots as image MCP content with a Fenrir handle", () => {
    const result = formatBrowserLabToolResult("browser_lab_screenshot", {
      data: " SGVsbG8= \n",
      mimeType: "IMAGE/PNG",
    });

    expect(result.content[0]).toEqual({ type: "image", data: "SGVsbG8=", mimeType: "image/png" });
    expect(result.content[1]).toMatchObject({ type: "text" });
    expect((result.content[1] as { text?: string }).text).toMatch(
      /^Fenrir image handle: fenrir-image:\/\/browser-lab-/,
    );
    expect(result.structuredContent).toMatchObject({
      fenrirImageHandles: [
        {
          name: "browser-lab-screenshot.png",
          mimeType: "image/png",
        },
      ],
    });
  });

  it("formats stored Browser Lab image handles with their existing artifact id", () => {
    const result = formatBrowserLabToolResult("browser_lab_open_image", {
      artifactId: "browser-lab-existing",
      data: "SGVsbG8=",
      mimeType: "image/png",
      name: "browser-lab-screenshot.png",
    });

    expect(result.structuredContent).toMatchObject({
      fenrirImageHandles: [
        {
          id: "browser-lab-existing",
          uri: "fenrir-image://browser-lab-existing",
          name: "browser-lab-screenshot.png",
          mimeType: "image/png",
        },
      ],
    });
  });

  it("rejects empty Browser Lab screenshot bytes before they reach Codex", () => {
    expect(() =>
      formatBrowserLabToolResult("browser_lab_screenshot", {
        data: "",
        mimeType: "image/png",
      }),
    ).toThrow("empty or invalid image data");
  });

  it("rejects non-image Browser Lab screenshot MIME types", () => {
    expect(() =>
      formatBrowserLabToolResult("browser_lab_screenshot", {
        data: "SGVsbG8=",
        mimeType: "text/plain",
      }),
    ).toThrow("non-image MIME type");
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
