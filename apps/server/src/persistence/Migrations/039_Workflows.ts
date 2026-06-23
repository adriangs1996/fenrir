import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  yield* sql`
    CREATE TABLE IF NOT EXISTS workflows (
      workflow_id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      origin_thread_id TEXT NOT NULL,
      name TEXT NOT NULL,
      description TEXT,
      source TEXT NOT NULL,
      source_hash TEXT NOT NULL,
      status TEXT NOT NULL,
      validation_status TEXT NOT NULL,
      validation_error TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      archived_at TEXT
    )
  `;

  yield* sql`
    CREATE INDEX IF NOT EXISTS idx_workflows_thread_updated
    ON workflows(project_id, origin_thread_id, updated_at DESC)
  `;

  yield* sql`
    CREATE INDEX IF NOT EXISTS idx_workflows_thread_runnable
    ON workflows(project_id, origin_thread_id, status, validation_status, updated_at DESC)
  `;

  yield* sql`
    CREATE TABLE IF NOT EXISTS workflow_runs (
      run_id TEXT PRIMARY KEY,
      workflow_id TEXT NOT NULL,
      project_id TEXT NOT NULL,
      origin_thread_id TEXT NOT NULL,
      name TEXT NOT NULL,
      args_json TEXT NOT NULL,
      source_snapshot TEXT NOT NULL,
      source_hash TEXT NOT NULL,
      status TEXT NOT NULL,
      summary TEXT,
      started_at TEXT NOT NULL,
      completed_at TEXT,
      last_updated_at TEXT NOT NULL,
      FOREIGN KEY (workflow_id) REFERENCES workflows(workflow_id) ON DELETE CASCADE
    )
  `;

  yield* sql`
    CREATE INDEX IF NOT EXISTS idx_workflow_runs_thread_updated
    ON workflow_runs(project_id, origin_thread_id, last_updated_at DESC)
  `;

  yield* sql`
    CREATE INDEX IF NOT EXISTS idx_workflow_runs_workflow_updated
    ON workflow_runs(workflow_id, last_updated_at DESC)
  `;

  yield* sql`
    CREATE INDEX IF NOT EXISTS idx_workflow_runs_active
    ON workflow_runs(status, last_updated_at DESC)
  `;

  yield* sql`
    CREATE TABLE IF NOT EXISTS workflow_steps (
      step_id TEXT PRIMARY KEY,
      run_id TEXT NOT NULL,
      step_key TEXT NOT NULL,
      status TEXT NOT NULL,
      result_json TEXT,
      error TEXT,
      sequence INTEGER NOT NULL,
      started_at TEXT,
      completed_at TEXT,
      UNIQUE(run_id, step_key),
      FOREIGN KEY (run_id) REFERENCES workflow_runs(run_id) ON DELETE CASCADE
    )
  `;

  yield* sql`
    CREATE INDEX IF NOT EXISTS idx_workflow_steps_run_sequence
    ON workflow_steps(run_id, sequence ASC)
  `;

  yield* sql`
    CREATE TABLE IF NOT EXISTS workflow_agents (
      agent_id TEXT PRIMARY KEY,
      run_id TEXT NOT NULL,
      name TEXT NOT NULL,
      role TEXT NOT NULL,
      thread_id TEXT,
      status TEXT NOT NULL,
      model_selection_json TEXT,
      runtime_mode TEXT,
      mcp_server_ids_json TEXT NOT NULL DEFAULT '[]',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE(run_id, name),
      FOREIGN KEY (run_id) REFERENCES workflow_runs(run_id) ON DELETE CASCADE
    )
  `;

  yield* sql`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_workflow_agents_thread_unique
    ON workflow_agents(thread_id)
    WHERE thread_id IS NOT NULL
  `;

  yield* sql`
    CREATE INDEX IF NOT EXISTS idx_workflow_agents_run_name
    ON workflow_agents(run_id, name)
  `;

  yield* sql`
    CREATE TABLE IF NOT EXISTS workflow_tasks (
      task_id TEXT PRIMARY KEY,
      run_id TEXT NOT NULL,
      title TEXT NOT NULL,
      reason TEXT,
      kind TEXT NOT NULL,
      assignee TEXT,
      prompt TEXT NOT NULL,
      status TEXT NOT NULL,
      created_by_agent_id TEXT,
      result_json TEXT,
      error TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (run_id) REFERENCES workflow_runs(run_id) ON DELETE CASCADE,
      FOREIGN KEY (created_by_agent_id) REFERENCES workflow_agents(agent_id) ON DELETE SET NULL
    )
  `;

  yield* sql`
    CREATE INDEX IF NOT EXISTS idx_workflow_tasks_run_status
    ON workflow_tasks(run_id, status, updated_at DESC)
  `;

  yield* sql`
    CREATE TABLE IF NOT EXISTS workflow_input_requests (
      request_id TEXT PRIMARY KEY,
      run_id TEXT NOT NULL,
      title TEXT NOT NULL,
      body TEXT,
      fields_json TEXT NOT NULL,
      status TEXT NOT NULL,
      response_json TEXT,
      created_at TEXT NOT NULL,
      resolved_at TEXT,
      FOREIGN KEY (run_id) REFERENCES workflow_runs(run_id) ON DELETE CASCADE
    )
  `;

  yield* sql`
    CREATE INDEX IF NOT EXISTS idx_workflow_input_requests_run_status
    ON workflow_input_requests(run_id, status, created_at ASC)
  `;

  yield* sql`
    CREATE TABLE IF NOT EXISTS workflow_state (
      run_id TEXT NOT NULL,
      scope TEXT NOT NULL,
      key TEXT NOT NULL,
      value_json TEXT,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (run_id, scope, key),
      FOREIGN KEY (run_id) REFERENCES workflow_runs(run_id) ON DELETE CASCADE
    )
  `;

  yield* sql`
    CREATE TABLE IF NOT EXISTS workflow_events (
      event_id TEXT PRIMARY KEY,
      workflow_id TEXT NOT NULL,
      run_id TEXT,
      step_id TEXT,
      agent_id TEXT,
      task_id TEXT,
      kind TEXT NOT NULL,
      title TEXT NOT NULL,
      body TEXT,
      payload_json TEXT,
      sequence INTEGER NOT NULL,
      created_at TEXT NOT NULL,
      FOREIGN KEY (workflow_id) REFERENCES workflows(workflow_id) ON DELETE CASCADE,
      FOREIGN KEY (run_id) REFERENCES workflow_runs(run_id) ON DELETE CASCADE,
      FOREIGN KEY (step_id) REFERENCES workflow_steps(step_id) ON DELETE SET NULL,
      FOREIGN KEY (agent_id) REFERENCES workflow_agents(agent_id) ON DELETE SET NULL,
      FOREIGN KEY (task_id) REFERENCES workflow_tasks(task_id) ON DELETE SET NULL
    )
  `;

  yield* sql`
    CREATE INDEX IF NOT EXISTS idx_workflow_events_run_sequence
    ON workflow_events(run_id, sequence ASC)
  `;

  yield* sql`
    CREATE INDEX IF NOT EXISTS idx_workflow_events_workflow_sequence
    ON workflow_events(workflow_id, sequence ASC)
  `;
});
