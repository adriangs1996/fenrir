import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  yield* sql`
    ALTER TABLE projection_threads
    ADD COLUMN visibility TEXT NOT NULL DEFAULT 'normal'
  `;

  yield* sql`
    ALTER TABLE projection_threads
    ADD COLUMN owner_json TEXT
  `;

  yield* sql`
    ALTER TABLE projection_threads
    ADD COLUMN delete_on_settled INTEGER NOT NULL DEFAULT 0
  `;

  yield* sql`
    CREATE INDEX IF NOT EXISTS idx_projection_threads_visibility_deleted
    ON projection_threads(visibility, deleted_at, archived_at)
  `;
});
