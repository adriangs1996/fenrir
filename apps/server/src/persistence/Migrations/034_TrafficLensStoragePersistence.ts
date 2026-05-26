import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  yield* sql`
    CREATE TABLE IF NOT EXISTS traffic_lens_storage_origins (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      profile_id TEXT NOT NULL,
      origin TEXT NOT NULL,
      last_document_url TEXT NULL,
      first_seen_at TEXT NOT NULL,
      last_seen_at TEXT NOT NULL,
      latest_cookie_version_id INTEGER NULL,
      latest_local_storage_version_id INTEGER NULL,
      latest_session_storage_version_id INTEGER NULL
    )
  `;

  yield* sql`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_traffic_lens_storage_origins_profile_origin
    ON traffic_lens_storage_origins (profile_id, origin)
  `;

  yield* sql`
    CREATE TABLE IF NOT EXISTS traffic_lens_storage_versions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      profile_id TEXT NOT NULL,
      origin TEXT NOT NULL,
      area_kind TEXT NOT NULL,
      scope_key TEXT NOT NULL,
      payload_json TEXT NOT NULL,
      captured_at TEXT NOT NULL,
      snapshot_reason TEXT NOT NULL,
      source_tab_id TEXT NULL,
      source_url TEXT NULL,
      content_hash TEXT NOT NULL
    )
  `;

  yield* sql`
    CREATE INDEX IF NOT EXISTS idx_traffic_lens_storage_versions_profile_origin_area_captured
    ON traffic_lens_storage_versions (profile_id, origin, area_kind, captured_at DESC)
  `;

  yield* sql`
    CREATE INDEX IF NOT EXISTS idx_traffic_lens_storage_versions_profile_origin_area_scope_captured
    ON traffic_lens_storage_versions (profile_id, origin, area_kind, scope_key, captured_at DESC)
  `;

  yield* sql`
    CREATE TABLE IF NOT EXISTS traffic_lens_storage_latest (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      profile_id TEXT NOT NULL,
      origin TEXT NOT NULL,
      area_kind TEXT NOT NULL,
      scope_key TEXT NOT NULL,
      version_id INTEGER NOT NULL,
      payload_json TEXT NOT NULL,
      captured_at TEXT NOT NULL
    )
  `;

  yield* sql`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_traffic_lens_storage_latest_profile_origin_area_scope
    ON traffic_lens_storage_latest (profile_id, origin, area_kind, scope_key)
  `;

  yield* sql`
    CREATE TABLE IF NOT EXISTS traffic_lens_storage_url_provenance (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      profile_id TEXT NOT NULL,
      origin TEXT NOT NULL,
      url TEXT NOT NULL,
      first_seen_at TEXT NOT NULL,
      last_seen_at TEXT NOT NULL
    )
  `;

  yield* sql`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_traffic_lens_storage_url_provenance_profile_url
    ON traffic_lens_storage_url_provenance (profile_id, url)
  `;
});
