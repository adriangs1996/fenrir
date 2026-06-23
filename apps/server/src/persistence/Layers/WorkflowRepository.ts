import { randomUUID } from "node:crypto";

import {
  McpServerId,
  ModelSelection,
  NonNegativeInt,
  RuntimeMode,
  WorkflowAgentSnapshot,
  WorkflowEvent,
  WorkflowEventId,
  WorkflowId,
  WorkflowInputRequestSnapshot,
  WorkflowRunId,
  WorkflowRunSnapshot,
  WorkflowStateEntry,
  WorkflowStepSnapshot,
  WorkflowTaskSnapshot,
} from "@fenrir/contracts";
import * as SqlClient from "effect/unstable/sql/SqlClient";
import * as SqlSchema from "effect/unstable/sql/SqlSchema";
import { Effect, Layer, Option, Schema, Struct } from "effect";

import { toPersistenceDecodeError, toPersistenceSqlError } from "../Errors.ts";
import {
  WorkflowDraftRow,
  WorkflowEventAppend,
  WorkflowRepository,
  WorkflowRunRow,
  type WorkflowRepositoryShape,
} from "../Services/WorkflowRepository.ts";

const WorkflowRunDbRow = WorkflowRunRow.mapFields(
  Struct.assign({
    args: Schema.fromJsonString(Schema.Unknown),
  }),
);
type WorkflowRunDbRow = typeof WorkflowRunDbRow.Type;

const WorkflowStepDbRow = WorkflowStepSnapshot.mapFields(
  Struct.assign({
    result: Schema.NullOr(Schema.fromJsonString(Schema.Unknown)),
  }),
);
type WorkflowStepDbRow = typeof WorkflowStepDbRow.Type;

const WorkflowAgentDbRow = WorkflowAgentSnapshot.mapFields(
  Struct.assign({
    modelSelection: Schema.NullOr(Schema.fromJsonString(ModelSelection)),
    runtimeMode: Schema.NullOr(RuntimeMode),
    mcpServerIds: Schema.fromJsonString(Schema.Array(McpServerId)),
  }),
);
type WorkflowAgentDbRow = typeof WorkflowAgentDbRow.Type;

const WorkflowTaskDbRow = WorkflowTaskSnapshot.mapFields(
  Struct.assign({
    result: Schema.NullOr(Schema.fromJsonString(Schema.Unknown)),
  }),
);
type WorkflowTaskDbRow = typeof WorkflowTaskDbRow.Type;

const WorkflowInputRequestDbRow = WorkflowInputRequestSnapshot.mapFields(
  Struct.assign({
    fields: Schema.fromJsonString(Schema.Unknown),
    response: Schema.NullOr(Schema.fromJsonString(Schema.Unknown)),
  }),
);
type WorkflowInputRequestDbRow = typeof WorkflowInputRequestDbRow.Type;

const WorkflowStateDbRow = WorkflowStateEntry.mapFields(
  Struct.assign({
    value: Schema.NullOr(Schema.fromJsonString(Schema.Unknown)),
  }),
);
type WorkflowStateDbRow = typeof WorkflowStateDbRow.Type;

const WorkflowEventDbRow = WorkflowEvent.mapFields(
  Struct.assign({
    payload: Schema.NullOr(Schema.fromJsonString(Schema.Unknown)),
  }),
);
type WorkflowEventDbRow = typeof WorkflowEventDbRow.Type;

function toPersistenceSqlOrDecodeError(sqlOperation: string, decodeOperation: string) {
  return (cause: unknown) =>
    Schema.isSchemaError(cause)
      ? toPersistenceDecodeError(decodeOperation)(cause)
      : toPersistenceSqlError(sqlOperation)(cause);
}

function dbRunRowToRunRow(row: WorkflowRunDbRow): WorkflowRunRow {
  return {
    ...row,
    args: row.args,
  };
}

