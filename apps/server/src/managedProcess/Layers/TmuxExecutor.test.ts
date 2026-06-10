import * as NodeServices from "@effect/platform-node/NodeServices";
import { it } from "@effect/vitest";
import { Deferred, Effect, Exit, Layer } from "effect";
import { execFileSync } from "node:child_process";
import * as nodeFs from "node:fs";
import * as nodePath from "node:path";
import * as os from "node:os";
import { describe, expect, afterAll } from "vitest";

import { ServerConfig } from "../../config.ts";
import { Executor } from "../Services/Executor.ts";
import { TmuxExecutorLive } from "./TmuxExecutor.ts";

// ── Tmux availability check ──

function isTmuxAvailable(): boolean {
  try {
    execFileSync("tmux", ["-V"], { stdio: "pipe", timeout: 5_000 });
    return true;
  } catch {
    return false;
  }
}

const hasTmux = isTmuxAvailable();

// ── Minimal ServerConfig stub ──

const testStateDir = nodePath.join(os.tmpdir(), `fenrir-tmux-test-${process.pid}`);
nodeFs.mkdirSync(testStateDir, { recursive: true });

/** Stable project ID shared across all test inputs */
const TEST_PROJECT = `tmux-test-${process.pid}`;

function findManagedProcessTmuxSession(windowName: string): string | undefined {
  try {
    const sessions = execFileSync("tmux", ["list-sessions", "-F", "#{session_name}"], {
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
      timeout: 5_000,
    }).trim();
    for (const session of sessions.split("\n")) {
      if (!session.startsWith("fenrir-mp-")) continue;
      const windows = execFileSync(
        "tmux",
        ["list-windows", "-t", session, "-F", "#{window_name}"],
        {
          encoding: "utf-8",
          stdio: ["pipe", "pipe", "pipe"],
          timeout: 5_000,
        },
      ).trim();
      if (windows.split("\n").includes(windowName)) return session;
    }
  } catch {
    // ignore
  }
  return undefined;
}

afterAll(() => {
  // Clean up test state dir
  try {
    nodeFs.rmSync(testStateDir, { recursive: true, force: true });
  } catch {
    // best effort
  }

  // Clean up any test tmux sessions
  try {
    const sessions = execFileSync("tmux", ["list-sessions", "-F", "#{session_name}"], {
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
      timeout: 5_000,
    }).trim();
    for (const s of sessions.split("\n")) {
      if (s.includes("tmux-test")) {
        try {
          execFileSync("tmux", ["kill-session", "-t", s], { stdio: "ignore", timeout: 5_000 });
        } catch {
          // already gone
        }
      }
    }
  } catch {
    // no sessions
  }
});

// Stub ServerConfig with just what TmuxExecutor needs
const TestServerConfig = Layer.succeed(ServerConfig, {
  stateDir: testStateDir,
  dbPath: "",
  keybindingsConfigPath: "",
  settingsPath: "",
  worktreesDir: "",
  attachmentsDir: "",
  logsDir: "",
  serverLogPath: "",
  serverTracePath: "",
  providerLogsDir: "",
  providerEventLogPath: "",
  terminalLogsDir: "",
  anonymousIdPath: "",
  environmentIdPath: "",
  secretsDir: "",
  globalActionsPath: "",
  logLevel: { _tag: "Info" } as never,
  traceMinLevel: { _tag: "Info" } as never,
  traceTimingEnabled: false,
  traceBatchWindowMs: 0,
  traceMaxBytes: 0,
  traceMaxFiles: 0,
  otlpTracesUrl: undefined,
  otlpMetricsUrl: undefined,
  otlpExportIntervalMs: 0,
  otlpServiceName: "",
  mode: "web" as const,
  port: 0,
  host: undefined,
  cwd: process.cwd(),
  baseDir: testStateDir,
  staticDir: undefined,
  devUrl: undefined,
  noBrowser: true,
  desktopBootstrapToken: undefined,
  autoBootstrapProjectFromCwd: false,
  logWebSocketEvents: false,
} as never);

// ── Test layer ──

const TestLayer = TmuxExecutorLive.pipe(
  Layer.provide(TestServerConfig),
  Layer.provide(NodeServices.layer),
);

