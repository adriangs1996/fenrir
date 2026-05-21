import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  yield* sql`
    ALTER TABLE review_sessions
    ADD COLUMN mode TEXT NOT NULL DEFAULT 'review'
  `.pipe(Effect.catch(() => Effect.void));

  yield* sql`
    ALTER TABLE review_sessions
    ADD COLUMN scope TEXT NOT NULL DEFAULT 'combined'
  `.pipe(Effect.catch(() => Effect.void));
});
