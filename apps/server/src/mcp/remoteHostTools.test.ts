import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { mkdir, realpath } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { it } from "@effect/vitest";
import type {
  RemoteCommandRunSnapshot,
  RemoteConnectionSnapshot,
  RemoteHostSnapshot,
} from "@fenrir/contracts";
import { Effect, Layer } from "effect";
import { describe, expect } from "vitest";
import { z } from "zod";

import { RemoteConnectionManagerLive } from "../puppeteer/Layers/RemoteConnectionManager.ts";
import { RemoteController } from "../puppeteer/Layers/RemoteController.ts";
import { RemoteControllerService } from "../puppeteer/Services/RemoteControllerService.ts";
import { callRemoteHostMcpTool } from "./remoteHostMcpHttp.ts";
import {
  formatRemoteHostToolResult,
  REMOTE_HOST_MCP_TOOLS,
  truncateRemoteHostToolResult,
} from "./remoteHostTools.ts";

const liveLayer = RemoteController.pipe(Layer.provide(RemoteConnectionManagerLive));

const localShellTransport = {
  type: "command-template",
  command: "sh",
  args: ["-lc", "{command}"],
} as const;

function tool(name: string) {
  const match = REMOTE_HOST_MCP_TOOLS.find((candidate) => candidate.name === name);
  if (!match) throw new Error(`Missing tool ${name}`);
  return match;
}

function toolInputSchema(name: string) {
  return z.object(tool(name).inputSchema);
}

describe("Remote Host MCP tools", () => {
  it("declares an input schema for every tool", () => {
    expect(REMOTE_HOST_MCP_TOOLS).toHaveLength(11);
    expect(REMOTE_HOST_MCP_TOOLS.every((entry) => entry.inputSchema)).toBe(true);
  });

  it("validates command-template host creation and command execution shapes", () => {
    expect(
      toolInputSchema("remote_host_create_host").safeParse({
        label: "HTB target",
        transport: {
          type: "command-template",
          command: "ssh",
          args: ["user@10.10.10.10", "sh -lc {command}"],
        },
      }),
    ).toMatchObject({ success: true });

    expect(
      toolInputSchema("remote_host_send_command").safeParse({
        connectionId: "remote-1",
        command: "whoami",
      }),
    ).toMatchObject({ success: true });

    expect(
      toolInputSchema("remote_host_send_command").safeParse({
        connectionId: "remote-1",
      }),
    ).toMatchObject({ success: false });
  });

  it("formats Remote Host MCP results as text content", () => {
    expect(formatRemoteHostToolResult({ ok: true })).toEqual({
      content: [{ type: "text", text: '{\n  "ok": true\n}' }],
    });
    expect(truncateRemoteHostToolResult("x".repeat(120_001))).toContain("truncated");
  });

  it.effect(
    "creates a host, starts a connection, sends commands, tracks path, and lists files through the MCP handler",
    () =>
      Effect.gen(function* () {
        if (process.platform === "win32") return;

        const tempDir = mkdtempSync(join(tmpdir(), "fenrir-remote-mcp-"));
        try {
          yield* Effect.promise(() => mkdir(join(tempDir, "src")));
          writeFileSync(join(tempDir, "src", "marker.txt"), "marker\n");

          const controller = yield* RemoteControllerService;
          const host = (yield* callRemoteHostMcpTool(controller, "remote_host_create_host", {
            label: "MCP local shell",
            transport: { ...localShellTransport, cwd: tempDir },
          })) as RemoteHostSnapshot;
          const connection = (yield* callRemoteHostMcpTool(
            controller,
            "remote_host_start_connection",
            {
              hostId: host.hostId,
            },
          )) as RemoteConnectionSnapshot;
          const run = (yield* callRemoteHostMcpTool(controller, "remote_host_send_command", {
            connectionId: connection.connectionId,
            command: "printf 'remote-host-mcp'",
          })) as RemoteCommandRunSnapshot;
          const updatedConnection = (yield* callRemoteHostMcpTool(
            controller,
            "remote_host_set_path",
            {
              connectionId: connection.connectionId,
              path: "src",
            },
          )) as RemoteConnectionSnapshot;
          const directory = (yield* callRemoteHostMcpTool(
            controller,
            "remote_host_list_directory",
            {
              connectionId: connection.connectionId,
              path: ".",
              limit: 20,
            },
          )) as { readonly entries: ReadonlyArray<{ readonly name: string }> };
          const runs = (yield* callRemoteHostMcpTool(controller, "remote_host_list_command_runs", {
            connectionId: connection.connectionId,
          })) as readonly RemoteCommandRunSnapshot[];

          expect(host.label).toBe("MCP local shell");
          expect(connection).toMatchObject({
            hostId: host.hostId,
            status: "connected",
            transportType: "command-template",
          });
          expect(run).toMatchObject({
            command: "printf 'remote-host-mcp'",
            status: "succeeded",
            output: "remote-host-mcp",
          });
          expect(updatedConnection.state.path).toBe(
            yield* Effect.promise(() => realpath(join(tempDir, "src"))),
          );
          expect(directory.entries).toEqual(
            expect.arrayContaining([expect.objectContaining({ name: "marker.txt" })]),
          );
          expect(runs.map((entry) => entry.command)).toContain("printf 'remote-host-mcp'");
        } finally {
          rmSync(tempDir, { recursive: true, force: true });
        }
      }).pipe(Effect.provide(liveLayer)),
  );

  it("advertises concrete input schemas over MCP", async () => {
    const transport = new StdioClientTransport({
      command: "bun",
      args: ["run", "src/mcp/remoteHostRunner.ts"],
      env: {
        ...process.env,
        FENRIR_MCP_BACKEND_URL: "http://127.0.0.1:9",
        FENRIR_MCP_TOKEN: "test-token",
      },
    });
    const client = new Client({ name: "remote-host-tools-test", version: "0.0.0" });

    try {
      await client.connect(transport);
      const result = await client.listTools();
      const sendCommand = result.tools.find((entry) => entry.name === "remote_host_send_command");

      expect(sendCommand?.inputSchema).toMatchObject({
        type: "object",
        properties: {
          connectionId: { type: "string" },
          command: { type: "string" },
        },
        required: ["connectionId", "command"],
      });
    } finally {
      await client.close();
    }
  });
});
