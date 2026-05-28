/**
 * TerminalProcessLifecycle - Internal service for PTY process lifecycle.
 *
 * Handles kill escalation (SIGTERM → grace → SIGKILL) and subprocess
 * activity detection via platform-specific process inspection.
 *
 * @module TerminalProcessLifecycle
 * @internal Consumed only by TerminalManager layer.
 */
import { Effect, Fiber, Context } from "effect";
import type { PtyProcess } from "./PTY";

/**
 * TerminalProcessLifecycleShape - Service API for process lifecycle management.
 */
export interface TerminalProcessLifecycleShape {
  /**
   * Start kill escalation for a PTY process.
   * Sends SIGTERM, waits grace period, then SIGKILL if still alive.
   * Runs in background fiber and tracks via kill fiber registry.
   */
  readonly startKillEscalation: (
    process: PtyProcess,
    threadId: string,
    terminalId: string,
  ) => Effect.Effect<void>;

  /**
   * Clear any pending kill fiber for a process.
   */
  readonly clearKillFiber: (process: PtyProcess | null) => Effect.Effect<void>;

  /**
   * Register a kill fiber for tracking.
   */
  readonly registerKillFiber: (
    process: PtyProcess,
    fiber: Fiber.Fiber<void, never>,
  ) => Effect.Effect<void>;

  /**
   * Check if a terminal PID has running subprocess children.
   * Platform-specific: pgrep/ps on POSIX, WMI on Windows.
   */
  readonly checkSubprocessActivity: (terminalPid: number) => Effect.Effect<boolean>;
}

/**
 * TerminalProcessLifecycle - Service tag for process lifecycle management.
 */
export class TerminalProcessLifecycle extends Context.Service<
  TerminalProcessLifecycle,
  TerminalProcessLifecycleShape
>()("t3/terminal/Services/ProcessLifecycle/TerminalProcessLifecycle") {}
