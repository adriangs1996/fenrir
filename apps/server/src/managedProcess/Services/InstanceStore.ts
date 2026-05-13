/**
 * InstanceStore - Persistence service for managed process instance metadata.
 *
 * Stores per-project JSON files containing instance records used for
 * re-attach reconciliation on server boot.
 *
 * @module ManagedProcess/InstanceStore
 */
import { Effect, ServiceMap } from "effect";
import type { ManagedProcess, ManagedProcessExecutorKind, ProjectId } from "@fenrir/contracts";

export interface PersistedInstanceRecord {
  readonly instanceId: string;
  readonly processDefId: string;
  readonly projectId: ProjectId;
  readonly worktreePath: string | null;
  readonly startedAt: string; // ISO
  readonly definitionSnapshot: ManagedProcess;
  readonly executor: ManagedProcessExecutorKind;
  readonly tmuxWindow: string | null;
  readonly pid: number | null;
}

export class InstanceStoreError extends Error {
  readonly _tag = "InstanceStoreError";
  constructor(
    public readonly code: "io" | "decode",
    message: string,
    cause?: unknown,
  ) {
    super(message);
    this.cause = cause;
  }
}

export interface InstanceStoreShape {
  list(projectId: ProjectId): Effect.Effect<PersistedInstanceRecord[], InstanceStoreError>;
  upsert(record: PersistedInstanceRecord): Effect.Effect<void, InstanceStoreError>;
  remove(instanceId: string): Effect.Effect<void, InstanceStoreError>;
  listAll(): Effect.Effect<PersistedInstanceRecord[], InstanceStoreError>;
}

export class InstanceStore extends ServiceMap.Service<InstanceStore, InstanceStoreShape>()(
  "t3/managedProcess/InstanceStore",
) {}
