import { EventEmitter } from "node:events";

import { afterEach, describe, expect, it, vi } from "vitest";

import { _resetCachedVSCodeProbeResult, probeVSCodeWeb } from "./probe";

vi.mock("node:child_process", () => ({
  spawn: vi.fn(),
}));

import { spawn } from "node:child_process";

const mockedSpawn = vi.mocked(spawn);

function makeFakeProc(): EventEmitter & { stdout: EventEmitter; stderr: EventEmitter } {
  const proc = new EventEmitter() as EventEmitter & {
    stdout: EventEmitter;
    stderr: EventEmitter;
  };
  proc.stdout = new EventEmitter();
  proc.stderr = new EventEmitter();
  return proc;
}

async function waitForSpawnCount(count: number): Promise<void> {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    if (mockedSpawn.mock.calls.length >= count) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
}

afterEach(() => {
  _resetCachedVSCodeProbeResult();
  vi.clearAllMocks();
});

describe("probeVSCodeWeb", () => {
  it("returns code-server when it is available", async () => {
    const proc = makeFakeProc();
    mockedSpawn.mockReturnValue(proc as never);

    const promise = probeVSCodeWeb();
    proc.stdout.emit("data", Buffer.from("4.104.0\n"));
    proc.emit("exit", 0);

    await expect(promise).resolves.toEqual({
      available: true,
      serverKind: "code-server",
      command: "code-server",
      version: "4.104.0",
      error: null,
    });
  });

  it("falls back to openvscode-server", async () => {
    const codeServerProc = makeFakeProc();
    const openVSCodeProc = makeFakeProc();
    mockedSpawn
      .mockReturnValueOnce(codeServerProc as never)
      .mockReturnValueOnce(openVSCodeProc as never);

    const promise = probeVSCodeWeb();
    codeServerProc.emit("error", new Error("spawn code-server ENOENT"));
    await waitForSpawnCount(2);
    openVSCodeProc.stdout.emit("data", Buffer.from("1.109.5\n"));
    openVSCodeProc.emit("exit", 0);

    await expect(promise).resolves.toEqual({
      available: true,
      serverKind: "openvscode-server",
      command: "openvscode-server",
      version: "1.109.5",
      error: null,
    });
  });

  it("returns unavailable when no supported command exists", async () => {
    const codeServerProc = makeFakeProc();
    const openVSCodeProc = makeFakeProc();
    mockedSpawn
      .mockReturnValueOnce(codeServerProc as never)
      .mockReturnValueOnce(openVSCodeProc as never);

    const promise = probeVSCodeWeb();
    codeServerProc.emit("error", new Error("spawn code-server ENOENT"));
    await waitForSpawnCount(2);
    openVSCodeProc.emit("error", new Error("spawn openvscode-server ENOENT"));

    const result = await promise;
    expect(result.available).toBe(false);
    expect(result.command).toBeNull();
    expect(result.error).toContain("code-server");
    expect(result.error).toContain("openvscode-server");
  });

  it("caches the first successful result", async () => {
    const proc = makeFakeProc();
    mockedSpawn.mockReturnValue(proc as never);

    const promise = probeVSCodeWeb();
    proc.stdout.emit("data", Buffer.from("4.104.0\n"));
    proc.emit("exit", 0);
    await promise;

    const result = await probeVSCodeWeb();
    expect(result.available).toBe(true);
    expect(mockedSpawn).toHaveBeenCalledTimes(1);
  });
});
