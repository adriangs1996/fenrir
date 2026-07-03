/**
 * ProjectionRetention - Bounded pruning primitives for projection tables.
 *
 * Owns the delete/lookup queries used by the retention sweeps. It does not
 * decide retention policy (grace periods, caps, batch cadence): callers own
 * the safety policy, mirroring `OrchestrationEventStore.pruneThroughSequence`.
 *
 * @module ProjectionRetention
 */
import { Context } from "effect";
import type { Effect } from "effect";

import type { PersistenceSqlError } from "../Errors.ts";

/**
 * ProjectionRetentionShape - Service API for projection retention queries.
 */
export interface ProjectionRetentionShape {
  /**
   * List ids of soft-deleted threads that still have projection rows to
   * reclaim in any per-thread projection table.
   *
   * Threads whose per-thread rows are already fully purged are not returned,
   * so a sweep loop that purges every returned thread terminates.
   *
   * @param deletedBeforeIso - Only threads soft-deleted strictly before this
   *   instant are eligible (grace window owned by the caller).
   */
  readonly listPurgeableDeletedThreadIds: (input: {
    readonly deletedBeforeIso: string;
    readonly limit: number;
  }) => Effect.Effect<ReadonlyArray<string>, PersistenceSqlError>;

  /**
   * Delete a bounded batch of per-thread projection rows for one thread
   * (activities, messages, turns, proposed plans, sessions, pending
   * approvals, image artifacts). The `projection_threads` tombstone row is
   * kept for identity/dedup.
   *
   * @returns Effect containing the number of deleted rows (0 when the thread
   *   has no per-thread rows left).
   */
  readonly purgeDeletedThreadRowsBatch: (input: {
    readonly threadId: string;
    readonly limit: number;
  }) => Effect.Effect<number, PersistenceSqlError>;

  /**
   * List ids of threads holding more than `keepCount` activity rows.
   */
  readonly listActivityCapExceedingThreadIds: (input: {
    readonly keepCount: number;
  }) => Effect.Effect<ReadonlyArray<string>, PersistenceSqlError>;

  /**
   * Resolve the `created_at` of the `keepCount`-th newest activity of a
   * thread, or null when the thread holds `keepCount` rows or fewer.
   * Activities strictly older than the returned instant are beyond the cap.
   */
  readonly getActivityCapCutoff: (input: {
    readonly threadId: string;
    readonly keepCount: number;
  }) => Effect.Effect<string | null, PersistenceSqlError>;

  /**
   * Delete a bounded batch of a thread's activity rows strictly older than
   * `beforeIso`, oldest first.
   *
   * @returns Effect containing the number of deleted rows.
   */
  readonly pruneActivitiesBefore: (input: {
    readonly threadId: string;
    readonly beforeIso: string;
    readonly limit: number;
  }) => Effect.Effect<number, PersistenceSqlError>;
}

/**
 * ProjectionRetention - Service tag for projection retention queries.
 */
export class ProjectionRetention extends Context.Service<
  ProjectionRetention,
  ProjectionRetentionShape
>()("t3/persistence/Services/ProjectionRetention") {}
