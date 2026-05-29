import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  yield* sql`
    CREATE TABLE IF NOT EXISTS projection_thread_image_artifacts (
      thread_id TEXT NOT NULL,
      artifact_id TEXT NOT NULL,
      turn_id TEXT,
      attachment_json TEXT NOT NULL,
      source_kind TEXT NOT NULL,
      source_event_id TEXT,
      created_at TEXT NOT NULL,
      PRIMARY KEY (thread_id, artifact_id)
    )
  `;

  yield* sql`
    CREATE INDEX IF NOT EXISTS idx_projection_thread_image_artifacts_thread_turn
    ON projection_thread_image_artifacts(thread_id, turn_id, created_at)
  `;
});
