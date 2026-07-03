import { Clock, Duration, Effect, Layer } from "effect";

import { ProjectionRetention } from "../../persistence/Services/ProjectionRetention.ts";

/**
 * Per-thread projection rows are never reclaimed by the event pipeline:
 * `thread.deleted` is a soft delete that only tombstones `projection_threads`
 * (observed 298k orphaned activity rows / 844MB on a long-lived install), and
 * live threads accumulate unbounded activity history far beyond what any
 * reader needs (`THREAD_ACTIVITY_READ_MODEL_LIMIT` hydrates 500 per thread).
 *
 * Two rules, both bounded and batched so the sweep never monopolizes the
 * SQLite connection:
 * - Threads soft-deleted for longer than `DELETED_THREAD_GRACE_DAYS` get all
 *   per-thread projection rows purged (the `projection_threads` tombstone is
 *   kept for identity).
 * - Live threads keep at most `ACTIVITY_KEEP_PER_THREAD` activity rows;
 *   overflow is pruned oldest-first, but never rows younger than
 *   `ACTIVITY_PRUNE_MIN_AGE_DAYS`.
 */
export const DELETED_THREAD_GRACE_DAYS = 7;
export const ACTIVITY_KEEP_PER_THREAD = 2_000;
export const ACTIVITY_PRUNE_MIN_AGE_DAYS = 7;
export const THREAD_PROJECTION_RETENTION_BATCH_SIZE = 2_000;

const SWEEP_INTERVAL = Duration.hours(6);
const SWEEP_INITIAL_DELAY = Duration.minutes(4);
// Pause between delete batches so the sweep never monopolizes the SQLite
// connection while the server is handling live traffic.
const BATCH_PAUSE = Duration.millis(250);
const PURGEABLE_THREADS_PAGE_SIZE = 200;

export interface ThreadProjectionRetentionSweepResult {
  readonly purgedThreadCount: number;
  readonly purgedRowCount: number;
  readonly prunedActivityCount: number;
}

const minIso = (a: string, b: string): string => (a < b ? a : b);

export const runThreadProjectionRetentionSweep: Effect.Effect<
  ThreadProjectionRetentionSweepResult,
  never,
  ProjectionRetention
> = Effect.gen(function* () {
  const retention = yield* ProjectionRetention;
  const nowMs = yield* Clock.currentTimeMillis;
  const dayMs = 24 * 60 * 60 * 1000;
  const deletedBeforeIso = new Date(nowMs - DELETED_THREAD_GRACE_DAYS * dayMs).toISOString();
  const activityMinAgeIso = new Date(nowMs - ACTIVITY_PRUNE_MIN_AGE_DAYS * dayMs).toISOString();

  let purgedThreadCount = 0;
  let purgedRowCount = 0;

  // Purge soft-deleted threads. The listing only returns threads that still
  // have per-thread rows, so purging every returned thread makes progress and
  // the loop terminates.
  for (;;) {
    const threadIds = yield* retention.listPurgeableDeletedThreadIds({
      deletedBeforeIso,
      limit: PURGEABLE_THREADS_PAGE_SIZE,
    });
    if (threadIds.length === 0) {
      break;
    }
    for (const threadId of threadIds) {
      purgedThreadCount += 1;
      for (;;) {
        const deleted = yield* retention.purgeDeletedThreadRowsBatch({
          threadId,
          limit: THREAD_PROJECTION_RETENTION_BATCH_SIZE,
        });
        purgedRowCount += deleted;
        if (deleted < THREAD_PROJECTION_RETENTION_BATCH_SIZE) {
          break;
        }
        yield* Effect.sleep(BATCH_PAUSE);
      }
    }
    if (threadIds.length < PURGEABLE_THREADS_PAGE_SIZE) {
      break;
    }
    yield* Effect.sleep(BATCH_PAUSE);
  }

  // Cap activity history for the remaining threads.
  let prunedActivityCount = 0;
  const capThreadIds = yield* retention.listActivityCapExceedingThreadIds({
    keepCount: ACTIVITY_KEEP_PER_THREAD,
  });
  for (const threadId of capThreadIds) {
    const cutoff = yield* retention.getActivityCapCutoff({
      threadId,
      keepCount: ACTIVITY_KEEP_PER_THREAD,
    });
    if (cutoff === null) {
      continue;
    }
    const beforeIso = minIso(cutoff, activityMinAgeIso);
    for (;;) {
      const deleted = yield* retention.pruneActivitiesBefore({
        threadId,
        beforeIso,
        limit: THREAD_PROJECTION_RETENTION_BATCH_SIZE,
      });
      prunedActivityCount += deleted;
      if (deleted < THREAD_PROJECTION_RETENTION_BATCH_SIZE) {
        break;
      }
      yield* Effect.sleep(BATCH_PAUSE);
    }
  }

  if (purgedRowCount > 0 || prunedActivityCount > 0) {
    yield* Effect.logInfo("pruned thread projections").pipe(
      Effect.annotateLogs({
        purgedThreadCount,
        purgedRowCount,
        prunedActivityCount,
        deletedBefore: deletedBeforeIso,
      }),
    );
  }

  return { purgedThreadCount, purgedRowCount, prunedActivityCount };
}).pipe(
  Effect.catch((cause) =>
    Effect.logWarning("thread projection retention sweep failed", { cause }).pipe(
      Effect.as({ purgedThreadCount: 0, purgedRowCount: 0, prunedActivityCount: 0 }),
    ),
  ),
);

export const ThreadProjectionRetentionLive: Layer.Layer<never, never, ProjectionRetention> =
  Layer.effectDiscard(
    Effect.gen(function* () {
      yield* Effect.sleep(SWEEP_INITIAL_DELAY)
        .pipe(
          Effect.andThen(
            Effect.forever(
              runThreadProjectionRetentionSweep.pipe(Effect.andThen(Effect.sleep(SWEEP_INTERVAL))),
            ),
          ),
        )
        .pipe(Effect.forkScoped);
    }),
  );
