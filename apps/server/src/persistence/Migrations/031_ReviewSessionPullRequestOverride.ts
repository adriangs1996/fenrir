import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  yield* sql`
    ALTER TABLE review_sessions
    ADD COLUMN pull_request_override_provider TEXT
  `.pipe(Effect.catch(() => Effect.void));

  yield* sql`
    ALTER TABLE review_sessions
    ADD COLUMN pull_request_override_number INTEGER
  `.pipe(Effect.catch(() => Effect.void));

  yield* sql`
    ALTER TABLE review_sessions
    ADD COLUMN pull_request_override_url TEXT
  `.pipe(Effect.catch(() => Effect.void));
});
