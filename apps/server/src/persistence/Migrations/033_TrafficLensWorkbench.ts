import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  yield* sql`
    CREATE TABLE IF NOT EXISTS traffic_lens_rules (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      enabled INTEGER NOT NULL,
      phase TEXT NOT NULL,
      action TEXT NOT NULL,
      scope_json TEXT NOT NULL,
      mutation_json TEXT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `;

  yield* sql`
    CREATE TABLE IF NOT EXISTS traffic_lens_overrides (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      enabled INTEGER NOT NULL,
      match_json TEXT NOT NULL,
      response_json TEXT NOT NULL,
      latency_ms INTEGER NULL,
      offline INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `;

  yield* sql`
    CREATE TABLE IF NOT EXISTS traffic_lens_profiles (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      partition_key TEXT NOT NULL UNIQUE,
      user_agent_preset TEXT NULL,
      proxy_preset TEXT NULL,
      notes TEXT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `;

  yield* sql`
    CREATE TABLE IF NOT EXISTS traffic_lens_findings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tab_id TEXT NULL,
      traffic_id INTEGER NULL,
      kind TEXT NOT NULL,
      severity TEXT NOT NULL,
      title TEXT NOT NULL,
      description TEXT NOT NULL,
      evidence_json TEXT NOT NULL,
      created_at TEXT NOT NULL
    )
  `;

  yield* sql`
    CREATE INDEX IF NOT EXISTS idx_traffic_lens_entries_tab_id_created_at
    ON traffic_lens_entries (tab_id, created_at DESC)
  `;

  yield* sql`
    CREATE INDEX IF NOT EXISTS idx_traffic_lens_entries_host_created_at
    ON traffic_lens_entries (host, created_at DESC)
  `;

  yield* sql`
    CREATE INDEX IF NOT EXISTS idx_traffic_lens_findings_tab_id_created_at
    ON traffic_lens_findings (tab_id, created_at DESC)
  `;

  yield* sql`
    CREATE INDEX IF NOT EXISTS idx_traffic_lens_findings_traffic_id
    ON traffic_lens_findings (traffic_id)
  `;

  yield* sql`
    CREATE INDEX IF NOT EXISTS idx_traffic_lens_rules_enabled_phase
    ON traffic_lens_rules (enabled, phase)
  `;

  yield* sql`
    CREATE INDEX IF NOT EXISTS idx_traffic_lens_overrides_enabled
    ON traffic_lens_overrides (enabled)
  `;
});
