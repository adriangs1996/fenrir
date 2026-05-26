import * as path from "node:path";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { buildCursorAcpSpawnInput, resolveCursorAcpBaseModelId } from "./CursorAcpSupport.ts";

type JsonRpcMessage =
  | {
      readonly jsonrpc: "2.0";
      readonly id: number | string;
      readonly result?: unknown;
      readonly error?: unknown;
    }
  | {
      readonly jsonrpc: "2.0";
      readonly method: string;
      readonly params?: unknown;
      readonly id?: number | string;
    };

class JsonRpcMockAgentPeer {
  private readonly child: ChildProcessWithoutNullStreams;
  private readonly responseWaiters = new Map<number | string, (message: JsonRpcMessage) => void>();
  private readonly methodWaiters = new Map<string, Array<(message: JsonRpcMessage) => void>>();
  private readonly exited: Promise<void>;
  private buffer = "";

  constructor(command: string, args: ReadonlyArray<string>, env?: NodeJS.ProcessEnv) {
    this.child = spawn(command, [...args], {
      cwd: process.cwd(),
      env: { ...process.env, ...env },
      stdio: ["pipe", "pipe", "pipe"],
    });

    this.child.stdout.setEncoding("utf8");
    this.child.stdout.on("data", (chunk: string) => {
      this.buffer += chunk;
      while (true) {
        const newlineIndex = this.buffer.indexOf("\n");
        if (newlineIndex === -1) {
          return;
        }
        const line = this.buffer.slice(0, newlineIndex).trim();
        this.buffer = this.buffer.slice(newlineIndex + 1);
        if (line.length === 0) {
          continue;
        }
        this.handleMessage(JSON.parse(line) as JsonRpcMessage);
      }
    });

    this.exited = new Promise((resolve, reject) => {
      this.child.once("exit", () => resolve());
      this.child.once("error", reject);
    });
  }

  send(message: JsonRpcMessage): void {
    this.child.stdin.write(`${JSON.stringify(message)}\n`);
  }

  waitForResponse(id: number | string, timeoutMs = 2000): Promise<JsonRpcMessage> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.responseWaiters.delete(id);
        reject(new Error(`Timed out waiting for response ${String(id)}`));
      }, timeoutMs);
      this.responseWaiters.set(id, (message) => {
        clearTimeout(timer);
        resolve(message);
      });
    });
  }

  waitForMethod(method: string, timeoutMs = 2000): Promise<JsonRpcMessage> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        const waiters = this.methodWaiters.get(method) ?? [];
        this.methodWaiters.set(
          method,
          waiters.filter((waiter) => waiter !== onMessage),
        );
        reject(new Error(`Timed out waiting for method ${method}`));
      }, timeoutMs);

      const onMessage = (message: JsonRpcMessage) => {
        clearTimeout(timer);
        resolve(message);
      };

      const waiters = this.methodWaiters.get(method) ?? [];
      waiters.push(onMessage);
      this.methodWaiters.set(method, waiters);
    });
  }

  async terminate(): Promise<void> {
    this.child.kill("SIGTERM");
    await this.exited;
  }

  private handleMessage(message: JsonRpcMessage): void {
    if ("id" in message && message.id !== undefined && !("method" in message)) {
      const waiter = this.responseWaiters.get(message.id);
      if (waiter) {
        this.responseWaiters.delete(message.id);
        waiter(message);
      }
      return;
    }

    if ("method" in message) {
      const waiters = this.methodWaiters.get(message.method);
      const waiter = waiters?.shift();
      if (waiter) {
        waiter(message);
      }
    }
  }
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const mockAgentPath = path.join(__dirname, "../../../scripts/acp-mock-agent.ts");

describe("CursorAcpSupport", () => {
  it("builds cursor ACP spawn input with optional endpoint and env", () => {
    expect(
      buildCursorAcpSpawnInput(
        {
          binaryPath: "agent",
          apiEndpoint: "https://cursor.example.test",
        },
        "/tmp/project",
        { FOO: "bar" },
      ),
    ).toEqual({
      command: "agent",
      args: ["-e", "https://cursor.example.test", "acp"],
      cwd: "/tmp/project",
      env: { FOO: "bar" },
    });
  });

  it("resolves parameterized Cursor model ids to their base model", () => {
    expect(resolveCursorAcpBaseModelId(undefined)).toBe("default");
    expect(resolveCursorAcpBaseModelId("")).toBe("default");
    expect(resolveCursorAcpBaseModelId("gpt-5.4[reasoning=high]")).toBe("gpt-5.4");
    expect(resolveCursorAcpBaseModelId("composer-2")).toBe("composer-2");
  });

  it("speaks the mock Cursor ACP wire protocol for initialize and session/new", async () => {
    const peer = new JsonRpcMockAgentPeer("bun", [mockAgentPath, "acp"]);
    try {
      peer.send({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: 1,
          clientCapabilities: {},
          clientInfo: { name: "fenrir-test", version: "1.0.0" },
        },
      });
      await expect(peer.waitForResponse(1)).resolves.toMatchObject({
        jsonrpc: "2.0",
        id: 1,
        result: {
          protocolVersion: 1,
          agentCapabilities: { loadSession: true },
        },
      });

      peer.send({
        jsonrpc: "2.0",
        id: 2,
        method: "session/new",
        params: {
          cwd: process.cwd(),
          mcpServers: [],
        },
      });
      await expect(peer.waitForResponse(2)).resolves.toMatchObject({
        jsonrpc: "2.0",
        id: 2,
        result: {
          sessionId: "mock-session-1",
        },
      });
    } finally {
      await peer.terminate();
    }
  });

  it("emits an ACP permission request during approval-required prompt flow", async () => {
    const peer = new JsonRpcMockAgentPeer("bun", [mockAgentPath, "acp"], {
      T3_ACP_EMIT_TOOL_CALLS: "1",
    });

    try {
      peer.send({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: 1,
          clientCapabilities: {},
          clientInfo: { name: "fenrir-test", version: "1.0.0" },
        },
      });
      await peer.waitForResponse(1);

      peer.send({
        jsonrpc: "2.0",
        id: 2,
        method: "session/new",
        params: {
          cwd: process.cwd(),
          mcpServers: [],
        },
      });
      await peer.waitForResponse(2);

      peer.send({
        jsonrpc: "2.0",
        id: 3,
        method: "session/prompt",
        params: {
          sessionId: "mock-session-1",
          prompt: [{ type: "text", text: "needs approval" }],
        },
      });

      const permissionRequest = await peer.waitForMethod("session/request_permission");
      expect(permissionRequest).toMatchObject({
        jsonrpc: "2.0",
        method: "session/request_permission",
      });

      if (!("id" in permissionRequest) || permissionRequest.id === undefined) {
        throw new Error("Expected permission request id");
      }
    } finally {
      await peer.terminate();
    }
  });
});
