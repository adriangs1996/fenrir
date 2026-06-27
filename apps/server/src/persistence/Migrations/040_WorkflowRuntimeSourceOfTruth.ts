import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  yield* sql`
    ALTER TABLE workflows
    ADD COLUMN created_from_thread_id TEXT
  `;

  yield* sql`
    ALTER TABLE workflows
    ADD COLUMN source_revision INTEGER NOT NULL DEFAULT 1
  `;

  yield* sql`
    ALTER TABLE workflows
    ADD COLUMN declared_capabilities_json TEXT NOT NULL DEFAULT '[]'
  `;

  yield* sql`
    ALTER TABLE workflows
    ADD COLUMN default_runtime_context_json TEXT NOT NULL DEFAULT '{}'
  `;

  yield* sql`
    UPDATE workflows
    SET created_from_thread_id = origin_thread_id
    WHERE created_from_thread_id IS NULL
      AND origin_thread_id IS NOT NULL
  `;

  yield* sql`
    ALTER TABLE workflow_runs
    ADD COLUMN trigger TEXT NOT NULL DEFAULT 'thread'
  `;

  yield* sql`
    ALTER TABLE workflow_runs
    ADD COLUMN requested_by_thread_id TEXT
  `;

  yield* sql`
    ALTER TABLE workflow_runs
    ADD COLUMN schedule_id TEXT
  `;

  yield* sql`
    ALTER TABLE workflow_runs
    ADD COLUMN runtime_context_json TEXT NOT NULL DEFAULT '{}'
  `;

  yield* sql`
    ALTER TABLE workflow_runs
    ADD COLUMN source_revision INTEGER NOT NULL DEFAULT 1
  `;

  yield* sql`
    ALTER TABLE workflow_runs
    ADD COLUMN memory_revision INTEGER NOT NULL DEFAULT 0
  `;

  yield* sql`
    UPDATE workflow_runs
    SET requested_by_thread_id = origin_thread_id
    WHERE requested_by_thread_id IS NULL
      AND origin_thread_id IS NOT NULL
  `;

  yield* sql`
    CREATE TABLE IF NOT EXISTS workflow_thread_links (
      workflow_id TEXT NOT NULL,
      project_id TEXT NOT NULL,
      thread_id TEXT NOT NULL,
      relation TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (workflow_id, thread_id, relation),
      FOREIGN KEY (workflow_id) REFERENCES workflows(workflow_id) ON DELETE CASCADE
    )
  `;

  yield* sql`
    INSERT OR IGNORE INTO workflow_thread_links (
      workflow_id,
      project_id,
      thread_id,
      relation,
      created_at,
      updated_at
    )
    SELECT
      workflow_id,
      project_id,
      origin_thread_id,
      'created_from',
      created_at,
      updated_at
    FROM workflows
    WHERE origin_thread_id IS NOT NULL
  `;

  yield* sql`
    CREATE INDEX IF NOT EXISTS idx_workflow_thread_links_thread
    ON workflow_thread_links(project_id, thread_id, updated_at DESC)
  `;

  yield* sql`
    CREATE INDEX IF NOT EXISTS idx_workflow_thread_links_workflow
    ON workflow_thread_links(workflow_id, relation, updated_at DESC)
  `;

  yield* sql`
    CREATE TABLE IF NOT EXISTS workflow_schedules (
      schedule_id TEXT PRIMARY KEY,
      workflow_id TEXT NOT NULL,
      project_id TEXT NOT NULL,
      run_at TEXT NOT NULL,
      args_json TEXT NOT NULL,
      runtime_context_json TEXT NOT NULL,
      requested_by_thread_id TEXT,
      status TEXT NOT NULL,
      run_id TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (workflow_id) REFERENCES workflows(workflow_id) ON DELETE CASCADE,
      FOREIGN KEY (run_id) REFERENCES workflow_runs(run_id) ON DELETE SET NULL
    )
  `;

  yield* sql`
    CREATE INDEX IF NOT EXISTS idx_workflow_schedules_due
    ON workflow_schedules(status, run_at ASC, schedule_id ASC)
  `;

  yield* sql`
    CREATE INDEX IF NOT EXISTS idx_workflow_schedules_workflow
    ON workflow_schedules(workflow_id, run_at DESC)
  `;

  yield* sql`
    CREATE TABLE IF NOT EXISTS workflow_memory_items (
      memory_id TEXT PRIMARY KEY,
      workflow_id TEXT NOT NULL,
      project_id TEXT NOT NULL,
      kind TEXT NOT NULL,
      content TEXT NOT NULL,
      evidence_run_ids_json TEXT NOT NULL,
      evidence_event_ids_json TEXT NOT NULL,
      confidence REAL NOT NULL,
      status TEXT NOT NULL,
      usage_count INTEGER NOT NULL DEFAULT 0,
      success_count INTEGER NOT NULL DEFAULT 0,
      last_used_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (workflow_id) REFERENCES workflows(workflow_id) ON DELETE CASCADE
    )
  `;

  yield* sql`
    CREATE INDEX IF NOT EXISTS idx_workflow_memory_items_active
    ON workflow_memory_items(workflow_id, status, kind, updated_at DESC)
  `;

  yield* sql`
    CREATE TABLE IF NOT EXISTS workflow_prompt_builds (
      prompt_build_id TEXT PRIMARY KEY,
      run_id TEXT NOT NULL,
      step_id TEXT,
      agent_name TEXT,
      selected_memory_ids_json TEXT NOT NULL,
      selected_context_refs_json TEXT NOT NULL,
      rendered_prompt TEXT NOT NULL,
      rationale TEXT NOT NULL,
      created_at TEXT NOT NULL,
      FOREIGN KEY (run_id) REFERENCES workflow_runs(run_id) ON DELETE CASCADE,
      FOREIGN KEY (step_id) REFERENCES workflow_steps(step_id) ON DELETE SET NULL
    )
  `;

  yield* sql`
    CREATE INDEX IF NOT EXISTS idx_workflow_prompt_builds_run_created
    ON workflow_prompt_builds(run_id, created_at ASC)
  `;
});
