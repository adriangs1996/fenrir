import { EventEmitter } from "node:events";

import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from "vitest";

import { BackendLifecycle, type BackendLifecycleDeps } from "./BackendLifecycle";

vi.mock("node:child_process", () => ({
  spawn: vi.fn(),
}));

vi.mock("node:fs", () => ({
  existsSync: vi.fn(() => true),
}));

import { spawn } from "node:child_process";
import { existsSync } from "node:fs";

const mockedSpawn = vi.mocked(spawn);
const mockedExistsSync = vi.mocked(existsSync);

class FakeBootstrapPipe {
  readonly written: string[] = [];
  readonly write = vi.fn((chunk: string) => {
    this.written.push(chunk);
    return true;
  });
  readonly end = vi.fn();
}

class FakeChild extends EventEmitter {
  pid = 4242;
  exitCode: number | null = null;
  signalCode: NodeJS.Signals | null = null;
  readonly stdio: [null, null, null, FakeBootstrapPipe | null];
  readonly kill = vi.fn(() => true);

  constructor(pipe: FakeBootstrapPipe | null = new FakeBootstrapPipe()) {
    super();
    this.stdio = [null, null, null, pipe];
  }

  get bootstrapPipe(): FakeBootstrapPipe {
    const pipe = this.stdio[3];
    if (!pipe) throw new Error("fake child has no bootstrap pipe");
    return pipe;
  }
}

function makeDeps(overrides: Partial<BackendLifecycleDeps> = {}): BackendLifecycleDeps {
  return {
    isQuitting: () => false,
    resolveBackendEntry: () => "/fake/backend/index.js",
    resolveBackendCwd: () => "/fake/backend",
    buildChildEnv: () => ({ FOO: "bar" }),
    buildBootstrapPayload: () => ({ token: "abc" }),
    shouldCaptureBackendLogs: () => false,
    captureBackendOutput: vi.fn(),
    writeSessionBoundary: vi.fn(),
    getBackendPort: () => 4923,
    waitForReady: vi.fn(() => Promise.resolve()),
    onReady: vi.fn(),
    onProcessGone: vi.fn(),
    onBeforeStop: vi.fn(),
    ...overrides,
  };
}

/** Children returned by the spawn mock, in spawn order. */
let children: FakeChild[] = [];
let consoleErrorSpy: MockInstance;

function restartDelays(): number[] {
  return consoleErrorSpy.mock.calls
    .map((call) => /restarting in (\d+)ms/.exec(String(call[0]))?.[1])
    .filter((delay): delay is string => delay !== undefined)
    .map(Number);
}

async function flushMicrotasks(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

beforeEach(() => {
  vi.useFakeTimers();
  children = [];
  mockedExistsSync.mockReturnValue(true);
  mockedSpawn.mockImplementation(() => {
    const child = new FakeChild();
    children.push(child);
    return child as never;
  });
  consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
});

afterEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
  vi.restoreAllMocks();
});

