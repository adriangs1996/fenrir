import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  yield* sql`
    CREATE TABLE IF NOT EXISTS browser_traffic (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tab_id TEXT NOT NULL,
      request_id TEXT NOT NULL UNIQUE,
      method TEXT NOT NULL,
      url TEXT NOT NULL,
      host TEXT NOT NULL,
      path TEXT NOT NULL,
      status_code INTEGER,
      content_type TEXT,
      content_length INTEGER,
      request_headers_json TEXT NOT NULL DEFAULT '{}',
      request_body BLOB,
      response_headers_json TEXT,
      response_body BLOB,
      body_truncated INTEGER NOT NULL DEFAULT 0,
      timing_started_at TEXT NOT NULL,
      timing_response_at TEXT,
      timing_completed_at TEXT,
      is_websocket INTEGER NOT NULL DEFAULT 0,
      remote_address TEXT,
      tls_version TEXT,
      notes TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `;

  yield* sql`CREATE INDEX IF NOT EXISTS idx_bt_tab ON browser_traffic(tab_id)`;
  yield* sql`CREATE INDEX IF NOT EXISTS idx_bt_host ON browser_traffic(host)`;
  yield* sql`CREATE INDEX IF NOT EXISTS idx_bt_method ON browser_traffic(method)`;
  yield* sql`CREATE INDEX IF NOT EXISTS idx_bt_status ON browser_traffic(status_code)`;
  yield* sql`CREATE INDEX IF NOT EXISTS idx_bt_created ON browser_traffic(created_at DESC)`;
});