// ── Helpers ──

interface ExitEvent {
  exitCode: number | null;
  signal: string | null;
  userInitiated: boolean;
}

let instanceCounter = 0;

/** Build spawn input. instanceId uses `{projectId}/{unique}` convention. */
function makeInput(command: string, options?: { env?: Record<string, string> }) {
  instanceCounter++;
  return {
    instanceId: `${TEST_PROJECT}/inst-${instanceCounter}`,
    command,
    cwd: process.cwd(),
    env: options?.env ?? {},
    cols: 120,
    rows: 40,
  };
}

// ── Tests ──

describe.skipIf(!hasTmux)("TmuxExecutor", () => {
  it.layer(TestLayer)("TmuxExecutor", (it) => {
    describe("kind", () => {
      it.effect("reports tmux executor kind", () =>
        Effect.gen(function* () {
          const executor = yield* Executor;
          expect(executor.kind).toBe("tmux");
        }),
      );
    });

    describe("spawn + onData", () => {
      it.effect(
        "receives output from spawned process via FIFO",
        () =>
          Effect.gen(function* () {
            const executor = yield* Executor;
            const handle = yield* executor.spawn(makeInput("echo hi"));

            const gotData = yield* Deferred.make<string>();
            let buffer = "";

            const sub = handle.onData((chunk) => {
              buffer += chunk;
              if (buffer.includes("hi")) {
                Deferred.doneUnsafe(gotData, Exit.succeed(buffer));
              }
            });

            const exitDone = yield* Deferred.make<ExitEvent>();

            const exitSub = handle.onExit((event) => {
              Deferred.doneUnsafe(exitDone, Exit.succeed(event));
              if (buffer.includes("hi")) {
                Deferred.doneUnsafe(gotData, Exit.succeed(buffer));
              }
            });

            const data = yield* Deferred.await(gotData);
            expect(data).toContain("hi");

            const exit = yield* Deferred.await(exitDone);
            expect(exit.userInitiated).toBe(false);

            sub.unsubscribe();
            exitSub.unsubscribe();
          }),
        { timeout: 15_000 },
      );

      it.effect(
        "passes environment variables before execing the command",
        () =>
          Effect.gen(function* () {
            const executor = yield* Executor;
            const handle = yield* executor.spawn(
              makeInput(`printf '%s\n' "$FENRIR_PROJECT_ROOT"`, {
                env: {
                  FENRIR_PROJECT_ROOT: "/tmp/fenrir env test",
                },
              }),
            );

            let buffer = "";

            const sub = handle.onData((chunk) => {
              buffer += chunk;
            });

            const exitDone = yield* Deferred.make<ExitEvent>();
            const exitSub = handle.onExit((event) => {
              Deferred.doneUnsafe(exitDone, Exit.succeed(event));
            });

            const exit = yield* Deferred.await(exitDone);
            expect(exit.userInitiated).toBe(false);
            expect(buffer).toContain("/tmp/fenrir env test");

            sub.unsubscribe();
            exitSub.unsubscribe();
          }),
        { timeout: 15_000 },
      );
    });

    describe("stop (user-initiated)", () => {
      it.effect(
        "sets userInitiated on exit after stop()",
        () =>
          Effect.gen(function* () {
            const executor = yield* Executor;
            const handle = yield* executor.spawn(makeInput("sleep 120"));

            // Give process time to start
            yield* Effect.promise(() => new Promise<void>((r) => setTimeout(r, 1000)));

            const exitDone = yield* Deferred.make<ExitEvent>();

            const exitSub = handle.onExit((event) => {
              Deferred.doneUnsafe(exitDone, Exit.succeed(event));
            });

            yield* handle.stop();
            const exit = yield* Deferred.await(exitDone);

            expect(exit.userInitiated).toBe(true);

            exitSub.unsubscribe();
          }),
        { timeout: 15_000 },
      );
    });

    describe("forceKill", () => {
      it.effect(
        "removes the window and FIFO",
        () =>
          Effect.gen(function* () {
            const executor = yield* Executor;
            const input = makeInput("sleep 120");
            const handle = yield* executor.spawn(input);

            yield* Effect.promise(() => new Promise<void>((r) => setTimeout(r, 1000)));

            const exitDone = yield* Deferred.make<ExitEvent>();

            handle.onExit((event) => {
              Deferred.doneUnsafe(exitDone, Exit.succeed(event));
            });

            yield* handle.forceKill();

            const exit = yield* Deferred.await(exitDone);
            expect(exit.userInitiated).toBe(true);

            // FIFO should be cleaned up — sanitized fifo name
            const fifoName = input.instanceId.replace(/[^a-zA-Z0-9_.-]/g, "-");
            const fifoPath = nodePath.join(
              testStateDir,
              "managed-process",
              TEST_PROJECT,
              ".fifo",
              fifoName,
            );
            expect(nodeFs.existsSync(fifoPath)).toBe(false);
          }),
        { timeout: 15_000 },
      );
    });

    describe("reattach", () => {
      it.effect(
        "reattaches to a running tmux window after dropping handle",
        () =>
          Effect.gen(function* () {
            const executor = yield* Executor;
            const input = makeInput("sh -c 'while true; do echo ping; sleep 1; done'");
            const handle1 = yield* executor.spawn(input);

            // Wait for initial output
            const gotPing = yield* Deferred.make<boolean>();
            let buf1 = "";
            const sub1 = handle1.onData((chunk) => {
              buf1 += chunk;
              if (buf1.includes("ping")) {
                Deferred.doneUnsafe(gotPing, Exit.succeed(true));
              }
            });
            yield* Deferred.await(gotPing);
            expect(buf1).toContain("ping");

            const nativeKey = handle1.nativeKey;

            // "Simulate Fenrir restart" — drop all in-memory handles
            sub1.unsubscribe();

            // Reattach
            const handle2 = yield* executor.reattach!({
              instanceId: input.instanceId,
              nativeKey,
              cols: 120,
              rows: 40,
            });

            expect(handle2.nativeKey).toBe(nativeKey);

            // Should continue to receive data
            const gotPing2 = yield* Deferred.make<boolean>();
            let buf2 = "";
            const sub2 = handle2.onData((chunk) => {
              buf2 += chunk;
              if (buf2.includes("ping")) {
                Deferred.doneUnsafe(gotPing2, Exit.succeed(true));
              }
            });

            yield* Deferred.await(gotPing2);
            expect(buf2).toContain("ping");

            // Clean up via stop
            const exitDone = yield* Deferred.make<ExitEvent>();
            handle2.onExit((event) => {
              Deferred.doneUnsafe(exitDone, Exit.succeed(event));
            });

            yield* handle2.stop();
            yield* Deferred.await(exitDone);

            sub2.unsubscribe();
          }),
        { timeout: 20_000 },
      );
    });

    describe("shared session", () => {
      it.effect(
        "two managed processes share one tmux session with separate windows",
        () =>
          Effect.gen(function* () {
            const executor = yield* Executor;

            // Both use the same TEST_PROJECT prefix → same session
            const inputA = makeInput("sleep 120");
            const inputB = makeInput("sleep 120");

            const handleA = yield* executor.spawn(inputA);
            const handleB = yield* executor.spawn(inputB);

            // Different window names
            expect(handleA.nativeKey).not.toBe(handleB.nativeKey);

            // Both in the same fenrir-mp-* session
            const sessionA = findManagedProcessTmuxSession(handleA.nativeKey);
            const sessionB = findManagedProcessTmuxSession(handleB.nativeKey);
            expect(sessionA).toBeDefined();
            expect(sessionA).toBe(sessionB);

            // Clean up
            yield* handleA.forceKill();
            yield* handleB.forceKill();
          }),
        { timeout: 15_000 },
      );
    });

    describe("reattach missing window", () => {
      it.effect("rejects with not-running for non-existent window", () =>
        Effect.gen(function* () {
          const executor = yield* Executor;
          const result = yield* executor.reattach!({
            instanceId: "bogus/missing",
            nativeKey: "nonexistent-window-xyz",
            cols: 120,
            rows: 40,
          }).pipe(Effect.flip);

          expect(result._tag).toBe("ExecutorError");
          expect(result.code).toBe("not-running");
        }),
      );
    });
  });
});
