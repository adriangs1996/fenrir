import * as SqlClient from "effect/unstable/sql/SqlClient";
import * as Effect from "effect/Effect";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  yield* sql`
    DELETE FROM projection_pending_approvals
    WHERE NOT EXISTS (
      SELECT 1
      FROM projection_thread_activities AS activity
      WHERE activity.kind = 'approval.requested'
        AND json_extract(activity.payload_json, '$.requestId')
          = projection_pending_approvals.request_id
    )
  `;

  // NOTE: upstream's second statement (UPDATE projection_threads SET
  // pending_approval_count = …) is omitted because local schema lacks the
  // pending_approval_count column. Restore once cherry-pick f7fa62aa
  // (shell snapshot queries) lands and adds the column. See patches.md.
});