function dbAgentRowToSnapshot(row: WorkflowAgentDbRow): WorkflowAgentSnapshot {
  return {
    agentId: row.agentId,
    runId: row.runId,
    name: row.name,
    role: row.role,
    threadId: row.threadId,
    status: row.status,
    ...(row.modelSelection !== null ? { modelSelection: row.modelSelection } : {}),
    ...(row.runtimeMode !== null ? { runtimeMode: row.runtimeMode } : {}),
    mcpServerIds: row.mcpServerIds,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function dbEventRowToEvent(row: WorkflowEventDbRow): WorkflowEvent {
  return {
    ...row,
    payload: row.payload,
  };
}

function buildSnapshot(input: {
  readonly run: WorkflowRunRow;
  readonly steps: ReadonlyArray<WorkflowStepDbRow>;
  readonly agents: ReadonlyArray<WorkflowAgentDbRow>;
  readonly tasks: ReadonlyArray<WorkflowTaskDbRow>;
  readonly inputRequests: ReadonlyArray<WorkflowInputRequestDbRow>;
  readonly state: ReadonlyArray<WorkflowStateDbRow>;
}): WorkflowRunSnapshot {
  return {
    runId: input.run.runId,
    workflowId: input.run.workflowId,
    projectId: input.run.projectId,
    originThreadId: input.run.originThreadId,
    name: input.run.name,
    args: input.run.args,
    sourceHash: input.run.sourceHash,
    status: input.run.status,
    summary: input.run.summary,
    startedAt: input.run.startedAt,
    completedAt: input.run.completedAt,
    lastUpdatedAt: input.run.lastUpdatedAt,
    steps: input.steps.map((step) => ({ ...step, result: step.result })),
    agents: input.agents.map(dbAgentRowToSnapshot),
    tasks: input.tasks.map((task) => ({ ...task, result: task.result })),
    inputRequests: input.inputRequests.map((request) => ({
      ...request,
      response: request.response,
    })),
    state: input.state.map((entry) => ({ ...entry, value: entry.value })),
  };
}

const makeWorkflowRepository = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  const getDraftRow = SqlSchema.findOneOption({
    Request: Schema.Struct({ workflowId: WorkflowId }),
    Result: WorkflowDraftRow,
    execute: ({ workflowId }) =>
      sql`
        SELECT
          workflow_id AS "workflowId",
          project_id AS "projectId",
          origin_thread_id AS "originThreadId",
          name,
          description,
          source,
          source_hash AS "sourceHash",
          status,
          validation_status AS "validationStatus",
          validation_error AS "validationError",
          created_at AS "createdAt",
          updated_at AS "updatedAt",
          archived_at AS "archivedAt"
        FROM workflows
        WHERE workflow_id = ${workflowId}
        LIMIT 1
      `,
  });

  const listDraftRowsForThread = SqlSchema.findAll({
    Request: Schema.Struct({ projectId: Schema.String, originThreadId: Schema.String }),
    Result: WorkflowDraftRow,
    execute: ({ projectId, originThreadId }) =>
      sql`
        SELECT
          workflow_id AS "workflowId",
          project_id AS "projectId",
          origin_thread_id AS "originThreadId",
          name,
          description,
          source,
          source_hash AS "sourceHash",
          status,
          validation_status AS "validationStatus",
          validation_error AS "validationError",
          created_at AS "createdAt",
          updated_at AS "updatedAt",
          archived_at AS "archivedAt"
        FROM workflows
        WHERE project_id = ${projectId}
          AND origin_thread_id = ${originThreadId}
          AND archived_at IS NULL
        ORDER BY updated_at DESC, workflow_id ASC
      `,
  });

  const latestRunnableDraftRowForThread = SqlSchema.findOneOption({
    Request: Schema.Struct({ projectId: Schema.String, originThreadId: Schema.String }),
    Result: WorkflowDraftRow,
    execute: ({ projectId, originThreadId }) =>
      sql`
        SELECT
          workflow_id AS "workflowId",
          project_id AS "projectId",
          origin_thread_id AS "originThreadId",
          name,
          description,
          source,
          source_hash AS "sourceHash",
          status,
          validation_status AS "validationStatus",
          validation_error AS "validationError",
          created_at AS "createdAt",
          updated_at AS "updatedAt",
          archived_at AS "archivedAt"
        FROM workflows
        WHERE project_id = ${projectId}
          AND origin_thread_id = ${originThreadId}
          AND status = 'validated'
          AND validation_status = 'valid'
          AND archived_at IS NULL
        ORDER BY updated_at DESC, workflow_id ASC
        LIMIT 1
      `,
  });

  const getRunRow = SqlSchema.findOneOption({
    Request: Schema.Struct({ runId: WorkflowRunId }),
    Result: WorkflowRunDbRow,
    execute: ({ runId }) =>
      sql`
        SELECT
          run_id AS "runId",
          workflow_id AS "workflowId",
          project_id AS "projectId",
          origin_thread_id AS "originThreadId",
          name,
          args_json AS "args",
          source_snapshot AS "sourceSnapshot",
          source_hash AS "sourceHash",
          status,
          summary,
          started_at AS "startedAt",
          completed_at AS "completedAt",
          last_updated_at AS "lastUpdatedAt"
        FROM workflow_runs
        WHERE run_id = ${runId}
        LIMIT 1
      `,
  });

  const listRunRowsForWorkflow = SqlSchema.findAll({
    Request: Schema.Struct({ workflowId: WorkflowId }),
    Result: WorkflowRunDbRow,
    execute: ({ workflowId }) =>
      sql`
        SELECT
          run_id AS "runId",
          workflow_id AS "workflowId",
          project_id AS "projectId",
          origin_thread_id AS "originThreadId",
          name,
          args_json AS "args",
          source_snapshot AS "sourceSnapshot",
          source_hash AS "sourceHash",
          status,
          summary,
          started_at AS "startedAt",
          completed_at AS "completedAt",
          last_updated_at AS "lastUpdatedAt"
        FROM workflow_runs
        WHERE workflow_id = ${workflowId}
        ORDER BY last_updated_at DESC, run_id ASC
      `,
  });

  const listRunRowsForThread = SqlSchema.findAll({
    Request: Schema.Struct({ projectId: Schema.String, originThreadId: Schema.String }),
    Result: WorkflowRunDbRow,
    execute: ({ projectId, originThreadId }) =>
      sql`
        SELECT
          run_id AS "runId",
          workflow_id AS "workflowId",
          project_id AS "projectId",
          origin_thread_id AS "originThreadId",
          name,
          args_json AS "args",
          source_snapshot AS "sourceSnapshot",
          source_hash AS "sourceHash",
          status,
          summary,
          started_at AS "startedAt",
          completed_at AS "completedAt",
          last_updated_at AS "lastUpdatedAt"
        FROM workflow_runs
        WHERE project_id = ${projectId}
          AND origin_thread_id = ${originThreadId}
        ORDER BY last_updated_at DESC, run_id ASC
      `,
  });

  const listActiveRunRows = SqlSchema.findAll({
    Request: Schema.Struct({}),
    Result: WorkflowRunDbRow,
    execute: () =>
      sql`
        SELECT
          run_id AS "runId",
          workflow_id AS "workflowId",
          project_id AS "projectId",
          origin_thread_id AS "originThreadId",
          name,
          args_json AS "args",
          source_snapshot AS "sourceSnapshot",
          source_hash AS "sourceHash",
          status,
          summary,
          started_at AS "startedAt",
          completed_at AS "completedAt",
          last_updated_at AS "lastUpdatedAt"
        FROM workflow_runs
        WHERE status IN ('running', 'paused')
        ORDER BY started_at ASC, run_id ASC
      `,
  });

  const listStepRowsForRun = SqlSchema.findAll({
    Request: Schema.Struct({ runId: WorkflowRunId }),
    Result: WorkflowStepDbRow,
    execute: ({ runId }) =>
      sql`
        SELECT
          step_id AS "stepId",
          run_id AS "runId",
          step_key AS "stepKey",
          status,
          result_json AS "result",
          error,
          sequence,
          started_at AS "startedAt",
          completed_at AS "completedAt"
        FROM workflow_steps
        WHERE run_id = ${runId}
        ORDER BY sequence ASC, started_at ASC, step_key ASC
      `,
  });

  const listAgentRowsForRun = SqlSchema.findAll({
    Request: Schema.Struct({ runId: WorkflowRunId }),
    Result: WorkflowAgentDbRow,
    execute: ({ runId }) =>
      sql`
        SELECT
          agent_id AS "agentId",
          run_id AS "runId",
          name,
          role,
          thread_id AS "threadId",
          status,
          model_selection_json AS "modelSelection",
          runtime_mode AS "runtimeMode",
          mcp_server_ids_json AS "mcpServerIds",
          created_at AS "createdAt",
          updated_at AS "updatedAt"
        FROM workflow_agents
        WHERE run_id = ${runId}
        ORDER BY created_at ASC, name ASC
      `,
  });

  const listTaskRowsForRun = SqlSchema.findAll({
    Request: Schema.Struct({ runId: WorkflowRunId }),
    Result: WorkflowTaskDbRow,
    execute: ({ runId }) =>
      sql`
        SELECT
          task_id AS "taskId",
          run_id AS "runId",
          title,
          reason,
          kind,
          assignee,
          prompt,
          status,
          created_by_agent_id AS "createdByAgentId",
          result_json AS "result",
          error,
          created_at AS "createdAt",
          updated_at AS "updatedAt"
        FROM workflow_tasks
        WHERE run_id = ${runId}
        ORDER BY created_at ASC, task_id ASC
      `,
  });

  const listInputRequestRowsForRun = SqlSchema.findAll({
    Request: Schema.Struct({ runId: WorkflowRunId }),
    Result: WorkflowInputRequestDbRow,
    execute: ({ runId }) =>
      sql`
        SELECT
          request_id AS "requestId",
          run_id AS "runId",
          title,
          body,
          fields_json AS "fields",
          status,
          response_json AS "response",
          created_at AS "createdAt",
          resolved_at AS "resolvedAt"
        FROM workflow_input_requests
        WHERE run_id = ${runId}
        ORDER BY created_at ASC, request_id ASC
      `,
  });

  const listStateRowsForRun = SqlSchema.findAll({
    Request: Schema.Struct({ runId: WorkflowRunId }),
    Result: WorkflowStateDbRow,
    execute: ({ runId }) =>
      sql`
        SELECT
          run_id AS "runId",
          scope,
          key,
          value_json AS "value",
          updated_at AS "updatedAt"
        FROM workflow_state
        WHERE run_id = ${runId}
        ORDER BY scope ASC, key ASC
      `,
  });

  const listEventRowsForRun = SqlSchema.findAll({
    Request: Schema.Struct({ runId: WorkflowRunId }),
    Result: WorkflowEventDbRow,
    execute: ({ runId }) =>
      sql`
        SELECT
          event_id AS "eventId",
          workflow_id AS "workflowId",
          run_id AS "runId",
          step_id AS "stepId",
          agent_id AS "agentId",
          task_id AS "taskId",
          kind,
          title,
          body,
          payload_json AS "payload",
          sequence,
          created_at AS "createdAt"
        FROM workflow_events
        WHERE run_id = ${runId}
        ORDER BY sequence ASC, created_at ASC, event_id ASC
      `,
  });

  const reconstructSnapshot = (runDbRow: WorkflowRunDbRow) =>
    Effect.gen(function* () {
      const run = dbRunRowToRunRow(runDbRow);
      const [steps, agents, tasks, inputRequests, state] = yield* Effect.all(
        [
          listStepRowsForRun({ runId: run.runId }),
          listAgentRowsForRun({ runId: run.runId }),
          listTaskRowsForRun({ runId: run.runId }),
          listInputRequestRowsForRun({ runId: run.runId }),
          listStateRowsForRun({ runId: run.runId }),
        ],
        { concurrency: "unbounded" },
      );
      return buildSnapshot({ run, steps, agents, tasks, inputRequests, state });
    });

  const insertDraftRow = SqlSchema.void({
    Request: WorkflowDraftRow,
    execute: (row) =>
      sql`
        INSERT INTO workflows (
          workflow_id,
          project_id,
          origin_thread_id,
          name,
          description,
          source,
          source_hash,
          status,
          validation_status,
          validation_error,
          created_at,
          updated_at,
          archived_at
        )
        VALUES (
          ${row.workflowId},
          ${row.projectId},
          ${row.originThreadId},
          ${row.name},
          ${row.description},
          ${row.source},
          ${row.sourceHash},
          ${row.status},
          ${row.validationStatus},
          ${row.validationError},
          ${row.createdAt},
          ${row.updatedAt},
          ${row.archivedAt}
        )
      `,
  });

  const insertRunRow = SqlSchema.void({
    Request: WorkflowRunRow,
    execute: (row) =>
      sql`
        INSERT INTO workflow_runs (
          run_id,
          workflow_id,
          project_id,
          origin_thread_id,
          name,
          args_json,
          source_snapshot,
          source_hash,
          status,
          summary,
          started_at,
          completed_at,
          last_updated_at
        )
        VALUES (
          ${row.runId},
          ${row.workflowId},
          ${row.projectId},
          ${row.originThreadId},
          ${row.name},
          ${JSON.stringify(row.args ?? null)},
          ${row.sourceSnapshot},
          ${row.sourceHash},
          ${row.status},
          ${row.summary},
          ${row.startedAt},
          ${row.completedAt},
          ${row.lastUpdatedAt}
        )
      `,
  });

  const insertDraft: WorkflowRepositoryShape["insertDraft"] = (row) =>
    insertDraftRow(row).pipe(
      Effect.mapError(
        toPersistenceSqlOrDecodeError(
          "WorkflowRepository.insertDraft:query",
          "WorkflowRepository.insertDraft:encodeRequest",
        ),
      ),
    );

  const updateDraft: WorkflowRepositoryShape["updateDraft"] = (workflowId, patch) =>
    Effect.gen(function* () {
      yield* sql`
        UPDATE workflows
        SET
          source = COALESCE(${patch.source ?? null}, source),
          source_hash = COALESCE(${patch.sourceHash ?? null}, source_hash),
          status = COALESCE(${patch.status ?? null}, status),
          validation_status = COALESCE(${patch.validationStatus ?? null}, validation_status),
          validation_error = CASE
            WHEN ${patch.validationError !== undefined ? 1 : 0} = 1
              THEN ${patch.validationError === undefined ? null : patch.validationError}
            ELSE validation_error
          END,
          archived_at = CASE
            WHEN ${patch.archivedAt !== undefined ? 1 : 0} = 1
              THEN ${patch.archivedAt === undefined ? null : patch.archivedAt}
            ELSE archived_at
          END,
          updated_at = ${patch.updatedAt}
        WHERE workflow_id = ${workflowId}
      `.pipe(Effect.mapError(toPersistenceSqlError("WorkflowRepository.updateDraft:update")));
      const rowOption = yield* getDraftRow({ workflowId }).pipe(
        Effect.mapError(
          toPersistenceSqlOrDecodeError(
            "WorkflowRepository.updateDraft:query",
            "WorkflowRepository.updateDraft:decodeRows",
          ),
        ),
      );
      return yield* Option.match(rowOption, {
        onNone: () =>
          Effect.fail(
            toPersistenceSqlError("WorkflowRepository.updateDraft:notFound")(
              new Error("Workflow draft not found"),
            ),
          ),
        onSome: Effect.succeed,
      });
    });

  const getDraft: WorkflowRepositoryShape["getDraft"] = (workflowId) =>
    getDraftRow({ workflowId }).pipe(
      Effect.mapError(
        toPersistenceSqlOrDecodeError(
          "WorkflowRepository.getDraft:query",
          "WorkflowRepository.getDraft:decodeRows",
        ),
      ),
    );

  const listDraftsForThread: WorkflowRepositoryShape["listDraftsForThread"] = (input) =>
    listDraftRowsForThread(input).pipe(
      Effect.mapError(
        toPersistenceSqlOrDecodeError(
          "WorkflowRepository.listDraftsForThread:query",
          "WorkflowRepository.listDraftsForThread:decodeRows",
        ),
      ),
    );

  const latestRunnableDraftForThread: WorkflowRepositoryShape["latestRunnableDraftForThread"] = (
    input,
  ) =>
    latestRunnableDraftRowForThread(input).pipe(
      Effect.mapError(
        toPersistenceSqlOrDecodeError(
          "WorkflowRepository.latestRunnableDraftForThread:query",
          "WorkflowRepository.latestRunnableDraftForThread:decodeRows",
        ),
      ),
    );

  const insertRun: WorkflowRepositoryShape["insertRun"] = (row) =>
    insertRunRow(row).pipe(
      Effect.mapError(
        toPersistenceSqlOrDecodeError(
          "WorkflowRepository.insertRun:query",
          "WorkflowRepository.insertRun:encodeRequest",
        ),
      ),
    );

  const updateRun: WorkflowRepositoryShape["updateRun"] = (runId, patch) =>
    Effect.gen(function* () {
      yield* sql`
        UPDATE workflow_runs
        SET
          status = COALESCE(${patch.status ?? null}, status),
          summary = CASE
            WHEN ${patch.summary !== undefined ? 1 : 0} = 1
              THEN ${patch.summary === undefined ? null : patch.summary}
            ELSE summary
          END,
          completed_at = CASE
            WHEN ${patch.completedAt !== undefined ? 1 : 0} = 1
              THEN ${patch.completedAt === undefined ? null : patch.completedAt}
            ELSE completed_at
          END,
          last_updated_at = ${patch.lastUpdatedAt}
        WHERE run_id = ${runId}
      `.pipe(Effect.mapError(toPersistenceSqlError("WorkflowRepository.updateRun:update")));
      const rowOption = yield* getRunRow({ runId }).pipe(
        Effect.mapError(
          toPersistenceSqlOrDecodeError(
            "WorkflowRepository.updateRun:query",
            "WorkflowRepository.updateRun:decodeRows",
          ),
        ),
      );
      return yield* Option.match(rowOption, {
        onNone: () =>
          Effect.fail(
            toPersistenceSqlError("WorkflowRepository.updateRun:notFound")(
              new Error("Workflow run not found"),
            ),
          ),
        onSome: reconstructSnapshot,
      });
    }).pipe(
      Effect.mapError(
        toPersistenceSqlOrDecodeError(
          "WorkflowRepository.updateRun:query",
          "WorkflowRepository.updateRun:decodeRows",
        ),
      ),
    );

  const getRun: WorkflowRepositoryShape["getRun"] = (runId) =>
    getRunRow({ runId }).pipe(
      Effect.flatMap((rowOption) =>
        Option.match(rowOption, {
          onNone: () => Effect.succeed(Option.none<WorkflowRunSnapshot>()),
          onSome: (row) => reconstructSnapshot(row).pipe(Effect.map(Option.some)),
        }),
      ),
      Effect.mapError(
        toPersistenceSqlOrDecodeError(
          "WorkflowRepository.getRun:query",
          "WorkflowRepository.getRun:decodeRows",
        ),
      ),
    );

  const listSnapshots = (rows: ReadonlyArray<WorkflowRunDbRow>) =>
    Effect.gen(function* () {
      const snapshots: WorkflowRunSnapshot[] = [];
      for (const row of rows) {
        snapshots.push(yield* reconstructSnapshot(row));
      }
      return snapshots as ReadonlyArray<WorkflowRunSnapshot>;
    });

  const listRunsForWorkflow: WorkflowRepositoryShape["listRunsForWorkflow"] = (workflowId) =>
    listRunRowsForWorkflow({ workflowId }).pipe(
      Effect.flatMap(listSnapshots),
      Effect.mapError(
        toPersistenceSqlOrDecodeError(
          "WorkflowRepository.listRunsForWorkflow:query",
          "WorkflowRepository.listRunsForWorkflow:decodeRows",
        ),
      ),
    );

  const listRunsForThread: WorkflowRepositoryShape["listRunsForThread"] = (input) =>
    listRunRowsForThread(input).pipe(
      Effect.flatMap(listSnapshots),
      Effect.mapError(
        toPersistenceSqlOrDecodeError(
          "WorkflowRepository.listRunsForThread:query",
          "WorkflowRepository.listRunsForThread:decodeRows",
        ),
      ),
    );

  const listActiveRuns: WorkflowRepositoryShape["listActiveRuns"] = () =>
    listActiveRunRows({}).pipe(
      Effect.flatMap(listSnapshots),
      Effect.mapError(
        toPersistenceSqlOrDecodeError(
          "WorkflowRepository.listActiveRuns:query",
          "WorkflowRepository.listActiveRuns:decodeRows",
        ),
      ),
    );

  const upsertStep: WorkflowRepositoryShape["upsertStep"] = (step) =>
    sql`
      INSERT INTO workflow_steps (
        step_id,
        run_id,
        step_key,
        status,
        result_json,
        error,
        sequence,
        started_at,
        completed_at
      )
      VALUES (
        ${step.stepId},
        ${step.runId},
        ${step.stepKey},
        ${step.status},
        ${JSON.stringify(step.result ?? null)},
        ${step.error},
        ${step.sequence},
        ${step.startedAt},
        ${step.completedAt}
      )
      ON CONFLICT(step_id)
      DO UPDATE SET
        run_id = excluded.run_id,
        step_key = excluded.step_key,
        status = excluded.status,
        result_json = excluded.result_json,
        error = excluded.error,
        sequence = excluded.sequence,
        started_at = excluded.started_at,
        completed_at = excluded.completed_at
    `.pipe(
      Effect.as(step),
      Effect.mapError(toPersistenceSqlError("WorkflowRepository.upsertStep:query")),
    );

  const upsertAgent: WorkflowRepositoryShape["upsertAgent"] = (agent) =>
    sql`
      INSERT INTO workflow_agents (
        agent_id,
        run_id,
        name,
        role,
        thread_id,
        status,
        model_selection_json,
        runtime_mode,
        mcp_server_ids_json,
        created_at,
        updated_at
      )
      VALUES (
        ${agent.agentId},
        ${agent.runId},
        ${agent.name},
        ${agent.role},
        ${agent.threadId},
        ${agent.status},
        ${agent.modelSelection ? JSON.stringify(agent.modelSelection) : null},
        ${agent.runtimeMode ?? null},
        ${JSON.stringify(agent.mcpServerIds)},
        ${agent.createdAt},
        ${agent.updatedAt}
      )
      ON CONFLICT(agent_id)
      DO UPDATE SET
        run_id = excluded.run_id,
        name = excluded.name,
        role = excluded.role,
        thread_id = excluded.thread_id,
        status = excluded.status,
        model_selection_json = excluded.model_selection_json,
        runtime_mode = excluded.runtime_mode,
        mcp_server_ids_json = excluded.mcp_server_ids_json,
        created_at = excluded.created_at,
        updated_at = excluded.updated_at
    `.pipe(
      Effect.as(agent),
      Effect.mapError(toPersistenceSqlError("WorkflowRepository.upsertAgent:query")),
    );

  const upsertTask: WorkflowRepositoryShape["upsertTask"] = (task) =>
    sql`
      INSERT INTO workflow_tasks (
        task_id,
        run_id,
        title,
        reason,
        kind,
        assignee,
        prompt,
        status,
        created_by_agent_id,
        result_json,
        error,
        created_at,
        updated_at
      )
      VALUES (
        ${task.taskId},
        ${task.runId},
        ${task.title},
        ${task.reason},
        ${task.kind},
        ${task.assignee},
        ${task.prompt},
        ${task.status},
        ${task.createdByAgentId},
        ${JSON.stringify(task.result ?? null)},
        ${task.error},
        ${task.createdAt},
        ${task.updatedAt}
      )
      ON CONFLICT(task_id)
      DO UPDATE SET
        run_id = excluded.run_id,
        title = excluded.title,
        reason = excluded.reason,
        kind = excluded.kind,
        assignee = excluded.assignee,
        prompt = excluded.prompt,
        status = excluded.status,
        created_by_agent_id = excluded.created_by_agent_id,
        result_json = excluded.result_json,
        error = excluded.error,
        created_at = excluded.created_at,
        updated_at = excluded.updated_at
    `.pipe(
      Effect.as(task),
      Effect.mapError(toPersistenceSqlError("WorkflowRepository.upsertTask:query")),
    );

  const upsertInputRequest: WorkflowRepositoryShape["upsertInputRequest"] = (request) =>
    sql`
      INSERT INTO workflow_input_requests (
        request_id,
        run_id,
        title,
        body,
        fields_json,
        status,
        response_json,
        created_at,
        resolved_at
      )
      VALUES (
        ${request.requestId},
        ${request.runId},
        ${request.title},
        ${request.body},
        ${JSON.stringify(request.fields ?? null)},
        ${request.status},
        ${JSON.stringify(request.response ?? null)},
        ${request.createdAt},
        ${request.resolvedAt}
      )
      ON CONFLICT(request_id)
      DO UPDATE SET
        run_id = excluded.run_id,
        title = excluded.title,
        body = excluded.body,
        fields_json = excluded.fields_json,
        status = excluded.status,
        response_json = excluded.response_json,
        created_at = excluded.created_at,
        resolved_at = excluded.resolved_at
    `.pipe(
      Effect.as(request),
      Effect.mapError(toPersistenceSqlError("WorkflowRepository.upsertInputRequest:query")),
    );

  const upsertState: WorkflowRepositoryShape["upsertState"] = (entry) =>
    sql`
      INSERT INTO workflow_state (
        run_id,
        scope,
        key,
        value_json,
        updated_at
      )
      VALUES (
        ${entry.runId},
        ${entry.scope},
        ${entry.key},
        ${JSON.stringify(entry.value ?? null)},
        ${entry.updatedAt}
      )
      ON CONFLICT(run_id, scope, key)
      DO UPDATE SET
        value_json = excluded.value_json,
        updated_at = excluded.updated_at
    `.pipe(
      Effect.as(entry),
      Effect.mapError(toPersistenceSqlError("WorkflowRepository.upsertState:query")),
    );

  const appendEvent: WorkflowRepositoryShape["appendEvent"] = (event: WorkflowEventAppend) =>
    sql
      .withTransaction(
        Effect.gen(function* () {
          const sequenceRows =
            event.runId !== null
              ? yield* sql<{ readonly next: number }>`
                  SELECT COALESCE(MAX(sequence) + 1, 0) AS "next"
                  FROM workflow_events
                  WHERE run_id = ${event.runId}
                `
              : yield* sql<{ readonly next: number }>`
                  SELECT COALESCE(MAX(sequence) + 1, 0) AS "next"
                  FROM workflow_events
                  WHERE workflow_id = ${event.workflowId}
                    AND run_id IS NULL
                `;
          const sequence = NonNegativeInt.make(sequenceRows[0]?.next ?? 0);
          const persisted: WorkflowEvent = {
            eventId: WorkflowEventId.make(randomUUID()),
            workflowId: event.workflowId,
            runId: event.runId,
            stepId: event.stepId,
            agentId: event.agentId,
            taskId: event.taskId,
            kind: event.kind,
            title: event.title as WorkflowEvent["title"],
            body: event.body,
            payload: event.payload,
            sequence,
            createdAt: event.createdAt,
          };
          yield* sql`
            INSERT INTO workflow_events (
              event_id,
              workflow_id,
              run_id,
              step_id,
              agent_id,
              task_id,
              kind,
              title,
              body,
              payload_json,
              sequence,
              created_at
            )
            VALUES (
              ${persisted.eventId},
              ${persisted.workflowId},
              ${persisted.runId},
              ${persisted.stepId},
              ${persisted.agentId},
              ${persisted.taskId},
              ${persisted.kind},
              ${persisted.title},
              ${persisted.body},
              ${JSON.stringify(persisted.payload ?? null)},
              ${persisted.sequence},
              ${persisted.createdAt}
            )
          `;
          return persisted;
        }),
      )
      .pipe(
        Effect.mapError(
          toPersistenceSqlOrDecodeError(
            "WorkflowRepository.appendEvent:query",
            "WorkflowRepository.appendEvent:decodeRows",
          ),
        ),
      );

  const listEventsForRun: WorkflowRepositoryShape["listEventsForRun"] = (runId) =>
    listEventRowsForRun({ runId }).pipe(
      Effect.map((rows) => rows.map(dbEventRowToEvent)),
      Effect.mapError(
        toPersistenceSqlOrDecodeError(
          "WorkflowRepository.listEventsForRun:query",
          "WorkflowRepository.listEventsForRun:decodeRows",
        ),
      ),
    );

  return {
    insertDraft,
    updateDraft,
    getDraft,
    listDraftsForThread,
    latestRunnableDraftForThread,
    insertRun,
    updateRun,
    getRun,
    listRunsForWorkflow,
    listRunsForThread,
    listActiveRuns,
    upsertStep,
    upsertAgent,
    upsertTask,
    upsertInputRequest,
    upsertState,
    appendEvent,
    listEventsForRun,
  } satisfies WorkflowRepositoryShape;
});

export const WorkflowRepositoryLive = Layer.effect(WorkflowRepository, makeWorkflowRepository);
