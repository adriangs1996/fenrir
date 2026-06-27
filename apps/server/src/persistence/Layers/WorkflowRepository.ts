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
  WorkflowMemoryItem,
  WorkflowPromptBuild,
  WorkflowRunId,
  WorkflowRunSnapshot,
  WorkflowSchedule,
  WorkflowStateEntry,
  WorkflowStepSnapshot,
  WorkflowTaskSnapshot,
  WorkflowThreadLink,
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
    runtimeContext: Schema.fromJsonString(Schema.Unknown),
  }),
);
type WorkflowRunDbRow = typeof WorkflowRunDbRow.Type;

const WorkflowDraftDbRow = WorkflowDraftRow.mapFields(
  Struct.assign({
    declaredCapabilities: Schema.fromJsonString(Schema.Array(Schema.String)),
    defaultRuntimeContext: Schema.fromJsonString(Schema.Unknown),
  }),
);
type WorkflowDraftDbRow = typeof WorkflowDraftDbRow.Type;

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

const WorkflowScheduleDbRow = WorkflowSchedule.mapFields(
  Struct.assign({
    args: Schema.fromJsonString(Schema.Unknown),
    runtimeContext: Schema.fromJsonString(Schema.Unknown),
  }),
);
type WorkflowScheduleDbRow = typeof WorkflowScheduleDbRow.Type;

const WorkflowMemoryItemDbRow = WorkflowMemoryItem.mapFields(
  Struct.assign({
    evidenceRunIds: Schema.fromJsonString(Schema.Array(WorkflowRunId)),
    evidenceEventIds: Schema.fromJsonString(Schema.Array(WorkflowEventId)),
  }),
);
type WorkflowMemoryItemDbRow = typeof WorkflowMemoryItemDbRow.Type;

const WorkflowPromptBuildDbRow = WorkflowPromptBuild.mapFields(
  Struct.assign({
    selectedMemoryIds: Schema.fromJsonString(Schema.Array(WorkflowMemoryItem.fields.memoryId)),
    selectedContextRefs: Schema.fromJsonString(Schema.Array(Schema.String)),
  }),
);
type WorkflowPromptBuildDbRow = typeof WorkflowPromptBuildDbRow.Type;

function toPersistenceSqlOrDecodeError(sqlOperation: string, decodeOperation: string) {
  return (cause: unknown) =>
    Schema.isSchemaError(cause)
      ? toPersistenceDecodeError(decodeOperation)(cause)
      : toPersistenceSqlError(sqlOperation)(cause);
}

function dbDraftRowToDraftRow(row: WorkflowDraftDbRow): WorkflowDraftRow {
  return {
    ...row,
    declaredCapabilities: (row.declaredCapabilities ?? []) as NonNullable<
      WorkflowDraftRow["declaredCapabilities"]
    >,
    defaultRuntimeContext: row.defaultRuntimeContext,
  };
}

