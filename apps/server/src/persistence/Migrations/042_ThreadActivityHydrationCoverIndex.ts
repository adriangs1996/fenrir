import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

/**
 * The boot read-model hydration ranks every activity per thread to keep only
 * a bounded recency window. Ranking through this covering index avoids
 * reading `payload_json` for the rows the window discards, so hydration cost
 * scales with the kept window instead of total table size.
 *
 * `idx_projection_thread_activities_thread_sequence` is a prefix of the new
 * index and becomes redundant, so it is dropped to keep per-insert index
 * maintenance flat.
 */
export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  yield* sql`
    CREATE INDEX IF NOT EXISTS idx_projection_thread_activities_hydration
    ON projection_thread_activities(thread_id, sequence, created_at, activity_id)
  `;

  yield* sql`
    DROP INDEX IF EXISTS idx_projection_thread_activities_thread_sequence
  `;
});
