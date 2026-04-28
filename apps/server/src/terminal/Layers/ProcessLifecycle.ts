/**
 * TerminalProcessLifecycle Layer - PTY process kill escalation and subprocess detection.
 *
 * Handles graceful shutdown (SIGTERM → grace period → SIGKILL) and
 * platform-specific subprocess activity polling.
 *
 * @module TerminalProcessLifecycleLayer
 */
import { Data, Effect, Exit, Fiber, Layer, Option, Scope, SynchronizedRef } from "effect";

import { runProcess } from "../../processRunner";
import {
  TerminalProcessLifecycle,
  type TerminalProcessLifecycleShape,
} from "../Services/ProcessLifecycle";
import type { PtyProcess } from "../Services/PTY";

const DEFAULT_PROCESS_KILL_GRACE_MS = 1_000;

class TerminalSubprocessCheckError extends Data.TaggedError("TerminalSubprocessCheckError")<{
  readonly message: string;
  readonly cause?: unknown;
  readonly terminalPid: number;
  readonly command: "powershell" | "pgrep" | "ps";
}> {}

class TerminalProcessSignalError extends Data.TaggedError("TerminalProcessSignalError")<{
  readonly message: string;
  readonly cause?: unknown;
  readonly signal: "SIGTERM" | "SIGKILL";
}> {}

function checkWindowsSubprocessActivity(
  terminalPid: number,
): Effect.Effect<boolean, TerminalSubprocessCheckError> {
  const command = [
    `$children = Get-CimInstance Win32_Process -Filter "ParentProcessId = ${terminalPid}" -ErrorAction SilentlyContinue`,
    "if ($children) { exit 0 }",
    "exit 1",
  ].join("; ");
  return Effect.tryPromise({
    try: () =>
      runProcess("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", command], {
        timeoutMs: 1_500,
        allowNonZeroExit: true,
        maxBufferBytes: 32_768,
        outputMode: "truncate",
      }),
    catch: (cause) =>
      new TerminalSubprocessCheckError({
        message: "Failed to check Windows terminal subprocess activity.",
        cause,
        terminalPid,
        command: "powershell",
      }),
  }).pipe(Effect.map((result) => result.code === 0));
}

const checkPosixSubprocessActivity = Effect.fn("terminal.checkPosixSubprocessActivity")(function* (
  terminalPid: number,
): Effect.fn.Return<boolean, TerminalSubprocessCheckError> {
  const runPgrep = Effect.tryPromise({
    try: () =>
      runProcess("pgrep", ["-P", String(terminalPid)], {
        timeoutMs: 1_000,
        allowNonZeroExit: true,
        maxBufferBytes: 32_768,
        outputMode: "truncate",
      }),
    catch: (cause) =>
      new TerminalSubprocessCheckError({
        message: "Failed to inspect terminal subprocesses with pgrep.",
        cause,
        terminalPid,
        command: "pgrep",
      }),
  });

  const runPs = Effect.tryPromise({
    try: () =>
      runProcess("ps", ["-eo", "pid=,ppid="], {
        timeoutMs: 1_000,
        allowNonZeroExit: true,
        maxBufferBytes: 262_144,
        outputMode: "truncate",
      }),
    catch: (cause) =>
      new TerminalSubprocessCheckError({
        message: "Failed to inspect terminal subprocesses with ps.",
        cause,
        terminalPid,
        command: "ps",
      }),
  });

  const pgrepResult = yield* Effect.exit(runPgrep);
  if (pgrepResult._tag === "Success") {
    if (pgrepResult.value.code === 0) {
      return pgrepResult.value.stdout.trim().length > 0;
    }
    if (pgrepResult.value.code === 1) {
      return false;
    }
  }

  const psResult = yield* Effect.exit(runPs);
  if (psResult._tag === "Failure" || psResult.value.code !== 0) {
    return false;
  }

  for (const line of psResult.value.stdout.split(/\r?\n/g)) {
    const [pidRaw, ppidRaw] = line.trim().split(/\s+/g);
    const pid = Number(pidRaw);
    const ppid = Number(ppidRaw);
    if (!Number.isInteger(pid) || !Number.isInteger(ppid)) continue;
    if (ppid === terminalPid) {
      return true;
    }
  }
  return false;
});

const defaultSubprocessChecker = Effect.fn("terminal.defaultSubprocessChecker")(function* (
  terminalPid: number,
): Effect.fn.Return<boolean, TerminalSubprocessCheckError> {
  if (!Number.isInteger(terminalPid) || terminalPid <= 0) {
    return false;
  }
  if (process.platform === "win32") {
    return yield* checkWindowsSubprocessActivity(terminalPid);
  }
  return yield* checkPosixSubprocessActivity(terminalPid);
});

export type TerminalSubprocessChecker = (
  terminalPid: number,
) => Effect.Effect<boolean, TerminalSubprocessCheckError>;

