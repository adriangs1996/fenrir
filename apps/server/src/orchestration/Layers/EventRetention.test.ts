import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import { Duration, Effect, Layer } from "effect";
import { TestClock } from "effect/testing";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import { OrchestrationEventStoreLive } from "../../persistence/Layers/OrchestrationEventStore.ts";
import { ProjectionStateRepositoryLive } from "../../persistence/Layers/ProjectionState.ts";
import { SqlitePersistenceMemory } from "../../persistence/Layers/Sqlite.ts";
import { OrchestrationEventStore } from "../../persistence/Services/OrchestrationEventStore.ts";
import {
  EVENT_RETENTION_SEQUENCE_MARGIN,
  runOrchestrationEventRetentionSweep,
} from "./EventRetention.ts";

const retentionLayer = it.layer(
  Layer.mergeAll(OrchestrationEventStoreLive, ProjectionStateRepositoryLive).pipe(
    Layer.provideMerge(SqlitePersistenceMemory),
    Layer.provideMerge(NodeServices.layer),
  ),
);

const insertEvent = (
  sql: SqlClient.SqlClient,
  input: {
    readonly sequence: number;
    readonly occurredAt: string;
  },
) =>
  sql`
    INSERT INTO orchestration_events (
      sequence,
      event_id,
      aggregate_kind,
      stream_id,
      stream_version,
      event_type,
      occurred_at,
      command_id,
      causation_event_id,
      correlation_id,
      actor_kind,
      payload_json,
      metadata_json
    )
    VALUES (
      ${input.sequence},
      ${`event-${input.sequence}`},
      'thread',
      'thread-1',
      ${input.sequence},
      'thread.activity-appended',
      ${input.occurredAt},
      NULL,
      NULL,
      NULL,
      'server',
      '{}',
      '{}'
    )
  `;

const setProjectorCursor = (
  sql: SqlClient.SqlClient,
  projector: string,
  lastAppliedSequence: number,
) =>
  sql`
    INSERT INTO projection_state (projector, last_applied_sequence, updated_at)
    VALUES (${projector}, ${lastAppliedSequence}, '2026-07-01T00:00:00.000Z')
    ON CONFLICT (projector) DO UPDATE SET last_applied_sequence = excluded.last_applied_sequence
  `;

const listEventSequences = (sql: SqlClient.SqlClient) =>
  sql`SELECT sequence FROM orchestration_events ORDER BY sequence ASC`.pipe(
    Effect.map((rows) => rows.map((row) => Number((row as { sequence: number }).sequence))),
  );

const resetTables = (sql: SqlClient.SqlClient) =>
  Effect.all([sql`DELETE FROM orchestration_events`, sql`DELETE FROM projection_state`]);

// The sweep computes its age cutoff from the clock; move the TestClock to a
// fixed "now" so seeded ISO dates land on either side of it deterministically.
const NOW_ISO = "2026-07-01T00:00:00.000Z";
const advanceClockToNow = TestClock.adjust(Duration.millis(Date.parse(NOW_ISO)));

retentionLayer("orchestration event retention", (it) => {
  it.effect("prunes only fully projected events older than the retention window", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      yield* resetTables(sql);
      yield* advanceClockToNow;

      const threshold = 10_000; // min cursor 20_000 - margin 10_000
      yield* setProjectorCursor(sql, "projector-a", EVENT_RETENTION_SEQUENCE_MARGIN + threshold);
      yield* setProjectorCursor(
        sql,
        "projector-b",
        EVENT_RETENTION_SEQUENCE_MARGIN + threshold + 5_000,
      );

      // Old and fully projected: pruned.
      yield* insertEvent(sql, { sequence: 100, occurredAt: "2026-01-01T00:00:00.000Z" });
      // Recent (inside the age window): kept even though fully projected.
      yield* insertEvent(sql, { sequence: 200, occurredAt: "2026-06-30T00:00:00.000Z" });
      // Old but above the sequence threshold (replay margin): kept.
      yield* insertEvent(sql, {
        sequence: threshold + 1,
        occurredAt: "2026-01-01T00:00:00.000Z",
      });

      const result = yield* runOrchestrationEventRetentionSweep;

      assert.equal(result.deletedCount, 1);
      assert.deepEqual(yield* listEventSequences(sql), [200, threshold + 1]);
    }),
  );

  it.effect("does nothing when no projector cursors exist", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      yield* resetTables(sql);
      yield* advanceClockToNow;

      yield* insertEvent(sql, { sequence: 100, occurredAt: "2026-01-01T00:00:00.000Z" });

      const result = yield* runOrchestrationEventRetentionSweep;

      assert.equal(result.deletedCount, 0);
      assert.deepEqual(yield* listEventSequences(sql), [100]);
    }),
  );

  it.effect("deletes oldest-first in bounded batches", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      const eventStore = yield* OrchestrationEventStore;
      yield* resetTables(sql);

      yield* insertEvent(sql, { sequence: 1, occurredAt: "2026-01-01T00:00:00.000Z" });
      yield* insertEvent(sql, { sequence: 2, occurredAt: "2026-01-02T00:00:00.000Z" });
      yield* insertEvent(sql, { sequence: 3, occurredAt: "2026-01-03T00:00:00.000Z" });

      const firstBatch = yield* eventStore.pruneThroughSequence({
        sequenceInclusive: 10,
        olderThanIso: "2026-06-01T00:00:00.000Z",
        limit: 2,
      });
      assert.equal(firstBatch, 2);
      assert.deepEqual(yield* listEventSequences(sql), [3]);

      const secondBatch = yield* eventStore.pruneThroughSequence({
        sequenceInclusive: 10,
        olderThanIso: "2026-06-01T00:00:00.000Z",
        limit: 2,
      });
      assert.equal(secondBatch, 1);
      assert.deepEqual(yield* listEventSequences(sql), []);
    }),
  );
});
