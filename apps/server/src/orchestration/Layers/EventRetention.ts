import { Clock, Duration, Effect, Layer } from "effect";

import { OrchestrationEventStore } from "../../persistence/Services/OrchestrationEventStore.ts";
import { ProjectionStateRepository } from "../../persistence/Services/ProjectionState.ts";

/**
 * The persisted `projection_*` tables are the durable snapshot of the event
 * stream: once every projector cursor has applied a sequence, the raw events
 * at or below it are only needed for client replay-recovery over recent
 * history. Without retention `orchestration_events` grows without bound
 * (observed at 1.6GB on a long-lived install).
 *
 * An event is deleted only when BOTH hold:
 * - `sequence <= min(projector cursors) - EVENT_RETENTION_SEQUENCE_MARGIN`
 *   (every projection has applied it, and a generous window of already
 *   projected events is kept for client `replayEvents` recovery), and
 * - it is older than `EVENT_RETENTION_MIN_AGE_DAYS` (clients that reconnect
 *   within the window always see a contiguous replay).
 *
 * Rebuilding a projector from sequence 0 stops being possible once events are
 * pruned — new projectors must bootstrap from existing projections instead.
 */
// Replay recovery only ever needs recent history (clients reconnect within
// minutes); 30 days accumulated 1GB+ of events on a heavily used install.
export const EVENT_RETENTION_MIN_AGE_DAYS = 7;
export const EVENT_RETENTION_SEQUENCE_MARGIN = 10_000;
export const EVENT_RETENTION_BATCH_SIZE = 5_000;

const SWEEP_INTERVAL = Duration.hours(6);
const SWEEP_INITIAL_DELAY = Duration.minutes(3);
// Pause between delete batches so the sweep never monopolizes the SQLite
// connection while the server is handling live traffic.
const BATCH_PAUSE = Duration.millis(250);

export interface OrchestrationEventRetentionSweepResult {
  readonly deletedCount: number;
}

export const runOrchestrationEventRetentionSweep: Effect.Effect<
  OrchestrationEventRetentionSweepResult,
  never,
  OrchestrationEventStore | ProjectionStateRepository
> = Effect.gen(function* () {
  const projectionState = yield* ProjectionStateRepository;
  const eventStore = yield* OrchestrationEventStore;

  const minAppliedSequence = yield* projectionState.minLastAppliedSequence();
  if (minAppliedSequence === null) {
    return { deletedCount: 0 };
  }

  const sequenceInclusive = minAppliedSequence - EVENT_RETENTION_SEQUENCE_MARGIN;
  if (sequenceInclusive <= 0) {
    return { deletedCount: 0 };
  }

  const nowMs = yield* Clock.currentTimeMillis;
  const olderThanIso = new Date(
    nowMs - EVENT_RETENTION_MIN_AGE_DAYS * 24 * 60 * 60 * 1000,
  ).toISOString();

  let deletedCount = 0;
  for (;;) {
    const deleted = yield* eventStore.pruneThroughSequence({
      sequenceInclusive,
      olderThanIso,
      limit: EVENT_RETENTION_BATCH_SIZE,
    });
    deletedCount += deleted;
    if (deleted < EVENT_RETENTION_BATCH_SIZE) {
      break;
    }
    yield* Effect.sleep(BATCH_PAUSE);
  }

  if (deletedCount > 0) {
    yield* Effect.logInfo("pruned orchestration events").pipe(
      Effect.annotateLogs({
        deletedCount,
        throughSequence: sequenceInclusive,
        olderThan: olderThanIso,
      }),
    );
  }

  return { deletedCount };
}).pipe(
  Effect.catch((cause) =>
    Effect.logWarning("orchestration event retention sweep failed", { cause }).pipe(
      Effect.as({ deletedCount: 0 }),
    ),
  ),
);

export const OrchestrationEventRetentionLive: Layer.Layer<
  never,
  never,
  OrchestrationEventStore | ProjectionStateRepository
> = Layer.effectDiscard(
  Effect.gen(function* () {
    yield* Effect.sleep(SWEEP_INITIAL_DELAY)
      .pipe(
        Effect.andThen(
          Effect.forever(
            runOrchestrationEventRetentionSweep.pipe(Effect.andThen(Effect.sleep(SWEEP_INTERVAL))),
          ),
        ),
      )
      .pipe(Effect.forkScoped);
  }),
);
