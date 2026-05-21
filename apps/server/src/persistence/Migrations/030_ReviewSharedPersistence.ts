import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  yield* sql`
    CREATE TABLE IF NOT EXISTS review_sessions (
      session_id TEXT PRIMARY KEY,
      thread_id TEXT NOT NULL,
      project_id TEXT,
      checkout_path TEXT NOT NULL,
      target_json TEXT NOT NULL,
      pull_request_provider TEXT,
      pull_request_number INTEGER,
      pull_request_url TEXT,
      base_branch_override TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      last_activated_at TEXT NOT NULL,
      archived_at TEXT
    )
  `;

  yield* sql`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_review_sessions_thread_checkout_active_unique
    ON review_sessions(thread_id, checkout_path)
    WHERE archived_at IS NULL
  `;

  yield* sql`
    CREATE INDEX IF NOT EXISTS idx_review_sessions_thread_archived_activated
    ON review_sessions(thread_id, archived_at, last_activated_at)
  `;

  yield* sql`
    CREATE INDEX IF NOT EXISTS idx_review_sessions_project_archived
    ON review_sessions(project_id, archived_at)
  `;

  yield* sql`
    CREATE TABLE IF NOT EXISTS review_annotations (
      annotation_id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      annotation_kind TEXT NOT NULL,
      parent_annotation_id TEXT,
      target_kind TEXT NOT NULL,
      target_id TEXT,
      group_id TEXT,
      file_id TEXT,
      chunk_id TEXT,
      anchor_payload_json TEXT,
      source TEXT NOT NULL DEFAULT 'local' CHECK (source = 'local'),
      title TEXT,
      body TEXT NOT NULL,
      author_json TEXT NOT NULL,
      resolved INTEGER NOT NULL DEFAULT 0,
      reopened INTEGER NOT NULL DEFAULT 0,
      outdated INTEGER NOT NULL DEFAULT 0,
      suggested_resolved INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (session_id) REFERENCES review_sessions(session_id) ON DELETE CASCADE,
      FOREIGN KEY (parent_annotation_id) REFERENCES review_annotations(annotation_id) ON DELETE CASCADE
    )
  `;

  yield* sql`
    CREATE INDEX IF NOT EXISTS idx_review_annotations_session_created
    ON review_annotations(session_id, created_at, annotation_id)
  `;

  yield* sql`
    CREATE INDEX IF NOT EXISTS idx_review_annotations_parent
    ON review_annotations(parent_annotation_id, created_at)
  `;

  yield* sql`
    CREATE INDEX IF NOT EXISTS idx_review_annotations_session_target
    ON review_annotations(session_id, target_kind, target_id)
  `;

  yield* sql`
    CREATE TABLE IF NOT EXISTS review_progress (
      session_id TEXT NOT NULL,
      target_kind TEXT NOT NULL,
      target_id TEXT NOT NULL,
      progress_state TEXT NOT NULL,
      last_updated_author_json TEXT NOT NULL,
      last_updated_at TEXT NOT NULL,
      PRIMARY KEY (session_id, target_kind, target_id),
      FOREIGN KEY (session_id) REFERENCES review_sessions(session_id) ON DELETE CASCADE
    )
  `;

  yield* sql`
    CREATE INDEX IF NOT EXISTS idx_review_progress_session_updated
    ON review_progress(session_id, last_updated_at, target_kind, target_id)
  `;

  yield* sql`
    CREATE TABLE IF NOT EXISTS review_analysis (
      session_id TEXT PRIMARY KEY,
      artifact_json TEXT NOT NULL,
      analysis_payload_json TEXT NOT NULL,
      generated_at TEXT NOT NULL,
      stale_marker_inputs_json TEXT,
      stale_reason_flags_json TEXT NOT NULL DEFAULT '[]',
      updated_at TEXT NOT NULL,
      FOREIGN KEY (session_id) REFERENCES review_sessions(session_id) ON DELETE CASCADE
    )
  `;

  yield* sql`
    CREATE INDEX IF NOT EXISTS idx_review_analysis_generated
    ON review_analysis(generated_at, session_id)
  `;

  yield* sql`
    CREATE TABLE IF NOT EXISTS review_github_pending_drafts (
      draft_id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      auth_session_id TEXT NOT NULL,
      draft_kind TEXT NOT NULL CHECK (draft_kind IN ('inline-comment', 'review-summary')),
      anchor_payload_json TEXT,
      body TEXT NOT NULL,
      is_outdated INTEGER NOT NULL DEFAULT 0,
      submit_action TEXT CHECK (
        submit_action IS NULL OR submit_action IN ('comment', 'approve', 'request-changes')
      ),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (session_id) REFERENCES review_sessions(session_id) ON DELETE CASCADE
    )
  `;

  yield* sql`
    CREATE INDEX IF NOT EXISTS idx_review_github_pending_drafts_session_viewer
    ON review_github_pending_drafts(session_id, auth_session_id, updated_at, draft_id)
  `;

  yield* sql`
    CREATE TABLE IF NOT EXISTS review_ignore_rules (
      checkout_path TEXT NOT NULL,
      rule_kind TEXT NOT NULL CHECK (rule_kind IN ('file', 'directory')),
      normalized_path TEXT NOT NULL,
      match_path TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (checkout_path, rule_kind, normalized_path)
    )
  `;

  yield* sql`
    CREATE INDEX IF NOT EXISTS idx_review_ignore_rules_checkout_match
    ON review_ignore_rules(checkout_path, match_path, rule_kind)
  `;
});