export interface ProcessLifecycleOptions {
  processKillGraceMs?: number;
  subprocessChecker?: TerminalSubprocessChecker;
}

export const makeProcessLifecycle = Effect.fn("makeProcessLifecycle")(function* (
  options?: ProcessLifecycleOptions,
) {
  const processKillGraceMs = options?.processKillGraceMs ?? DEFAULT_PROCESS_KILL_GRACE_MS;
  const subprocessChecker = options?.subprocessChecker ?? defaultSubprocessChecker;

  const workerScope = yield* Scope.make("sequential");
  yield* Effect.addFinalizer(() => Scope.close(workerScope, Exit.void));

  const services = yield* Effect.services();
  const runFork = Effect.runForkWith(services);

  const killFibersRef = yield* SynchronizedRef.make(
    new Map<PtyProcess, Fiber.Fiber<void, never>>(),
  );

  const clearKillFiber = Effect.fn("terminal.clearKillFiber")(function* (
    process: PtyProcess | null,
  ) {
    if (!process) return;
    const fiber: Option.Option<Fiber.Fiber<void, never>> = yield* SynchronizedRef.modify(
      killFibersRef,
      (killFibers) => {
        const existing: Option.Option<Fiber.Fiber<void, never>> = Option.fromNullishOr(
          killFibers.get(process),
        );
        if (Option.isNone(existing)) {
          return [Option.none<Fiber.Fiber<void, never>>(), killFibers] as const;
        }
        const next = new Map(killFibers);
        next.delete(process);
        return [existing, next] as const;
      },
    );
    if (Option.isSome(fiber)) {
      yield* Fiber.interrupt(fiber.value).pipe(Effect.ignore);
    }
  });

  const registerKillFiber = Effect.fn("terminal.registerKillFiber")(function* (
    process: PtyProcess,
    fiber: Fiber.Fiber<void, never>,
  ) {
    yield* SynchronizedRef.modify(killFibersRef, (killFibers) => {
      const next = new Map(killFibers);
      next.set(process, fiber);
      return [undefined, next] as const;
    });
  });

  const runKillEscalation = Effect.fn("terminal.runKillEscalation")(function* (
    process: PtyProcess,
    threadId: string,
    terminalId: string,
  ) {
    const terminated = yield* Effect.try({
      try: () => process.kill("SIGTERM"),
      catch: (cause) =>
        new TerminalProcessSignalError({
          message: "Failed to send SIGTERM to terminal process.",
          cause,
          signal: "SIGTERM",
        }),
    }).pipe(
      Effect.as(true),
      Effect.catch((error) =>
        Effect.logWarning("failed to kill terminal process", {
          threadId,
          terminalId,
          signal: "SIGTERM",
          error: error.message,
        }).pipe(Effect.as(false)),
      ),
    );
    if (!terminated) {
      return;
    }

    yield* Effect.sleep(processKillGraceMs);

    yield* Effect.try({
      try: () => process.kill("SIGKILL"),
      catch: (cause) =>
        new TerminalProcessSignalError({
          message: "Failed to send SIGKILL to terminal process.",
          cause,
          signal: "SIGKILL",
        }),
    }).pipe(
      Effect.catch((error) =>
        Effect.logWarning("failed to force-kill terminal process", {
          threadId,
          terminalId,
          signal: "SIGKILL",
          error: error.message,
        }),
      ),
    );
  });

  const startKillEscalation = Effect.fn("terminal.startKillEscalation")(function* (
    process: PtyProcess,
    threadId: string,
    terminalId: string,
  ) {
    const fiber = yield* runKillEscalation(process, threadId, terminalId).pipe(
      Effect.ensuring(
        SynchronizedRef.modify(killFibersRef, (killFibers) => {
          if (!killFibers.has(process)) {
            return [undefined, killFibers] as const;
          }
          const next = new Map(killFibers);
          next.delete(process);
          return [undefined, next] as const;
        }),
      ),
      Effect.forkIn(workerScope),
    );

    yield* registerKillFiber(process, fiber);
  });

  return {
    startKillEscalation,
    clearKillFiber,
    registerKillFiber,

    checkSubprocessActivity: Effect.fn("terminal.checkSubprocessActivity")(function* (
      terminalPid: number,
    ) {
      return yield* subprocessChecker(terminalPid).pipe(
        Effect.catch((error) =>
          Effect.logWarning("failed to check terminal subprocess activity", {
            terminalPid,
            error: error instanceof Error ? error.message : String(error),
          }).pipe(Effect.as(false)),
        ),
      );
    }),
  } satisfies TerminalProcessLifecycleShape;
});

export const TerminalProcessLifecycleLive = Layer.effect(
  TerminalProcessLifecycle,
  makeProcessLifecycle(),
);
