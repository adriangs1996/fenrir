/**
 * DirectPtyExecutor — Spawns managed processes as direct PTY children.
 *
 * No tmux involved. Processes die with Fenrir (standard PTY behavior).
 * Uses the existing PtyAdapter + TerminalShellResolver services.
 *
 * @module ManagedProcess/Layers/DirectPtyExecutor
 */
import { spawnSync } from "node:child_process";

import { Effect, Layer } from "effect";

import { PtyAdapter } from "../../terminal/Services/PTY";
import { TerminalShellResolver } from "../../terminal/Services/ShellResolver";
import { Executor, ExecutorError } from "../Services/Executor";
import type { ExecutorHandle, ExecutorSpawnInput } from "../Services/Executor";

/**
 * Convert a numeric signal code from node-pty to a signal name.
 * node-pty reports signals as numbers (e.g. 15 for SIGTERM, 9 for SIGKILL).
 * Returns null when signal is null/undefined/0.
 */
function signalName(signal: number | null | undefined): string | null {
  if (signal == null || signal === 0) return null;
  // Common POSIX signals — covers the vast majority of real-world exits.
  const names: Record<number, string> = {
    1: "SIGHUP",
    2: "SIGINT",
    3: "SIGQUIT",
    6: "SIGABRT",
    9: "SIGKILL",
    13: "SIGPIPE",
    14: "SIGALRM",
    15: "SIGTERM",
  };
  return names[signal] ?? `SIG${signal}`;
}

/**
 * Platform-aware kill. On Windows, `taskkill /T /F` kills the process tree;
 * on POSIX, sends the requested signal directly.
 */
function platformKill(
  proc: { pid: number; kill(signal?: string): void },
  signal: "SIGTERM" | "SIGKILL",
): void {
  if (process.platform === "win32") {
    try {
      spawnSync("taskkill", ["/pid", String(proc.pid), "/T", "/F"], { stdio: "ignore" });
      return;
    } catch {
      // fallthrough — try native kill
    }
  }
  proc.kill(signal);
}

function spawnHandle(
  proc: {
    pid: number;
    write(d: string): void;
    resize(c: number, r: number): void;
    kill(s?: string): void;
    onData(cb: (d: string) => void): () => void;
    onExit(cb: (e: { exitCode: number; signal: number | null }) => void): () => void;
  },
  input: ExecutorSpawnInput,
): ExecutorHandle {
  let userInitiated = false;

  return {
    executor: "direct" as const,
    pid: proc.pid ?? null,
    nativeKey: String(proc.pid ?? `pty-${input.instanceId}`),

    write: (data: string) =>
      Effect.try({
        try: () => proc.write(data),
        catch: (cause) => new ExecutorError("io-error", "write failed", cause),
      }),

    resize: (cols: number, rows: number) =>
      Effect.try({
        try: () => proc.resize(cols, rows),
        catch: (cause) => new ExecutorError("io-error", "resize failed", cause),
      }),

    stop: () =>
      Effect.try({
        try: () => {
          userInitiated = true;
          platformKill(proc, "SIGTERM");
        },
        catch: (cause) => new ExecutorError("io-error", "stop failed", cause),
      }),

    forceKill: () =>
      Effect.try({
        try: () => {
          userInitiated = true;
          platformKill(proc, "SIGKILL");
        },
        catch: (cause) => new ExecutorError("io-error", "forceKill failed", cause),
      }),

    onData: (handler: (chunk: string) => void) => {
      const unsubscribe = proc.onData(handler);
      return { unsubscribe };
    },

    onExit: (
      handler: (event: {
        exitCode: number | null;
        signal: string | null;
        userInitiated: boolean;
      }) => void,
    ) => {
      const unsubscribe = proc.onExit((event) => {
        handler({
          exitCode: event.exitCode,
          signal: signalName(event.signal),
          userInitiated,
        });
      });
      return { unsubscribe };
    },
  };
}

// ---------------------------------------------------------------------------
// Layer
// ---------------------------------------------------------------------------

export const DirectPtyExecutorLive = Layer.effect(
  Executor,
  Effect.gen(function* () {
    const ptyAdapter = yield* PtyAdapter;
    const shellResolver = yield* TerminalShellResolver;

    return {
      kind: "direct" as const,

      spawn: (input: ExecutorSpawnInput) =>
        Effect.gen(function* () {
          const candidates = shellResolver.resolve();
          const shell = candidates[0];
          if (!shell) {
            return yield* Effect.fail(
              new ExecutorError("spawn-failed", "no shell candidate found"),
            );
          }

          const spawnEnv = shellResolver.createSpawnEnv(process.env, input.env);

          const proc = yield* ptyAdapter
            .spawn({
              shell: shell.shell,
              args: [...(shell.args ?? []), "-c", input.command],
              cwd: input.cwd,
              cols: input.cols,
              rows: input.rows,
              env: spawnEnv,
            })
            .pipe(Effect.mapError((err) => new ExecutorError("spawn-failed", err.message, err)));

          return spawnHandle(proc, input);
        }),

      reattach: (input: { instanceId: string; nativeKey: string; cols: number; rows: number }) =>
        Effect.fail(
          new ExecutorError(
            "not-running",
            `direct executor cannot reattach to instance ${input.instanceId}`,
          ),
        ),
    };
  }),
);
