import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  yield* sql`
    CREATE TABLE IF NOT EXISTS plan_runner_feature_runs (
      run_id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      feature_name TEXT NOT NULL,
      state TEXT NOT NULL,
      summary TEXT,
      branch TEXT,
      worktree_path TEXT,
      owns_worktree INTEGER NOT NULL DEFAULT 0,
      model_selection_json TEXT,
      max_concurrency INTEGER NOT NULL,
      started_at TEXT,
      completed_at TEXT,
      last_updated_at TEXT NOT NULL
    )
  `;

  yield* sql`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_plan_runner_feature_runs_project_feature_unique
    ON plan_runner_feature_runs(project_id, feature_name)
  `;

  yield* sql`
    CREATE INDEX IF NOT EXISTS idx_plan_runner_feature_runs_project_feature
    ON plan_runner_feature_runs(project_id, feature_name)
  `;

  yield* sql`
    CREATE INDEX IF NOT EXISTS idx_plan_runner_feature_runs_state
    ON plan_runner_feature_runs(state)
  `;

  yield* sql`
    CREATE TABLE IF NOT EXISTS plan_runner_steps (
      run_id TEXT NOT NULL,
      step_key TEXT NOT NULL,
      step_kind TEXT NOT NULL,
      plan_id TEXT,
      filename TEXT,
      plan_markdown TEXT,
      depends_on_json TEXT NOT NULL DEFAULT '[]',
      state TEXT NOT NULL,
      max_retries INTEGER NOT NULL DEFAULT 0,
      retries_used INTEGER NOT NULL DEFAULT 0,
      error TEXT,
      failure_summary TEXT,
      started_at TEXT,
      completed_at TEXT,
      execution_order INTEGER NOT NULL,
      PRIMARY KEY (run_id, step_key),
      FOREIGN KEY (run_id) REFERENCES plan_runner_feature_runs(run_id) ON DELETE CASCADE
    )
  `;

  yield* sql`
    CREATE INDEX IF NOT EXISTS idx_plan_runner_steps_run_order
    ON plan_runner_steps(run_id, execution_order, started_at)
  `;

  yield* sql`
    CREATE TABLE IF NOT EXISTS plan_runner_internal_threads (
      run_id TEXT NOT NULL,
      step_key TEXT NOT NULL,
      thread_id TEXT NOT NULL,
      thread_role TEXT NOT NULL,
      created_at TEXT NOT NULL,
      FOREIGN KEY (run_id) REFERENCES plan_runner_feature_runs(run_id) ON DELETE CASCADE
    )
  `;

  yield* sql`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_plan_runner_internal_threads_thread_unique
    ON plan_runner_internal_threads(thread_id)
  `;

  yield* sql`
    CREATE INDEX IF NOT EXISTS idx_plan_runner_internal_threads_run_step
    ON plan_runner_internal_threads(run_id, step_key)
  `;

  yield* sql`
    CREATE TABLE IF NOT EXISTS plan_runner_synthetic_log_entries (
      run_id TEXT NOT NULL,
      step_key TEXT NOT NULL,
      sequence INTEGER NOT NULL,
      kind TEXT NOT NULL,
      title TEXT,
      body_markdown TEXT,
      body_text TEXT,
      copy_text TEXT,
      payload_json TEXT,
      created_at TEXT NOT NULL,
      PRIMARY KEY (run_id, step_key, sequence),
      FOREIGN KEY (run_id) REFERENCES plan_runner_feature_runs(run_id) ON DELETE CASCADE
    )
  `;

  yield* sql`
    CREATE INDEX IF NOT EXISTS idx_plan_runner_synthetic_log_entries_run_step_seq
    ON plan_runner_synthetic_log_entries(run_id, step_key, sequence)
  `;
});
