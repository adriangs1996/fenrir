/**
 * PortlessWrapper - Command transformation for portless proxy integration.
 *
 * Wraps process commands with the portless CLI when a proxy is configured,
 * and observes PTY output for URL confirmation.
 *
 * @module ManagedProcess/PortlessWrapper
 */
import { Effect, Context } from "effect";
import type { ManagedProcess } from "@fenrir/contracts";

// ---------------------------------------------------------------------------
// Wrap result
// ---------------------------------------------------------------------------

export interface PortlessWrapResult {
  readonly command: string;
  readonly urlEstimate: string | null;
  /** `null` when proxy is not configured. */
  readonly executable: "portless" | null;
}

// ---------------------------------------------------------------------------
// Error
// ---------------------------------------------------------------------------

export class PortlessWrapperError extends Error {
  readonly _tag = "PortlessWrapperError";
  constructor(
    public readonly code: "portless-not-found",
    message: string,
  ) {
    super(message);
  }
}

// ---------------------------------------------------------------------------
// URL observer (stateful, returned per-instance)
// ---------------------------------------------------------------------------

export interface PortlessUrlObserver {
  /** Returns the confirmed URL the first time it appears; `null` otherwise. */
  observe(chunk: string): string | null;
}

// ---------------------------------------------------------------------------
// Service shape + tag
// ---------------------------------------------------------------------------

export interface PortlessWrapperShape {
  /** Build the final shell command and the predicted URL. */
  wrap(input: {
    definition: ManagedProcess;
    worktreePath: string | null;
    branchName: string | null;
  }): Effect.Effect<PortlessWrapResult, PortlessWrapperError>;

  /** Watch a stream of PTY chunks for the first portless URL line. */
  observeUrlConfirmation(input: { definition: ManagedProcess }): PortlessUrlObserver;
}

export class PortlessWrapper extends Context.Service<PortlessWrapper, PortlessWrapperShape>()(
  "t3/managedProcess/PortlessWrapper",
) {}
