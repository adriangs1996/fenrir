import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import { Effect, Layer } from "effect";
import { TestClock } from "effect/testing";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import { ProjectionRetentionLive } from "../../persistence/Layers/ProjectionRetention.ts";
import { SqlitePersistenceMemory } from "../../persistence/Layers/Sqlite.ts";
import { ProjectionRetention } from "../../persistence/Services/ProjectionRetention.ts";
import {
  ACTIVITY_KEEP_PER_THREAD,
  runThreadProjectionRetentionSweep,
} from "./ThreadProjectionRetention.ts";

const retentionLayer = it.layer(
  ProjectionRetentionLive.pipe(
    Layer.provideMerge(SqlitePersistenceMemory),
    Layer.provideMerge(NodeServices.layer),
  ),
);

const insertThread = (
  sql: SqlClient.SqlClient,
  input: {
    readonly threadId: string;
    readonly deletedAt: string | null;
  },
) =>
  sql`
    INSERT INTO projection_threads (
      thread_id,
      project_id,
      title,
      created_at,
      updated_at,
      deleted_at
    )
    VALUES (
      ${input.threadId},
      'project-1',
      'Thread',
      '2026-01-01T00:00:00.000Z',
      '2026-01-01T00:00:00.000Z',
      ${input.deletedAt}
    )
  `;

const insertActivity = (
  sql: SqlClient.SqlClient,
  input: {
    readonly activityId: string;
    readonly threadId: string;
    readonly createdAt: string;
  },
) =>
  sql`
    INSERT INTO projection_thread_activities (
      activity_id,
      thread_id,
      turn_id,
      tone,
      kind,
      summary,
      payload_json,
      created_at
    )
    VALUES (
      ${input.activityId},
      ${input.threadId},
      NULL,
      'info',
      'tool.started',
      'summary',
      '{}',
      ${input.createdAt}
    )
  `;

const insertMessage = (
  sql: SqlClient.SqlClient,
  input: {
    readonly messageId: string;
    readonly threadId: string;
  },
) =>
  sql`
    INSERT INTO projection_thread_messages (
      message_id,
      thread_id,
      turn_id,
      role,
      text,
      is_streaming,
      created_at,
      updated_at
    )
    VALUES (
      ${input.messageId},
      ${input.threadId},
      NULL,
      'user',
      'hello',
      0,
      '2026-01-01T00:00:00.000Z',
      '2026-01-01T00:00:00.000Z'
    )
  `;

const countRows = (sql: SqlClient.SqlClient, table: "activities" | "messages", threadId: string) =>
  (table === "activities"
    ? sql`SELECT COUNT(*) AS "count" FROM projection_thread_activities WHERE thread_id = ${threadId}`
    : sql`SELECT COUNT(*) AS "count" FROM projection_thread_messages WHERE thread_id = ${threadId}`
  ).pipe(Effect.map((rows) => Number((rows[0] as { count: number }).count)));

const resetTables = (sql: SqlClient.SqlClient) =>
  Effect.all([
    sql`DELETE FROM projection_threads`,
    sql`DELETE FROM projection_thread_activities`,
    sql`DELETE FROM projection_thread_messages`,
  ]);

// The sweep computes cutoffs from the clock; pin the TestClock to a fixed
// "now" so seeded ISO dates land deterministically on either side of it.
// `setTime` (not `adjust`): the layer-shared clock would otherwise accumulate
// across tests.
const NOW_ISO = "2026-07-01T00:00:00.000Z";
const advanceClockToNow = TestClock.setTime(Date.parse(NOW_ISO));

