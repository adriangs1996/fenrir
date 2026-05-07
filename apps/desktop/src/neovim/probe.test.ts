import { EventEmitter } from "node:events";

import { afterEach, describe, expect, it, vi } from "vitest";

import { _resetCachedProbeResult, probeNvim } from "./probe";

vi.mock("node:child_process", () => ({
  spawn: vi.fn(),
}));

import { spawn } from "node:child_process";

const mockedSpawn = vi.mocked(spawn);

function makeFakeProc(): EventEmitter & { stdout: EventEmitter } {
  const proc = new EventEmitter() as EventEmitter & { stdout: EventEmitter };
  proc.stdout = new EventEmitter();
  return proc;
}

afterEach(() => {
  _resetCachedProbeResult();
  vi.clearAllMocks();
});

describe("probeNvim", () => {
  it("returns available with version on success", async () => {
    const proc = makeFakeProc();
    mockedSpawn.mockReturnValue(proc as never);

    const promise = probeNvim();
    proc.stdout.emit("data", Buffer.from("NVIM v0.10.0\nBuild type: Release\n"));
    proc.emit("exit", 0);

    const result = await promise;
    expect(result).toEqual({
      available: true,
      version: "NVIM v0.10.0",
      binary: "nvim",
      error: null,
    });
  });

  it("returns unavailable on non-zero exit", async () => {
    const proc = makeFakeProc();
    mockedSpawn.mockReturnValue(proc as never);

    const promise = probeNvim();
    proc.emit("exit", 1);

    const result = await promise;
    expect(result).toEqual({
      available: false,
      version: null,
      binary: null,
      error: "nvim --version exited with code 1",
    });
  });

  it("returns unavailable on spawn error (ENOENT)", async () => {
    const proc = makeFakeProc();
    mockedSpawn.mockReturnValue(proc as never);

    const promise = probeNvim();
    proc.emit("error", new Error("spawn nvim ENOENT"));

    const result = await promise;
    expect(result).toEqual({
      available: false,
      version: null,
      binary: null,
      error: "spawn nvim ENOENT",
    });
  });

  it("returns unavailable on timeout", async () => {
    vi.useFakeTimers();
    const proc = makeFakeProc();
    mockedSpawn.mockReturnValue(proc as never);

    const promise = probeNvim();
    vi.advanceTimersByTime(3000);

    const result = await promise;
    expect(result).toEqual({
      available: false,
      version: null,
      binary: null,
      error: "nvim --version timed out",
    });
    vi.useRealTimers();
  });

  it("returns unavailable when spawn throws synchronously", async () => {
    mockedSpawn.mockImplementation(() => {
      throw new Error("cannot spawn");
    });

    const result = await probeNvim();
    expect(result).toEqual({
      available: false,
      version: null,
      binary: null,
      error: "cannot spawn",
    });
  });

  it("caches result after first call", async () => {
    const proc = makeFakeProc();
    mockedSpawn.mockReturnValue(proc as never);

    const promise = probeNvim();
    proc.stdout.emit("data", Buffer.from("NVIM v0.10.0\n"));
    proc.emit("exit", 0);
    await promise;

    // Second call should not spawn again
    const result = await probeNvim();
    expect(result.available).toBe(true);
    expect(mockedSpawn).toHaveBeenCalledTimes(1);
  });

  it("settles only once even if both error and exit fire", async () => {
    const proc = makeFakeProc();
    mockedSpawn.mockReturnValue(proc as never);

    const promise = probeNvim();
    proc.emit("error", new Error("spawn nvim ENOENT"));
    proc.emit("exit", 1);

    const result = await promise;
    // First event wins
    expect(result.error).toBe("spawn nvim ENOENT");
    expect(result.available).toBe(false);
  });
});
