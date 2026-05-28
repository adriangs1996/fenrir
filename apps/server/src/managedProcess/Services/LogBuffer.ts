/**
 * LogBuffer - Per-instance ring buffer + on-disk append log for PTY output.
 *
 * The in-memory ring buffer is the user-visible source of truth for backfill.
 * The on-disk log is best-effort durability (errors are logged, not propagated).
 *
 * @module ManagedProcess/LogBuffer
 */
import { Effect, Context } from "effect";
import type { ProjectId } from "@fenrir/contracts";

export interface LogBufferReadResult {
  readonly bytes: string;
  readonly ringBufferBytes: number;
  readonly truncated: boolean;
  readonly sequenceNumber: number;
}

export interface LogBufferShape {
  /** Allocate a buffer for an instance. Closes any prior buffer on the same key. */
  open(input: {
    instanceId: string;
    projectId: ProjectId;
    worktreePath: string | null;
    processDefId: string;
  }): Effect.Effect<void, never>;

  /** Append PTY bytes; rotates ring buffer + writes to disk. */
  append(instanceId: string, bytes: string): Effect.Effect<void, never>;

  /** Snapshot current ring buffer for backfill. */
  read(instanceId: string): Effect.Effect<LogBufferReadResult, never>;

  /** Subscribe to live chunks for this instance. */
  subscribe(
    instanceId: string,
    handler: (chunk: { bytes: string; sequenceNumber: number }) => void,
  ): Effect.Effect<{ unsubscribe: () => void }, never>;

  /** Close the buffer, flush disk, and rotate `.log` -> `.log.previous`. */
  closeAndRotate(instanceId: string): Effect.Effect<void, never>;
}

export class LogBuffer extends Context.Service<LogBuffer, LogBufferShape>()(
  "t3/managedProcess/LogBuffer",
) {}
