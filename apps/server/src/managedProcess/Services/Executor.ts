/**
 * Executor - Abstraction over process execution strategies.
 *
 * Defines the contract for spawning and controlling managed processes.
 * Implementations live in `Layers/` (DirectPtyExecutor, future TmuxExecutor).
 *
 * @module ManagedProcess/Executor
 */
import { Effect, ServiceMap } from "effect";
import type { ManagedProcessExecutorKind } from "@fenrir/contracts";

// ---------------------------------------------------------------------------
// Spawn input
// ---------------------------------------------------------------------------

export interface ExecutorSpawnInput {
  readonly instanceId: string;
  /** Full command string — already wrapped with portless if proxy is configured. */
  readonly command: string;
  /** Absolute, validated working directory. */
  readonly cwd: string;
  readonly env: Record<string, string>;
  readonly cols: number;
  readonly rows: number;
}

// ---------------------------------------------------------------------------
// Handle — returned after a successful spawn
// ---------------------------------------------------------------------------

export interface ExecutorHandle {
  readonly executor: ManagedProcessExecutorKind;
  readonly pid: number | null;
  /** Per-executor identifier (tmux: window name; direct: native pid as string). */
  readonly nativeKey: string;

  write(data: string): Effect.Effect<void, ExecutorError>;
  resize(cols: number, rows: number): Effect.Effect<void, ExecutorError>;

  /**
   * SIGTERM (or tmux equivalent).
   * Sets a user-initiated flag so the manager treats the resulting exit as
   * `stopped`, not `crashed`.
   */
  stop(): Effect.Effect<void, ExecutorError>;

  /** SIGKILL / `tmux kill-window`. */
  forceKill(): Effect.Effect<void, ExecutorError>;

  /** Live data stream from the process. Caller is responsible for unsubscribing. */
  onData(handler: (chunk: string) => void): { unsubscribe: () => void };

  /** Terminal exit. Fires once per handle. */
  onExit(
    handler: (event: {
      exitCode: number | null;
      signal: string | null;
      userInitiated: boolean;
    }) => void,
  ): { unsubscribe: () => void };
}

// ---------------------------------------------------------------------------
// Error
// ---------------------------------------------------------------------------

export class ExecutorError extends Error {
  readonly _tag = "ExecutorError";
  constructor(
    public readonly code: "spawn-failed" | "not-running" | "tmux-unavailable" | "io-error",
    message: string,
    cause?: unknown,
  ) {
    super(message);
    this.cause = cause;
  }
}

// ---------------------------------------------------------------------------
// Service shape + tag
// ---------------------------------------------------------------------------

export interface ExecutorShape {
  readonly kind: ManagedProcessExecutorKind;

  spawn(input: ExecutorSpawnInput): Effect.Effect<ExecutorHandle, ExecutorError>;

  /**
   * Re-attach to an instance whose PersistedInstanceRecord still exists.
   * Only the tmux implementation provides this — direct mode always rejects.
   */
  reattach?(input: {
    instanceId: string;
    nativeKey: string;
    cols: number;
    rows: number;
  }): Effect.Effect<ExecutorHandle, ExecutorError>;
}

export class Executor extends ServiceMap.Service<Executor, ExecutorShape>()(
  "t3/managedProcess/Executor",
) {}