describe("BackendLifecycle.start", () => {
  it("spawns the backend in Node mode and writes the bootstrap payload over fd3", () => {
    const lifecycle = new BackendLifecycle(makeDeps());

    lifecycle.start();

    expect(mockedSpawn).toHaveBeenCalledTimes(1);
    const [execPath, args, options] = mockedSpawn.mock.calls[0] as unknown as [
      string,
      string[],
      { env: NodeJS.ProcessEnv; cwd: string },
    ];
    expect(execPath).toBe(process.execPath);
    expect(args).toEqual(["/fake/backend/index.js", "--bootstrap-fd", "3"]);
    expect(options.cwd).toBe("/fake/backend");
    expect(options.env.ELECTRON_RUN_AS_NODE).toBe("1");
    expect(options.env.FOO).toBe("bar");

    const child = children[0] as FakeChild;
    expect(child.bootstrapPipe.written).toEqual([`${JSON.stringify({ token: "abc" })}\n`]);
    expect(child.bootstrapPipe.end).toHaveBeenCalledTimes(1);
    expect(lifecycle.getState()).toBe("starting");
  });

  it("is a no-op when a backend process is already running", () => {
    const lifecycle = new BackendLifecycle(makeDeps());

    lifecycle.start();
    lifecycle.start();

    expect(mockedSpawn).toHaveBeenCalledTimes(1);
  });

  it("is a no-op while quitting", () => {
    const lifecycle = new BackendLifecycle(makeDeps({ isQuitting: () => true }));

    lifecycle.start();

    expect(mockedSpawn).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("marks the lifecycle ready once the backend reports HTTP readiness", async () => {
    const deps = makeDeps();
    const lifecycle = new BackendLifecycle(deps);

    lifecycle.start();
    (children[0] as FakeChild).emit("spawn");
    await flushMicrotasks();

    expect(lifecycle.getState()).toBe("ready");
    expect(deps.onReady).toHaveBeenCalledTimes(1);
  });

  it("kills the child and schedules a restart when the bootstrap pipe is missing", () => {
    mockedSpawn.mockImplementation(() => {
      const child = new FakeChild(null);
      children.push(child);
      return child as never;
    });
    const lifecycle = new BackendLifecycle(makeDeps());

    lifecycle.start();

    expect((children[0] as FakeChild).kill).toHaveBeenCalledWith("SIGTERM");
    expect(vi.getTimerCount()).toBe(1);
    expect(restartDelays()).toEqual([500]);
  });
});

describe("BackendLifecycle restarts", () => {
  it("restarts on unexpected exit and resets the attempt counter on successful spawn", async () => {
    const deps = makeDeps();
    const lifecycle = new BackendLifecycle(deps);

    lifecycle.start();
    // Two consecutive unexpected exits without a successful spawn: backoff grows.
    (children[0] as FakeChild).emit("exit", 1, null);
    vi.advanceTimersByTime(500);
    (children[1] as FakeChild).emit("exit", 1, null);
    vi.advanceTimersByTime(1000);
    expect(restartDelays()).toEqual([500, 1000]);

    // Third child spawns successfully: counter resets.
    (children[2] as FakeChild).emit("spawn");
    await flushMicrotasks();
    expect(lifecycle.getState()).toBe("ready");

    // Next unexpected exit starts the backoff over at 500ms.
    (children[2] as FakeChild).emit("exit", 1, null);
    expect(restartDelays()).toEqual([500, 1000, 500]);
    expect(deps.onProcessGone).toHaveBeenCalledTimes(3);
  });

  it("applies exponential backoff capped at 10s", () => {
    mockedExistsSync.mockReturnValue(false);
    const lifecycle = new BackendLifecycle(makeDeps());

    lifecycle.start();
    for (let cycle = 0; cycle < 6; cycle += 1) {
      vi.runOnlyPendingTimers();
    }

    expect(restartDelays()).toEqual([500, 1000, 2000, 4000, 8000, 10_000, 10_000]);
  });

  it("gives up after MAX_BACKEND_RESTART_ATTEMPTS consecutive failures", () => {
    mockedExistsSync.mockReturnValue(false);
    const lifecycle = new BackendLifecycle(makeDeps());

    lifecycle.start();
    // Drain restart cycles until the cap stops scheduling new timers.
    for (let cycle = 0; cycle < 60 && vi.getTimerCount() > 0; cycle += 1) {
      vi.runOnlyPendingTimers();
    }

    expect(lifecycle.getState()).toBe("error");
    expect(vi.getTimerCount()).toBe(0);
    expect(restartDelays()).toHaveLength(50);
    expect(consoleErrorSpy.mock.calls.some((call) => String(call[0]).includes("giving up"))).toBe(
      true,
    );
  });

  it("does not restart when the exit happens while quitting", () => {
    let quitting = false;
    const lifecycle = new BackendLifecycle(makeDeps({ isQuitting: () => quitting }));

    lifecycle.start();
    quitting = true;
    (children[0] as FakeChild).emit("exit", 0, null);

    expect(vi.getTimerCount()).toBe(0);
    expect(restartDelays()).toEqual([]);
  });
});

describe("BackendLifecycle.stop", () => {
  it("terminates the child without scheduling a restart", () => {
    const deps = makeDeps();
    const lifecycle = new BackendLifecycle(deps);
    lifecycle.start();
    const child = children[0] as FakeChild;

    lifecycle.stop();

    expect(deps.onBeforeStop).toHaveBeenCalledTimes(1);
    expect(lifecycle.getState()).toBe("stopped");
    expect(child.kill).toHaveBeenCalledWith("SIGTERM");

    // The intentional exit must not trigger a restart.
    child.exitCode = 0;
    child.emit("exit", 0, null);
    vi.advanceTimersByTime(60_000);

    expect(mockedSpawn).toHaveBeenCalledTimes(1);
    expect(restartDelays()).toEqual([]);
    // Child exited before the 2s grace period: no SIGKILL escalation.
    expect(child.kill).toHaveBeenCalledTimes(1);
    expect(lifecycle.getState()).toBe("stopped");
  });

  it("escalates to SIGKILL when the child ignores SIGTERM", () => {
    const lifecycle = new BackendLifecycle(makeDeps());
    lifecycle.start();
    const child = children[0] as FakeChild;

    lifecycle.stop();
    vi.advanceTimersByTime(2_000);

    expect(child.kill).toHaveBeenNthCalledWith(1, "SIGTERM");
    expect(child.kill).toHaveBeenNthCalledWith(2, "SIGKILL");
  });

  it("cancels a pending restart timer", () => {
    mockedExistsSync.mockReturnValue(false);
    const lifecycle = new BackendLifecycle(makeDeps());
    lifecycle.start();
    expect(vi.getTimerCount()).toBe(1);

    lifecycle.stop();
    vi.advanceTimersByTime(60_000);

    expect(vi.getTimerCount()).toBe(0);
    expect(mockedSpawn).not.toHaveBeenCalled();
    expect(lifecycle.getState()).toBe("stopped");
  });
});

describe("BackendLifecycle.stopAndWaitForExit", () => {
  it("resolves once the child exits and skips the SIGKILL escalation", async () => {
    const lifecycle = new BackendLifecycle(makeDeps());
    lifecycle.start();
    const child = children[0] as FakeChild;

    const stopPromise = lifecycle.stopAndWaitForExit();
    expect(child.kill).toHaveBeenCalledWith("SIGTERM");

    child.exitCode = 0;
    child.emit("exit", 0, null);
    await stopPromise;

    vi.advanceTimersByTime(60_000);
    expect(child.kill).toHaveBeenCalledTimes(1);
    expect(lifecycle.getState()).toBe("stopped");
  });

  it("resolves after the timeout even if the child never exits", async () => {
    const lifecycle = new BackendLifecycle(makeDeps());
    lifecycle.start();
    const child = children[0] as FakeChild;

    const stopPromise = lifecycle.stopAndWaitForExit(5_000);
    await vi.advanceTimersByTimeAsync(5_000);
    await stopPromise;

    // The 2s grace period escalated to SIGKILL before the wait timed out.
    expect(child.kill).toHaveBeenNthCalledWith(1, "SIGTERM");
    expect(child.kill).toHaveBeenNthCalledWith(2, "SIGKILL");
  });

  it("returns immediately when no backend process is running", async () => {
    const deps = makeDeps();
    const lifecycle = new BackendLifecycle(deps);

    await lifecycle.stopAndWaitForExit();

    expect(deps.onBeforeStop).toHaveBeenCalledTimes(1);
    expect(lifecycle.getState()).toBe("stopped");
  });
});