retentionLayer("thread projection retention", (it) => {
  it.effect("purges projection rows of threads deleted beyond the grace window", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      yield* resetTables(sql);
      yield* advanceClockToNow;

      // Deleted long ago: purged.
      yield* insertThread(sql, { threadId: "thread-old", deletedAt: "2026-06-01T00:00:00.000Z" });
      yield* insertActivity(sql, {
        activityId: "a-1",
        threadId: "thread-old",
        createdAt: "2026-05-01T00:00:00.000Z",
      });
      yield* insertMessage(sql, { messageId: "m-1", threadId: "thread-old" });

      // Deleted within the grace window: kept.
      yield* insertThread(sql, {
        threadId: "thread-recent",
        deletedAt: "2026-06-30T00:00:00.000Z",
      });
      yield* insertActivity(sql, {
        activityId: "a-2",
        threadId: "thread-recent",
        createdAt: "2026-05-01T00:00:00.000Z",
      });

      // Live thread: kept.
      yield* insertThread(sql, { threadId: "thread-live", deletedAt: null });
      yield* insertActivity(sql, {
        activityId: "a-3",
        threadId: "thread-live",
        createdAt: "2026-05-01T00:00:00.000Z",
      });

      const result = yield* runThreadProjectionRetentionSweep;

      assert.equal(result.purgedThreadCount, 1);
      assert.equal(result.purgedRowCount, 2);
      assert.equal(yield* countRows(sql, "activities", "thread-old"), 0);
      assert.equal(yield* countRows(sql, "messages", "thread-old"), 0);
      assert.equal(yield* countRows(sql, "activities", "thread-recent"), 1);
      assert.equal(yield* countRows(sql, "activities", "thread-live"), 1);
    }),
  );

  it.effect("caps per-thread activity history, keeping recent rows", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      yield* resetTables(sql);
      yield* advanceClockToNow;

      yield* insertThread(sql, { threadId: "thread-big", deletedAt: null });
      // keepCount + 2 old rows: the 2 oldest fall beyond the cap and past the
      // min-age bound, so they are pruned.
      const total = ACTIVITY_KEEP_PER_THREAD + 2;
      for (let index = 0; index < total; index += 1) {
        const minute = String(index).padStart(4, "0");
        yield* insertActivity(sql, {
          activityId: `act-${minute}`,
          threadId: "thread-big",
          createdAt: `2026-05-01T00:${minute.slice(0, 2)}:${minute.slice(2)}.000Z`,
        });
      }

      const result = yield* runThreadProjectionRetentionSweep;

      assert.equal(result.prunedActivityCount, 2);
      assert.equal(yield* countRows(sql, "activities", "thread-big"), ACTIVITY_KEEP_PER_THREAD);
      // The oldest rows are the pruned ones.
      const oldest = yield* sql`
        SELECT activity_id AS "activityId"
        FROM projection_thread_activities
        WHERE thread_id = 'thread-big'
        ORDER BY created_at ASC
        LIMIT 1
      `;
      assert.equal((oldest[0] as { activityId: string }).activityId, "act-0002");
    }),
  );

  it.effect("never prunes activities younger than the min-age bound", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      const retention = yield* ProjectionRetention;
      yield* resetTables(sql);
      yield* advanceClockToNow;

      yield* insertThread(sql, { threadId: "thread-fresh", deletedAt: null });
      // Over the cap, but every row is younger than the min-age bound.
      const total = ACTIVITY_KEEP_PER_THREAD + 5;
      for (let index = 0; index < total; index += 1) {
        const minute = String(index).padStart(4, "0");
        yield* insertActivity(sql, {
          activityId: `fresh-${minute}`,
          threadId: "thread-fresh",
          createdAt: `2026-06-30T00:${minute.slice(0, 2)}:${minute.slice(2)}.000Z`,
        });
      }

      const result = yield* runThreadProjectionRetentionSweep;

      assert.equal(result.prunedActivityCount, 0);
      assert.equal(yield* countRows(sql, "activities", "thread-fresh"), total);

      // Sanity-check the primitive: the cutoff exists but the min-age bound
      // wins, so nothing is deletable before it.
      const cutoff = yield* retention.getActivityCapCutoff({
        threadId: "thread-fresh",
        keepCount: ACTIVITY_KEEP_PER_THREAD,
      });
      assert.isNotNull(cutoff);
    }),
  );
});
