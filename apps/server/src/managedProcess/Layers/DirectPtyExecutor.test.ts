import * as NodeServices from "@effect/platform-node/NodeServices";
import { it } from "@effect/vitest";
import { Deferred, Effect, Exit, Layer } from "effect";
import { describe, expect } from "vitest";

import { layer as NodePtyLayer } from "../../terminal/Layers/NodePTY.ts";
import { TerminalShellResolverLive } from "../../terminal/Layers/ShellResolver.ts";
import { Executor } from "../Services/Executor.ts";
import { DirectPtyExecutorLive } from "./DirectPtyExecutor.ts";

// ── Test layer ──

const TestLayer = DirectPtyExecutorLive.pipe(
  Layer.provide(NodePtyLayer),
  Layer.provide(TerminalShellResolverLive),
  Layer.provide(NodeServices.layer),
);

// ── Helpers ──

const isWindows = process.platform === "win32";

interface ExitEvent {
  exitCode: number | null;
  signal: string | null;
  userInitiated: boolean;
}

function makeInput(command: string) {
  return {
    instanceId: `test-${Math.random().toString(36).slice(2, 8)}`,
    command,
    cwd: process.cwd(),
    env: {},
    cols: 120,
    rows: 40,
  };
}

// ── Tests ──

it.layer(TestLayer)("DirectPtyExecutor", (it) => {
  describe("spawn + onData", () => {
    it.effect(
      "receives output from spawned process",
      () =>
        Effect.gen(function* () {
          if (isWindows) return;

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
      { timeout: 10_000 },
    );
  });

  describe("stop (user-initiated)", () => {
    it.effect(
      "sets userInitiated on exit after stop()",
      () =>
        Effect.gen(function* () {
          if (isWindows) return;

          const executor = yield* Executor;
          const handle = yield* executor.spawn(makeInput("sleep 60"));

          const exitDone = yield* Deferred.make<ExitEvent>();

          const exitSub = handle.onExit((event) => {
            Deferred.doneUnsafe(exitDone, Exit.succeed(event));
          });

          yield* handle.stop();
          const exit = yield* Deferred.await(exitDone);

          expect(exit.userInitiated).toBe(true);

          exitSub.unsubscribe();
        }),
      { timeout: 10_000 },
    );
  });

  describe("crash detection", () => {
    it.effect(
      "reports exitCode from a crashing process",
      () =>
        Effect.gen(function* () {
          if (isWindows) return;

          const executor = yield* Executor;
          const handle = yield* executor.spawn(makeInput("exit 7"));

          const exitDone = yield* Deferred.make<ExitEvent>();

          handle.onExit((event) => {
            Deferred.doneUnsafe(exitDone, Exit.succeed(event));
          });

          const exit = yield* Deferred.await(exitDone);
          expect(exit.exitCode).toBe(7);
          expect(exit.userInitiated).toBe(false);
        }),
      { timeout: 10_000 },
    );
  });

  describe("write round-trip", () => {
    it.effect(
      "data written to cat is echoed back",
      () =>
        Effect.gen(function* () {
          if (isWindows) return;

          const executor = yield* Executor;
          const handle = yield* executor.spawn(makeInput("cat"));

          const gotEcho = yield* Deferred.make<string>();
          let buffer = "";

          const sub = handle.onData((chunk) => {
            buffer += chunk;
            if (buffer.includes("hello")) {
              Deferred.doneUnsafe(gotEcho, Exit.succeed(buffer));
            }
          });

          yield* handle.write("hello\n");

          const data = yield* Deferred.await(gotEcho);
          expect(data).toContain("hello");

          // Clean up
          const exitDone = yield* Deferred.make<void>();
          handle.onExit(() => {
            Deferred.doneUnsafe(exitDone, Exit.void);
          });

          yield* handle.stop();
          yield* Deferred.await(exitDone);

          sub.unsubscribe();
        }),
      { timeout: 10_000 },
    );
  });

  describe("forceKill", () => {
    it.effect(
      "kills a process that ignores SIGTERM",
      () =>
        Effect.gen(function* () {
          if (isWindows) return;

          const executor = yield* Executor;
          const handle = yield* executor.spawn(makeInput("trap '' TERM; sleep 60"));

          const exitDone = yield* Deferred.make<ExitEvent>();

          handle.onExit((event) => {
            Deferred.doneUnsafe(exitDone, Exit.succeed(event));
          });

          // Give shell time to set up trap, then use real timer for delay
          yield* Effect.promise(() => new Promise<void>((resolve) => setTimeout(resolve, 500)));

          // SIGTERM — should be ignored by trap
          yield* handle.stop();

          // Brief delay then SIGKILL
          yield* Effect.promise(() => new Promise<void>((resolve) => setTimeout(resolve, 1000)));
          yield* handle.forceKill();

          const exit = yield* Deferred.await(exitDone);
          expect(exit.userInitiated).toBe(true);
        }),
      { timeout: 15_000 },
    );
  });

  describe("reattach", () => {
    it.effect("rejects with not-running", () =>
      Effect.gen(function* () {
        const executor = yield* Executor;
        const result = yield* executor.reattach!({
          instanceId: "bogus",
          nativeKey: "1234",
          cols: 120,
          rows: 40,
        }).pipe(Effect.flip);

        expect(result._tag).toBe("ExecutorError");
        expect(result.code).toBe("not-running");
      }),
    );
  });

  describe("kind", () => {
    it.effect("reports direct executor kind", () =>
      Effect.gen(function* () {
        const executor = yield* Executor;
        expect(executor.kind).toBe("direct");
      }),
    );
  });
});