function dbRunRowToRunRow(row: WorkflowRunDbRow): WorkflowRunRow {
  return {
    ...row,
    args: row.args,
    runtimeContext: row.runtimeContext,
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

function dbScheduleRowToSchedule(row: WorkflowScheduleDbRow): WorkflowSchedule {
  return {
    ...row,
    args: row.args,
    runtimeContext: row.runtimeContext,
  };
}

function dbMemoryItemRowToMemoryItem(row: WorkflowMemoryItemDbRow): WorkflowMemoryItem {
  return {
    ...row,
    evidenceRunIds: row.evidenceRunIds,
    evidenceEventIds: row.evidenceEventIds,
  };
}

function dbPromptBuildRowToPromptBuild(row: WorkflowPromptBuildDbRow): WorkflowPromptBuild {
  return {
    ...row,
    selectedMemoryIds: row.selectedMemoryIds,
    selectedContextRefs: row.selectedContextRefs as WorkflowPromptBuild["selectedContextRefs"],
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
    ...(input.run.trigger !== undefined ? { trigger: input.run.trigger } : {}),
    ...(input.run.requestedByThreadId !== undefined
      ? { requestedByThreadId: input.run.requestedByThreadId }
      : {}),
    ...(input.run.scheduleId !== undefined ? { scheduleId: input.run.scheduleId } : {}),
    ...(input.run.runtimeContext !== undefined ? { runtimeContext: input.run.runtimeContext } : {}),
    ...(input.run.sourceRevision !== undefined ? { sourceRevision: input.run.sourceRevision } : {}),
    ...(input.run.memoryRevision !== undefined ? { memoryRevision: input.run.memoryRevision } : {}),
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
    Result: WorkflowDraftDbRow,
    execute: ({ workflowId }) =>
      sql`
        SELECT
          workflow_id AS "workflowId",
          project_id AS "projectId",
          origin_thread_id AS "originThreadId",
          created_from_thread_id AS "createdFromThreadId",
          name,
          description,
          source,
          source_hash AS "sourceHash",
          source_revision AS "sourceRevision",
          status,
          validation_status AS "validationStatus",
          validation_error AS "validationError",
          declared_capabilities_json AS "declaredCapabilities",
          default_runtime_context_json AS "defaultRuntimeContext",
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
    Result: WorkflowDraftDbRow,
    execute: ({ projectId, originThreadId }) =>
      sql`
        SELECT
          workflow_id AS "workflowId",
          project_id AS "projectId",
          origin_thread_id AS "originThreadId",
          created_from_thread_id AS "createdFromThreadId",
          name,
          description,
          source,
          source_hash AS "sourceHash",
          source_revision AS "sourceRevision",
          status,
          validation_status AS "validationStatus",
          validation_error AS "validationError",
          declared_capabilities_json AS "declaredCapabilities",
          default_runtime_context_json AS "defaultRuntimeContext",
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
    Result: WorkflowDraftDbRow,
    execute: ({ projectId, originThreadId }) =>
      sql`
        SELECT
          workflow_id AS "workflowId",
          project_id AS "projectId",
          origin_thread_id AS "originThreadId",
          created_from_thread_id AS "createdFromThreadId",
          name,
          description,
          source,
          source_hash AS "sourceHash",
          source_revision AS "sourceRevision",
          status,
          validation_status AS "validationStatus",
          validation_error AS "validationError",
          declared_capabilities_json AS "declaredCapabilities",
          default_runtime_context_json AS "defaultRuntimeContext",
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

  const listDraftRowsForProject = SqlSchema.findAll({
    Request: Schema.Struct({ projectId: Schema.String, includeArchived: Schema.Boolean }),
    Result: WorkflowDraftDbRow,
    execute: ({ projectId, includeArchived }) =>
      sql`
        SELECT
          workflow_id AS "workflowId",
          project_id AS "projectId",
          origin_thread_id AS "originThreadId",
          created_from_thread_id AS "createdFromThreadId",
          name,
          description,
          source,
          source_hash AS "sourceHash",
          source_revision AS "sourceRevision",
          status,
          validation_status AS "validationStatus",
          validation_error AS "validationError",
          declared_capabilities_json AS "declaredCapabilities",
          default_runtime_context_json AS "defaultRuntimeContext",
          created_at AS "createdAt",
          updated_at AS "updatedAt",
          archived_at AS "archivedAt"
        FROM workflows
        WHERE project_id = ${projectId}
          AND (${includeArchived ? 1 : 0} = 1 OR archived_at IS NULL)
        ORDER BY updated_at DESC, workflow_id ASC
      `,
  });

  const listThreadLinkRows = SqlSchema.findAll({
    Request: Schema.Struct({ projectId: Schema.String, threadId: Schema.String }),
    Result: WorkflowThreadLink,
    execute: ({ projectId, threadId }) =>
      sql`
        SELECT
          workflow_id AS "workflowId",
          project_id AS "projectId",
          thread_id AS "threadId",
          relation,
          created_at AS "createdAt",
          updated_at AS "updatedAt"
        FROM workflow_thread_links
        WHERE project_id = ${projectId}
          AND thread_id = ${threadId}
        ORDER BY updated_at DESC, workflow_id ASC, relation ASC
      `,
  });

  const listProjectThreadLinkRows = SqlSchema.findAll({
    Request: Schema.Struct({ projectId: Schema.String }),
    Result: WorkflowThreadLink,
    execute: ({ projectId }) =>
      sql`
        SELECT
          workflow_id AS "workflowId",
          project_id AS "projectId",
          thread_id AS "threadId",
          relation,
          created_at AS "createdAt",
          updated_at AS "updatedAt"
        FROM workflow_thread_links
        WHERE project_id = ${projectId}
        ORDER BY updated_at DESC, workflow_id ASC, thread_id ASC, relation ASC
      `,
  });

  const getScheduleRow = SqlSchema.findOneOption({
    Request: Schema.Struct({ scheduleId: WorkflowSchedule.fields.scheduleId }),
    Result: WorkflowScheduleDbRow,
    execute: ({ scheduleId }) =>
      sql`
        SELECT
          schedule_id AS "scheduleId",
          workflow_id AS "workflowId",
          project_id AS "projectId",
          run_at AS "runAt",
          args_json AS "args",
          runtime_context_json AS "runtimeContext",
          requested_by_thread_id AS "requestedByThreadId",
          status,
          run_id AS "runId",
          created_at AS "createdAt",
          updated_at AS "updatedAt"
        FROM workflow_schedules
        WHERE schedule_id = ${scheduleId}
        LIMIT 1
      `,
  });

  const listScheduleRowsForProject = SqlSchema.findAll({
    Request: Schema.Struct({ projectId: Schema.String, includeCompleted: Schema.Boolean }),
    Result: WorkflowScheduleDbRow,
    execute: ({ projectId, includeCompleted }) =>
      sql`
        SELECT
          schedule_id AS "scheduleId",
          workflow_id AS "workflowId",
          project_id AS "projectId",
          run_at AS "runAt",
          args_json AS "args",
          runtime_context_json AS "runtimeContext",
          requested_by_thread_id AS "requestedByThreadId",
          status,
          run_id AS "runId",
          created_at AS "createdAt",
          updated_at AS "updatedAt"
        FROM workflow_schedules
        WHERE project_id = ${projectId}
          AND (${includeCompleted ? 1 : 0} = 1 OR status IN ('scheduled', 'claimed'))
        ORDER BY run_at DESC, schedule_id ASC
      `,
  });

  const listDueScheduleRows = SqlSchema.findAll({
    Request: Schema.Struct({ now: Schema.String, limit: Schema.Number }),
    Result: WorkflowScheduleDbRow,
    execute: ({ now, limit }) =>
      sql`
        SELECT
          schedule_id AS "scheduleId",
          workflow_id AS "workflowId",
          project_id AS "projectId",
          run_at AS "runAt",
          args_json AS "args",
          runtime_context_json AS "runtimeContext",
          requested_by_thread_id AS "requestedByThreadId",
          status,
          run_id AS "runId",
          created_at AS "createdAt",
          updated_at AS "updatedAt"
        FROM workflow_schedules
        WHERE status = 'scheduled'
          AND run_at <= ${now}
        ORDER BY run_at ASC, schedule_id ASC
        LIMIT ${Math.max(1, Math.min(100, Math.trunc(limit)))}
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
          trigger,
          requested_by_thread_id AS "requestedByThreadId",
          schedule_id AS "scheduleId",
          name,
          args_json AS "args",
          runtime_context_json AS "runtimeContext",
          source_snapshot AS "sourceSnapshot",
          source_hash AS "sourceHash",
          source_revision AS "sourceRevision",
          memory_revision AS "memoryRevision",
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
          trigger,
          requested_by_thread_id AS "requestedByThreadId",
          schedule_id AS "scheduleId",
          name,
          args_json AS "args",
          runtime_context_json AS "runtimeContext",
          source_snapshot AS "sourceSnapshot",
          source_hash AS "sourceHash",
          source_revision AS "sourceRevision",
          memory_revision AS "memoryRevision",
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
          trigger,
          requested_by_thread_id AS "requestedByThreadId",
          schedule_id AS "scheduleId",
          name,
          args_json AS "args",
          runtime_context_json AS "runtimeContext",
          source_snapshot AS "sourceSnapshot",
          source_hash AS "sourceHash",
          source_revision AS "sourceRevision",
          memory_revision AS "memoryRevision",
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

  const listRunRowsForProject = SqlSchema.findAll({
    Request: Schema.Struct({ projectId: Schema.String }),
    Result: WorkflowRunDbRow,
    execute: ({ projectId }) =>
      sql`
        SELECT
          run_id AS "runId",
          workflow_id AS "workflowId",
          project_id AS "projectId",
          origin_thread_id AS "originThreadId",
          trigger,
          requested_by_thread_id AS "requestedByThreadId",
          schedule_id AS "scheduleId",
          name,
          args_json AS "args",
          runtime_context_json AS "runtimeContext",
          source_snapshot AS "sourceSnapshot",
          source_hash AS "sourceHash",
          source_revision AS "sourceRevision",
          memory_revision AS "memoryRevision",
          status,
          summary,
          started_at AS "startedAt",
          completed_at AS "completedAt",
          last_updated_at AS "lastUpdatedAt"
        FROM workflow_runs
        WHERE project_id = ${projectId}
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
          trigger,
          requested_by_thread_id AS "requestedByThreadId",
          schedule_id AS "scheduleId",
          name,
          args_json AS "args",
          runtime_context_json AS "runtimeContext",
          source_snapshot AS "sourceSnapshot",
          source_hash AS "sourceHash",
          source_revision AS "sourceRevision",
          memory_revision AS "memoryRevision",
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

  const listMemoryItemRows = SqlSchema.findAll({
    Request: Schema.Struct({ workflowId: WorkflowId, includeSuppressed: Schema.Boolean }),
    Result: WorkflowMemoryItemDbRow,
    execute: ({ workflowId, includeSuppressed }) =>
      sql`
        SELECT
          memory_id AS "memoryId",
          workflow_id AS "workflowId",
          project_id AS "projectId",
          kind,
          content,
          evidence_run_ids_json AS "evidenceRunIds",
          evidence_event_ids_json AS "evidenceEventIds",
          confidence,
          status,
          usage_count AS "usageCount",
          success_count AS "successCount",
          last_used_at AS "lastUsedAt",
          created_at AS "createdAt",
          updated_at AS "updatedAt"
        FROM workflow_memory_items
        WHERE workflow_id = ${workflowId}
          AND (${includeSuppressed ? 1 : 0} = 1 OR status != 'suppressed')
        ORDER BY updated_at DESC, memory_id ASC
      `,
  });

  const getMemoryItemRow = SqlSchema.findOneOption({
    Request: Schema.Struct({ memoryId: WorkflowMemoryItem.fields.memoryId }),
    Result: WorkflowMemoryItemDbRow,
    execute: ({ memoryId }) =>
      sql`
        SELECT
          memory_id AS "memoryId",
          workflow_id AS "workflowId",
          project_id AS "projectId",
          kind,
          content,
          evidence_run_ids_json AS "evidenceRunIds",
          evidence_event_ids_json AS "evidenceEventIds",
          confidence,
          status,
          usage_count AS "usageCount",
          success_count AS "successCount",
          last_used_at AS "lastUsedAt",
          created_at AS "createdAt",
          updated_at AS "updatedAt"
        FROM workflow_memory_items
        WHERE memory_id = ${memoryId}
        LIMIT 1
      `,
  });

  const listPromptBuildRowsForRun = SqlSchema.findAll({
    Request: Schema.Struct({ runId: WorkflowRunId }),
    Result: WorkflowPromptBuildDbRow,
    execute: ({ runId }) =>
      sql`
        SELECT
          prompt_build_id AS "promptBuildId",
          run_id AS "runId",
          step_id AS "stepId",
          agent_name AS "agentName",
          selected_memory_ids_json AS "selectedMemoryIds",
          selected_context_refs_json AS "selectedContextRefs",
          rendered_prompt AS "renderedPrompt",
          rationale,
          created_at AS "createdAt"
        FROM workflow_prompt_builds
        WHERE run_id = ${runId}
        ORDER BY created_at ASC, prompt_build_id ASC
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
          created_from_thread_id,
          name,
          description,
          source,
          source_hash,
          source_revision,
          status,
          validation_status,
          validation_error,
          declared_capabilities_json,
          default_runtime_context_json,
          created_at,
          updated_at,
          archived_at
        )
        VALUES (
          ${row.workflowId},
          ${row.projectId},
          ${row.originThreadId},
          ${row.createdFromThreadId ?? null},
          ${row.name},
          ${row.description},
          ${row.source},
          ${row.sourceHash},
          ${row.sourceRevision ?? 1},
          ${row.status},
          ${row.validationStatus},
          ${row.validationError},
          ${JSON.stringify(row.declaredCapabilities ?? [])},
          ${JSON.stringify(row.defaultRuntimeContext ?? {})},
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
          trigger,
          requested_by_thread_id,
          schedule_id,
          name,
          args_json,
          runtime_context_json,
          source_snapshot,
          source_hash,
          source_revision,
          memory_revision,
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
          ${row.trigger ?? "thread"},
          ${
            row.requestedByThreadId !== undefined
              ? row.requestedByThreadId
              : row.trigger === "thread"
                ? row.originThreadId
                : null
          },
          ${row.scheduleId ?? null},
          ${row.name},
          ${JSON.stringify(row.args ?? null)},
          ${JSON.stringify(row.runtimeContext ?? {})},
          ${row.sourceSnapshot},
          ${row.sourceHash},
          ${row.sourceRevision ?? 1},
          ${row.memoryRevision ?? 0},
          ${row.status},
          ${row.summary},
          ${row.startedAt},
          ${row.completedAt},
          ${row.lastUpdatedAt}
        )
      `,
  });

  const insertScheduleRow = SqlSchema.void({
    Request: WorkflowSchedule,
    execute: (schedule) =>
      sql`
        INSERT INTO workflow_schedules (
          schedule_id,
          workflow_id,
          project_id,
          run_at,
          args_json,
          runtime_context_json,
          requested_by_thread_id,
          status,
          run_id,
          created_at,
          updated_at
        )
        VALUES (
          ${schedule.scheduleId},
          ${schedule.workflowId},
          ${schedule.projectId},
          ${schedule.runAt},
          ${JSON.stringify(schedule.args ?? null)},
          ${JSON.stringify(schedule.runtimeContext ?? {})},
          ${schedule.requestedByThreadId},
          ${schedule.status},
          ${schedule.runId},
          ${schedule.createdAt},
          ${schedule.updatedAt}
        )
      `,
  });

  const insertMemoryItemRow = SqlSchema.void({
    Request: WorkflowMemoryItem,
    execute: (item) =>
      sql`
        INSERT INTO workflow_memory_items (
          memory_id,
          workflow_id,
          project_id,
          kind,
          content,
          evidence_run_ids_json,
          evidence_event_ids_json,
          confidence,
          status,
          usage_count,
          success_count,
          last_used_at,
          created_at,
          updated_at
        )
        VALUES (
          ${item.memoryId},
          ${item.workflowId},
          ${item.projectId},
          ${item.kind},
          ${item.content},
          ${JSON.stringify(item.evidenceRunIds)},
          ${JSON.stringify(item.evidenceEventIds)},
          ${item.confidence},
          ${item.status},
          ${item.usageCount},
          ${item.successCount},
          ${item.lastUsedAt},
          ${item.createdAt},
          ${item.updatedAt}
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
        onSome: (row) => Effect.succeed(dbDraftRowToDraftRow(row)),
      });
    });

  const getDraft: WorkflowRepositoryShape["getDraft"] = (workflowId) =>
    getDraftRow({ workflowId }).pipe(
      Effect.map(Option.map(dbDraftRowToDraftRow)),
      Effect.mapError(
        toPersistenceSqlOrDecodeError(
          "WorkflowRepository.getDraft:query",
          "WorkflowRepository.getDraft:decodeRows",
        ),
      ),
    );

  const listDraftsForThread: WorkflowRepositoryShape["listDraftsForThread"] = (input) =>
    listDraftRowsForThread(input).pipe(
      Effect.map((rows) => rows.map(dbDraftRowToDraftRow)),
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
      Effect.map(Option.map(dbDraftRowToDraftRow)),
      Effect.mapError(
        toPersistenceSqlOrDecodeError(
          "WorkflowRepository.latestRunnableDraftForThread:query",
          "WorkflowRepository.latestRunnableDraftForThread:decodeRows",
        ),
      ),
    );

  const listDraftsForProject: WorkflowRepositoryShape["listDraftsForProject"] = (input) =>
    listDraftRowsForProject({
      projectId: input.projectId,
      includeArchived: input.includeArchived ?? false,
    }).pipe(
      Effect.map((rows) => rows.map(dbDraftRowToDraftRow)),
      Effect.mapError(
        toPersistenceSqlOrDecodeError(
          "WorkflowRepository.listDraftsForProject:query",
          "WorkflowRepository.listDraftsForProject:decodeRows",
        ),
      ),
    );

  const upsertThreadLink: WorkflowRepositoryShape["upsertThreadLink"] = (link) =>
    sql`
      INSERT INTO workflow_thread_links (
        workflow_id,
        project_id,
        thread_id,
        relation,
        created_at,
        updated_at
      )
      VALUES (
        ${link.workflowId},
        ${link.projectId},
        ${link.threadId},
        ${link.relation},
        ${link.createdAt},
        ${link.updatedAt}
      )
      ON CONFLICT(workflow_id, thread_id, relation)
      DO UPDATE SET
        project_id = excluded.project_id,
        updated_at = excluded.updated_at
    `.pipe(
      Effect.as(link),
      Effect.mapError(toPersistenceSqlError("WorkflowRepository.upsertThreadLink:query")),
    );

  const listThreadLinks: WorkflowRepositoryShape["listThreadLinks"] = (input) =>
    listThreadLinkRows(input).pipe(
      Effect.mapError(
        toPersistenceSqlOrDecodeError(
          "WorkflowRepository.listThreadLinks:query",
          "WorkflowRepository.listThreadLinks:decodeRows",
        ),
      ),
    );

  const listProjectThreadLinks: WorkflowRepositoryShape["listProjectThreadLinks"] = (projectId) =>
    listProjectThreadLinkRows({ projectId }).pipe(
      Effect.mapError(
        toPersistenceSqlOrDecodeError(
          "WorkflowRepository.listProjectThreadLinks:query",
          "WorkflowRepository.listProjectThreadLinks:decodeRows",
        ),
      ),
    );

  const deleteThreadLink: WorkflowRepositoryShape["deleteThreadLink"] = (input) =>
    sql`
      DELETE FROM workflow_thread_links
      WHERE workflow_id = ${input.workflowId}
        AND thread_id = ${input.threadId}
        AND (${input.relation === undefined ? 1 : 0} = 1 OR relation = ${input.relation ?? null})
    `.pipe(
      Effect.asVoid,
      Effect.mapError(toPersistenceSqlError("WorkflowRepository.deleteThreadLink:query")),
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

  const listRunsForProject: WorkflowRepositoryShape["listRunsForProject"] = (input) =>
    listRunRowsForProject(input).pipe(
      Effect.flatMap(listSnapshots),
      Effect.mapError(
        toPersistenceSqlOrDecodeError(
          "WorkflowRepository.listRunsForProject:query",
          "WorkflowRepository.listRunsForProject:decodeRows",
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

  const insertSchedule: WorkflowRepositoryShape["insertSchedule"] = (schedule) =>
    insertScheduleRow(schedule).pipe(
      Effect.as(schedule),
      Effect.mapError(
        toPersistenceSqlOrDecodeError(
          "WorkflowRepository.insertSchedule:query",
          "WorkflowRepository.insertSchedule:encodeRequest",
        ),
      ),
    );

  const getSchedule: WorkflowRepositoryShape["getSchedule"] = (scheduleId) =>
    getScheduleRow({ scheduleId }).pipe(
      Effect.map(Option.map(dbScheduleRowToSchedule)),
      Effect.mapError(
        toPersistenceSqlOrDecodeError(
          "WorkflowRepository.getSchedule:query",
          "WorkflowRepository.getSchedule:decodeRows",
        ),
      ),
    );

  const listSchedulesForProject: WorkflowRepositoryShape["listSchedulesForProject"] = (input) =>
    listScheduleRowsForProject({
      projectId: input.projectId,
      includeCompleted: input.includeCompleted ?? false,
    }).pipe(
      Effect.map((rows) => rows.map(dbScheduleRowToSchedule)),
      Effect.mapError(
        toPersistenceSqlOrDecodeError(
          "WorkflowRepository.listSchedulesForProject:query",
          "WorkflowRepository.listSchedulesForProject:decodeRows",
        ),
      ),
    );

  const listDueSchedules: WorkflowRepositoryShape["listDueSchedules"] = (input) =>
    listDueScheduleRows(input).pipe(
      Effect.map((rows) => rows.map(dbScheduleRowToSchedule)),
      Effect.mapError(
        toPersistenceSqlOrDecodeError(
          "WorkflowRepository.listDueSchedules:query",
          "WorkflowRepository.listDueSchedules:decodeRows",
        ),
      ),
    );

  const claimSchedule: WorkflowRepositoryShape["claimSchedule"] = (input) =>
    Effect.gen(function* () {
      yield* sql`
        UPDATE workflow_schedules
        SET status = 'claimed',
            updated_at = ${input.updatedAt}
        WHERE schedule_id = ${input.scheduleId}
          AND status = 'scheduled'
      `.pipe(Effect.mapError(toPersistenceSqlError("WorkflowRepository.claimSchedule:update")));
      const rowOption = yield* getScheduleRow({ scheduleId: input.scheduleId }).pipe(
        Effect.mapError(
          toPersistenceSqlOrDecodeError(
            "WorkflowRepository.claimSchedule:query",
            "WorkflowRepository.claimSchedule:decodeRows",
          ),
        ),
      );
      return Option.flatMap(rowOption, (row) =>
        row.status === "claimed" && row.updatedAt === input.updatedAt
          ? Option.some(dbScheduleRowToSchedule(row))
          : Option.none(),
      );
    });

  const updateScheduleStatus = (input: {
    readonly scheduleId: WorkflowSchedule["scheduleId"];
    readonly status: WorkflowSchedule["status"];
    readonly runId?: WorkflowSchedule["runId"] | undefined;
    readonly updatedAt: WorkflowSchedule["updatedAt"];
    readonly operation: string;
  }) =>
    Effect.gen(function* () {
      yield* sql`
        UPDATE workflow_schedules
        SET status = ${input.status},
            run_id = CASE
              WHEN ${input.runId !== undefined ? 1 : 0} = 1
                THEN ${input.runId === undefined ? null : input.runId}
              ELSE run_id
            END,
            updated_at = ${input.updatedAt}
        WHERE schedule_id = ${input.scheduleId}
      `.pipe(Effect.mapError(toPersistenceSqlError(`${input.operation}:update`)));
      const rowOption = yield* getScheduleRow({ scheduleId: input.scheduleId }).pipe(
        Effect.mapError(
          toPersistenceSqlOrDecodeError(
            `${input.operation}:query`,
            `${input.operation}:decodeRows`,
          ),
        ),
      );
      return yield* Option.match(rowOption, {
        onNone: () =>
          Effect.fail(
            toPersistenceSqlError(`${input.operation}:notFound`)(
              new Error("Workflow schedule not found"),
            ),
          ),
        onSome: (row) => Effect.succeed(dbScheduleRowToSchedule(row)),
      });
    });

  const completeSchedule: WorkflowRepositoryShape["completeSchedule"] = (input) =>
    updateScheduleStatus({
      scheduleId: input.scheduleId,
      status: "completed",
      runId: input.runId,
      updatedAt: input.updatedAt,
      operation: "WorkflowRepository.completeSchedule",
    });

  const failSchedule: WorkflowRepositoryShape["failSchedule"] = (input) =>
    updateScheduleStatus({
      scheduleId: input.scheduleId,
      status: "failed",
      updatedAt: input.updatedAt,
      operation: "WorkflowRepository.failSchedule",
    });

  const cancelSchedule: WorkflowRepositoryShape["cancelSchedule"] = (input) =>
    updateScheduleStatus({
      scheduleId: input.scheduleId,
      status: "cancelled",
      updatedAt: input.updatedAt,
      operation: "WorkflowRepository.cancelSchedule",
    });

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

  const listMemoryItems: WorkflowRepositoryShape["listMemoryItems"] = (input) =>
    listMemoryItemRows({
      workflowId: input.workflowId,
      includeSuppressed: input.includeSuppressed ?? false,
    }).pipe(
      Effect.map((rows) => rows.map(dbMemoryItemRowToMemoryItem)),
      Effect.mapError(
        toPersistenceSqlOrDecodeError(
          "WorkflowRepository.listMemoryItems:query",
          "WorkflowRepository.listMemoryItems:decodeRows",
        ),
      ),
    );

  const insertMemoryItem: WorkflowRepositoryShape["insertMemoryItem"] = (item) =>
    insertMemoryItemRow(item).pipe(
      Effect.as(item),
      Effect.mapError(
        toPersistenceSqlOrDecodeError(
          "WorkflowRepository.insertMemoryItem:query",
          "WorkflowRepository.insertMemoryItem:encodeRequest",
        ),
      ),
    );

  const recordMemoryUse: WorkflowRepositoryShape["recordMemoryUse"] = (input) =>
    Effect.forEach(
      input.memoryIds,
      (memoryId) =>
        sql`
          UPDATE workflow_memory_items
          SET usage_count = usage_count + 1,
              last_used_at = ${input.usedAt},
              updated_at = ${input.usedAt}
          WHERE memory_id = ${memoryId}
        `.pipe(Effect.mapError(toPersistenceSqlError("WorkflowRepository.recordMemoryUse:update"))),
      { concurrency: "unbounded", discard: true },
    );

  const suppressMemoryItem: WorkflowRepositoryShape["suppressMemoryItem"] = (memoryId, updatedAt) =>
    Effect.gen(function* () {
      yield* sql`
        UPDATE workflow_memory_items
        SET status = 'suppressed',
            updated_at = ${updatedAt}
        WHERE memory_id = ${memoryId}
      `.pipe(
        Effect.mapError(toPersistenceSqlError("WorkflowRepository.suppressMemoryItem:update")),
      );
      const rowOption = yield* getMemoryItemRow({ memoryId }).pipe(
        Effect.mapError(
          toPersistenceSqlOrDecodeError(
            "WorkflowRepository.suppressMemoryItem:query",
            "WorkflowRepository.suppressMemoryItem:decodeRows",
          ),
        ),
      );
      return yield* Option.match(rowOption, {
        onNone: () =>
          Effect.fail(
            toPersistenceSqlError("WorkflowRepository.suppressMemoryItem:notFound")(
              new Error("Workflow memory item not found"),
            ),
          ),
        onSome: (row) => Effect.succeed(dbMemoryItemRowToMemoryItem(row)),
      });
    });

  const insertPromptBuild: WorkflowRepositoryShape["insertPromptBuild"] = (promptBuild) =>
    sql`
      INSERT INTO workflow_prompt_builds (
        prompt_build_id,
        run_id,
        step_id,
        agent_name,
        selected_memory_ids_json,
        selected_context_refs_json,
        rendered_prompt,
        rationale,
        created_at
      )
      VALUES (
        ${promptBuild.promptBuildId},
        ${promptBuild.runId},
        ${promptBuild.stepId},
        ${promptBuild.agentName},
        ${JSON.stringify(promptBuild.selectedMemoryIds)},
        ${JSON.stringify(promptBuild.selectedContextRefs)},
        ${promptBuild.renderedPrompt},
        ${promptBuild.rationale},
        ${promptBuild.createdAt}
      )
    `.pipe(
      Effect.as(promptBuild),
      Effect.mapError(toPersistenceSqlError("WorkflowRepository.insertPromptBuild:query")),
    );

  const listPromptBuildsForRun: WorkflowRepositoryShape["listPromptBuildsForRun"] = (runId) =>
    listPromptBuildRowsForRun({ runId }).pipe(
      Effect.map((rows) => rows.map(dbPromptBuildRowToPromptBuild)),
      Effect.mapError(
        toPersistenceSqlOrDecodeError(
          "WorkflowRepository.listPromptBuildsForRun:query",
          "WorkflowRepository.listPromptBuildsForRun:decodeRows",
        ),
      ),
    );

  return {
    insertDraft,
    updateDraft,
    getDraft,
    listDraftsForThread,
    latestRunnableDraftForThread,
    listDraftsForProject,
    upsertThreadLink,
    listThreadLinks,
    listProjectThreadLinks,
    deleteThreadLink,
    insertRun,
    updateRun,
    getRun,
    listRunsForWorkflow,
    listRunsForThread,
    listRunsForProject,
    listActiveRuns,
    insertSchedule,
    getSchedule,
    listSchedulesForProject,
    listDueSchedules,
    claimSchedule,
    completeSchedule,
    failSchedule,
    cancelSchedule,
    upsertStep,
    upsertAgent,
    upsertTask,
    upsertInputRequest,
    upsertState,
    appendEvent,
    listEventsForRun,
    listMemoryItems,
    insertMemoryItem,
    recordMemoryUse,
    suppressMemoryItem,
    insertPromptBuild,
    listPromptBuildsForRun,
  } satisfies WorkflowRepositoryShape;
});

export const WorkflowRepositoryLive = Layer.effect(WorkflowRepository, makeWorkflowRepository);
