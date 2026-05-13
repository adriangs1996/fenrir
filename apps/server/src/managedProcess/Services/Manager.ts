/**
 * ManagedProcessManager - Service interface for managed process lifecycle.
 *
 * Owns the in-memory instance map, drives the chosen executor, persists
 * records, manages the log buffer, and emits domain events.
 *
 * @module ManagedProcess/Manager
 */
import type {
  ManagedProcessInstance,
  ManagedProcessInstanceStatus,
  ManagedProcessExecutorKind,
  ManagedProcessRpcError,
  ProjectId,
} from "@fenrir/contracts";
import type { Effect, Stream } from "effect";
import { ServiceMap } from "effect";

// ---------------------------------------------------------------------------
// Lifecycle events (emitted for fan-out to orchestration domain channel)
// ---------------------------------------------------------------------------

export type ManagerLifecycleEvent =
  | { readonly type: "started"; readonly instance: ManagedProcessInstance }
  | {
      readonly type: "stateChanged";
      readonly instanceId: string;
      readonly prev: ManagedProcessInstanceStatus;
      readonly next: ManagedProcessInstanceStatus;
      readonly exitCode: number | null;
      readonly exitSignal: string | null;
      readonly lastError: string | null;
    }
  | {
      readonly type: "readyChanged";
      readonly instanceId: string;
      readonly ready: boolean;
      readonly url: { readonly estimate: string | null; readonly confirmed: string | null };
    }
  | {
      readonly type: "exited";
      readonly instanceId: string;
      readonly exitCode: number | null;
      readonly exitSignal: string | null;
      readonly userInitiated: boolean;
    };

// ---------------------------------------------------------------------------
// Service shape
// ---------------------------------------------------------------------------

export interface ManagedProcessManagerShape {
  readonly executorKind: ManagedProcessExecutorKind;

  start(input: {
    projectId: ProjectId;
    processDefId: string;
    worktreePath: string | null;
  }): Effect.Effect<ManagedProcessInstance, ManagedProcessRpcError>;

  stop(instanceId: string): Effect.Effect<ManagedProcessInstance, ManagedProcessRpcError>;
  forceKill(instanceId: string): Effect.Effect<ManagedProcessInstance, ManagedProcessRpcError>;
  restart(instanceId: string): Effect.Effect<ManagedProcessInstance, ManagedProcessRpcError>;

  writeStdin(input: {
    instanceId: string;
    data: string;
  }): Effect.Effect<void, ManagedProcessRpcError>;

  list(projectId: ProjectId): Effect.Effect<ManagedProcessInstance[], never>;

  /** Stream lifecycle events for fan-out to orchestration domain channel. */
  readonly events: Stream.Stream<ManagerLifecycleEvent>;

  /** Subscribe to log chunks for an instance. Returns backfill + live stream. */
  subscribeLog(instanceId: string): Effect.Effect<
    {
      backfill: {
        bytes: string;
        ringBufferBytes: number;
        truncated: boolean;
        sequenceNumber: number;
      };
      stream: Stream.Stream<{ bytes: string; sequenceNumber: number }>;
    },
    ManagedProcessRpcError
  >;
}

// ---------------------------------------------------------------------------
// Service tag
// ---------------------------------------------------------------------------

export class ManagedProcessManager extends ServiceMap.Service<
  ManagedProcessManager,
  ManagedProcessManagerShape
>()("t3/managedProcess/Manager") {}
