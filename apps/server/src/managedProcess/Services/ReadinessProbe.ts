/**
 * ReadinessProbe - Readiness detection for managed processes.
 *
 * Creates per-instance probe handles that fire `onReady` when the process
 * is confirmed ready (via HTTP probe, log pattern match, or immediately).
 *
 * @module ManagedProcess/ReadinessProbe
 */
import { Context } from "effect";
import type { ManagedProcess } from "@fenrir/contracts";

// ---------------------------------------------------------------------------
// Probe handle (per-instance, stateful)
// ---------------------------------------------------------------------------

export interface ReadinessProbeHandle {
  start(): void;
  stop(): void;
  /** Forwarded by the manager for log-pattern probes. */
  observe(chunk: string): void;
  onReady(handler: () => void): { unsubscribe: () => void };
}

// ---------------------------------------------------------------------------
// Service shape + tag
// ---------------------------------------------------------------------------

export interface ReadinessProbeShape {
  create(input: {
    instanceId: string;
    definition: ManagedProcess;
    urlEstimate: string | null;
    /** Closure read by portless-http probe at probe-time. */
    urlConfirmed: () => string | null;
  }): ReadinessProbeHandle;
}

export class ReadinessProbe extends Context.Service<ReadinessProbe, ReadinessProbeShape>()(
  "t3/managedProcess/ReadinessProbe",
) {}
