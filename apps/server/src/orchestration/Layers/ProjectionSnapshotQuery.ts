import {
  ChatAttachment,
  IsoDateTime,
  MessageId,
  NonNegativeInt,
  OrchestrationBootstrapSnapshot,
  OrchestrationShellSnapshot,
  OrchestrationCheckpointFile,
  OrchestrationProposedPlanId,
  OrchestrationReadModel,
  OrchestrationThreadShell,
  GlobalScriptProjectDefaults,
  ManagedProcess,
  ProjectScript,
  ThreadOwner,
  TurnId,
  type OrchestrationCheckpointSummary,
  type OrchestrationLatestTurn,
  type OrchestrationMessage,
  type OrchestrationProposedPlan,
  type OrchestrationProject,
  type OrchestrationSession,
  type OrchestrationThread,
  type OrchestrationThreadActivity,
  McpServerId,
  ModelSelection,
  ProjectId,
  ThreadId,
} from "@fenrir/contracts";
import { Duration, Effect, Layer, Option, Schema, Struct } from "effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";
import * as SqlSchema from "effect/unstable/sql/SqlSchema";

import {
  isPersistenceError,
  toPersistenceDecodeError,
  toPersistenceSqlError,
  type ProjectionRepositoryError,
} from "../../persistence/Errors.ts";
import { ProjectionCheckpoint } from "../../persistence/Services/ProjectionCheckpoints.ts";
import { ProjectionProject } from "../../persistence/Services/ProjectionProjects.ts";
import { ProjectionState } from "../../persistence/Services/ProjectionState.ts";
import { ProjectionThreadActivity } from "../../persistence/Services/ProjectionThreadActivities.ts";
import { ProjectionThreadMessage } from "../../persistence/Services/ProjectionThreadMessages.ts";
import { ProjectionThreadProposedPlan } from "../../persistence/Services/ProjectionThreadProposedPlans.ts";
import { ProjectionThreadSession } from "../../persistence/Services/ProjectionThreadSessions.ts";
import { ProjectionThread } from "../../persistence/Services/ProjectionThreads.ts";
import { SourceControlWorkspaceLive } from "../../sourceControl/SourceControlModule.ts";
import { SourceControl } from "../../sourceControl/Services/SourceControl.ts";
import {
  THREAD_ACTIVITY_READ_MODEL_LIMIT,
  THREAD_ACTIVITY_READ_MODEL_PAYLOAD_BUDGET_BYTES,
  THREAD_MESSAGE_READ_MODEL_LIMIT,
  THREAD_MESSAGE_READ_MODEL_PAYLOAD_BUDGET_BYTES,
  THREAD_PROPOSED_PLAN_READ_MODEL_LIMIT,
  THREAD_PROPOSED_PLAN_READ_MODEL_PAYLOAD_BUDGET_BYTES,
} from "../projector.ts";
import { ORCHESTRATION_PROJECTOR_NAMES } from "./ProjectionPipeline.ts";
import {
  ProjectionSnapshotQuery,
  type ProjectionSnapshotCounts,
  type ProjectionThreadCheckpointContext,
  type ProjectionSnapshotQueryShape,
} from "../Services/ProjectionSnapshotQuery.ts";

const decodeReadModel = Schema.decodeUnknownEffect(OrchestrationReadModel);
const ProjectionProjectDbRowSchema = ProjectionProject.mapFields(
  Struct.assign({
    defaultModelSelection: Schema.NullOr(Schema.fromJsonString(ModelSelection)),
    scripts: Schema.fromJsonString(Schema.Array(ProjectScript)),
    globalScriptDefaults: Schema.fromJsonString(Schema.Array(GlobalScriptProjectDefaults)),
    managedProcesses: Schema.fromJsonString(Schema.Array(ManagedProcess)),
  }),
);
const ProjectionThreadMessageDbRowSchema = ProjectionThreadMessage.mapFields(
  Struct.assign({
    isStreaming: Schema.Number,
    attachments: Schema.NullOr(Schema.fromJsonString(Schema.Array(ChatAttachment))),
  }),
);
const ProjectionThreadProposedPlanDbRowSchema = ProjectionThreadProposedPlan;
const ProjectionThreadDbRowSchema = ProjectionThread.mapFields(
  Struct.assign({
    modelSelection: Schema.fromJsonString(ModelSelection),
    mcpServerIds: Schema.fromJsonString(Schema.Array(McpServerId)),
    owner: Schema.NullOr(Schema.fromJsonString(ThreadOwner)),
    deleteOnSettled: Schema.Number,
  }),
);
const ProjectionThreadActivityDbRowSchema = ProjectionThreadActivity.mapFields(
  Struct.assign({
    payload: Schema.fromJsonString(Schema.Unknown),
    sequence: Schema.NullOr(NonNegativeInt),
  }),
);
const ProjectionThreadSessionDbRowSchema = ProjectionThreadSession;
const ProjectionCheckpointDbRowSchema = ProjectionCheckpoint.mapFields(
  Struct.assign({
    files: Schema.fromJsonString(Schema.Array(OrchestrationCheckpointFile)),
  }),
);
const ProjectionLatestTurnDbRowSchema = Schema.Struct({
  threadId: ProjectionThread.fields.threadId,
  turnId: TurnId,
  state: Schema.String,
  requestedAt: IsoDateTime,
  startedAt: Schema.NullOr(IsoDateTime),
  completedAt: Schema.NullOr(IsoDateTime),
  assistantMessageId: Schema.NullOr(MessageId),
  sourceProposedPlanThreadId: Schema.NullOr(ThreadId),
  sourceProposedPlanId: Schema.NullOr(OrchestrationProposedPlanId),
});
const ProjectionStateDbRowSchema = ProjectionState;
const ProjectionCountsRowSchema = Schema.Struct({
  projectCount: Schema.Number,
  threadCount: Schema.Number,
});
const decodeBootstrapSnapshotValue = Schema.decodeUnknownEffect(OrchestrationBootstrapSnapshot);
const decodeShellSnapshotValue = Schema.decodeUnknownEffect(OrchestrationShellSnapshot);

function buildLatestTurnByThread(
  rows: ReadonlyArray<typeof ProjectionLatestTurnDbRowSchema.Type>,
): Map<string, OrchestrationLatestTurn> {
  const latestTurnByThread = new Map<string, OrchestrationLatestTurn>();
  for (const row of rows) {
    if (latestTurnByThread.has(row.threadId)) {
      continue;
    }
    latestTurnByThread.set(row.threadId, {
      turnId: row.turnId,
      state:
        row.state === "error"
          ? "error"
          : row.state === "interrupted"
            ? "interrupted"
            : row.state === "completed"
              ? "completed"
              : "running",
      requestedAt: row.requestedAt,
      startedAt: row.startedAt,
      completedAt: row.completedAt,
      assistantMessageId: row.assistantMessageId,
      ...(row.sourceProposedPlanThreadId !== null && row.sourceProposedPlanId !== null
        ? {
            sourceProposedPlan: {
              threadId: row.sourceProposedPlanThreadId,
              planId: row.sourceProposedPlanId,
            },
          }
        : {}),
    });
  }
  return latestTurnByThread;
}

function buildSessionByThread(
  rows: ReadonlyArray<typeof ProjectionThreadSessionDbRowSchema.Type>,
): Map<string, OrchestrationSession> {
  const sessionsByThread = new Map<string, OrchestrationSession>();
  for (const row of rows) {
    sessionsByThread.set(row.threadId, {
      threadId: row.threadId,
      status: row.status,
      providerName: row.providerName,
      ...(row.providerInstanceId !== null ? { providerInstanceId: row.providerInstanceId } : {}),
      runtimeMode: row.runtimeMode,
      activeTurnId: row.activeTurnId,
      lastError: row.lastError,
      updatedAt: row.updatedAt,
    });
  }
  return sessionsByThread;
}

function decodeBootstrapSnapshot(snapshot: {
  readonly snapshotSequence: number;
  readonly projects: ReadonlyArray<OrchestrationProject>;
  readonly threads: ReadonlyArray<OrchestrationThreadShell>;
  readonly updatedAt: string;
}) {
  return decodeBootstrapSnapshotValue(snapshot).pipe(
    Effect.mapError(toPersistenceDecodeError("ProjectionSnapshotQuery.decodeBootstrapSnapshot")),
  );
}

function decodeShellSnapshot(snapshot: {
  readonly snapshotSequence: number;
  readonly projects: ReadonlyArray<OrchestrationProject>;
  readonly threads: ReadonlyArray<OrchestrationThreadShell>;
  readonly updatedAt: string;
}) {
  return decodeShellSnapshotValue(snapshot).pipe(
    Effect.mapError(toPersistenceDecodeError("ProjectionSnapshotQuery.decodeShellSnapshot")),
  );
}

const ProjectionBootstrapThreadSummaryRowSchema = Schema.Struct({
  threadId: ThreadId,
  latestUserMessageAt: Schema.NullOr(IsoDateTime),
  pendingApprovalCount: Schema.Number,
  pendingUserInputCount: Schema.Number,
  hasActionableProposedPlan: Schema.Number,
});
const WorkspaceRootLookupInput = Schema.Struct({
  workspaceRoot: Schema.String,
});
const ProjectIdLookupInput = Schema.Struct({
  projectId: ProjectId,
});
const ThreadIdLookupInput = Schema.Struct({
  threadId: ThreadId,
});
const ProjectionProjectLookupRowSchema = ProjectionProjectDbRowSchema;
const ProjectionThreadIdLookupRowSchema = Schema.Struct({
  threadId: ThreadId,
});
const ProjectionThreadCheckpointContextThreadRowSchema = Schema.Struct({
  threadId: ThreadId,
  projectId: ProjectId,
  workspaceRoot: Schema.String,
  worktreePath: Schema.NullOr(Schema.String),
});

const REQUIRED_SNAPSHOT_PROJECTORS = [
  ORCHESTRATION_PROJECTOR_NAMES.projects,
  ORCHESTRATION_PROJECTOR_NAMES.threads,
  ORCHESTRATION_PROJECTOR_NAMES.threadMessages,
  ORCHESTRATION_PROJECTOR_NAMES.threadProposedPlans,
  ORCHESTRATION_PROJECTOR_NAMES.threadActivities,
  ORCHESTRATION_PROJECTOR_NAMES.threadSessions,
  ORCHESTRATION_PROJECTOR_NAMES.checkpoints,
] as const;

function maxIso(left: string | null, right: string): string {
  if (left === null) {
    return right;
  }
  return left > right ? left : right;
}

function computeSnapshotSequence(
  stateRows: ReadonlyArray<Schema.Schema.Type<typeof ProjectionStateDbRowSchema>>,
): number {
  if (stateRows.length === 0) {
    return 0;
  }
  const sequenceByProjector = new Map(
    stateRows.map((row) => [row.projector, row.lastAppliedSequence] as const),
  );

  let minSequence = Number.POSITIVE_INFINITY;
  for (const projector of REQUIRED_SNAPSHOT_PROJECTORS) {
    const sequence = sequenceByProjector.get(projector);
    if (sequence === undefined) {
      return 0;
    }
    if (sequence < minSequence) {
      minSequence = sequence;
    }
  }

  return Number.isFinite(minSequence) ? minSequence : 0;
}

function threadVisibilityFields(row: typeof ProjectionThreadDbRowSchema.Type) {
  return {
    visibility: row.visibility ?? "normal",
    owner: row.owner ?? null,
    deleteOnSettled: row.deleteOnSettled === 1,
  };
}

function toPersistenceSqlOrDecodeError(sqlOperation: string, decodeOperation: string) {
  return (cause: unknown): ProjectionRepositoryError =>
    Schema.isSchemaError(cause)
      ? toPersistenceDecodeError(decodeOperation)(cause)
      : toPersistenceSqlError(sqlOperation)(cause);
}

export const makeProjectionSnapshotQuery = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const sourceControl = yield* SourceControl;
  const repositoryIdentityResolutionConcurrency = 4;
  const repositoryIdentityResolutionTimeout = Duration.millis(750);

  const listProjectRows = SqlSchema.findAll({
    Request: Schema.Void,
    Result: ProjectionProjectDbRowSchema,
    execute: () =>
      sql`
        SELECT
          project_id AS "projectId",
          title,
          workspace_root AS "workspaceRoot",
          default_model_selection_json AS "defaultModelSelection",
          scripts_json AS "scripts",
          COALESCE(global_script_defaults_json, '[]') AS "globalScriptDefaults",
          COALESCE(managed_processes_json, '[]') AS "managedProcesses",
          created_at AS "createdAt",
          updated_at AS "updatedAt",
          deleted_at AS "deletedAt"
        FROM projection_projects
        ORDER BY created_at ASC, project_id ASC
      `,
  });

  const listThreadRows = SqlSchema.findAll({
    Request: Schema.Void,
    Result: ProjectionThreadDbRowSchema,
    execute: () =>
      sql`
        SELECT
          thread_id AS "threadId",
          project_id AS "projectId",
          title,
          model_selection_json AS "modelSelection",
          runtime_mode AS "runtimeMode",
          interaction_mode AS "interactionMode",
          mcp_server_ids_json AS "mcpServerIds",
          branch,
          worktree_path AS "worktreePath",
          visibility,
          owner_json AS "owner",
          delete_on_settled AS "deleteOnSettled",
          latest_turn_id AS "latestTurnId",
          created_at AS "createdAt",
          updated_at AS "updatedAt",
          archived_at AS "archivedAt",
          deleted_at AS "deletedAt"
        FROM projection_threads
        ORDER BY created_at ASC, thread_id ASC
      `,
  });

  const listThreadMessageRows = SqlSchema.findAll({
    Request: Schema.Void,
    Result: ProjectionThreadMessageDbRowSchema,
    execute: () =>
      sql`
        SELECT
          "messageId",
          "threadId",
          "turnId",
          role,
          text,
          attachments,
          "isStreaming",
          "createdAt",
          "updatedAt"
        FROM (
          SELECT
            message_id AS "messageId",
            thread_id AS "threadId",
            turn_id AS "turnId",
            role,
            text,
            attachments_json AS attachments,
            is_streaming AS "isStreaming",
            created_at AS "createdAt",
            updated_at AS "updatedAt",
            ROW_NUMBER() OVER (
              PARTITION BY thread_id
              ORDER BY created_at DESC, message_id DESC
            ) AS "recencyRank",
            SUM(COALESCE(LENGTH(text), 0) + COALESCE(LENGTH(attachments_json), 0)) OVER (
              PARTITION BY thread_id
              ORDER BY created_at DESC, message_id DESC
              ROWS UNBOUNDED PRECEDING
            ) AS "recencyPayloadBytes"
          FROM projection_thread_messages
        )
        WHERE
          "recencyRank" <= ${THREAD_MESSAGE_READ_MODEL_LIMIT}
          AND (
            "recencyRank" = 1
            OR "recencyPayloadBytes" <= ${THREAD_MESSAGE_READ_MODEL_PAYLOAD_BUDGET_BYTES}
          )
        ORDER BY "threadId" ASC, "createdAt" ASC, "messageId" ASC
      `,
  });

  const listThreadProposedPlanRows = SqlSchema.findAll({
    Request: Schema.Void,
    Result: ProjectionThreadProposedPlanDbRowSchema,
    execute: () =>
      sql`
        SELECT
          "planId",
          "threadId",
          "turnId",
          "planMarkdown",
          "implementedAt",
          "implementationThreadId",
          "createdAt",
          "updatedAt"
        FROM (
          SELECT
            plan_id AS "planId",
            thread_id AS "threadId",
            turn_id AS "turnId",
            plan_markdown AS "planMarkdown",
            implemented_at AS "implementedAt",
            implementation_thread_id AS "implementationThreadId",
            created_at AS "createdAt",
            updated_at AS "updatedAt",
            ROW_NUMBER() OVER (
              PARTITION BY thread_id
              ORDER BY created_at DESC, plan_id DESC
            ) AS "recencyRank",
            SUM(COALESCE(LENGTH(plan_markdown), 0)) OVER (
              PARTITION BY thread_id
              ORDER BY created_at DESC, plan_id DESC
              ROWS UNBOUNDED PRECEDING
            ) AS "recencyPayloadBytes"
          FROM projection_thread_proposed_plans
        )
        WHERE
          "recencyRank" <= ${THREAD_PROPOSED_PLAN_READ_MODEL_LIMIT}
          AND (
            "recencyRank" = 1
            OR "recencyPayloadBytes" <= ${THREAD_PROPOSED_PLAN_READ_MODEL_PAYLOAD_BUDGET_BYTES}
          )
        ORDER BY "threadId" ASC, "createdAt" ASC, "planId" ASC
      `,
  });

  const listThreadActivityRows = SqlSchema.findAll({
    Request: Schema.Void,
    Result: ProjectionThreadActivityDbRowSchema,
    execute: () =>
      sql`
        SELECT
          "activityId",
          "threadId",
          "turnId",
          tone,
          kind,
          summary,
          payload,
          sequence,
          "createdAt"
        FROM (
          SELECT
            activity_id AS "activityId",
            thread_id AS "threadId",
            turn_id AS "turnId",
            tone,
            kind,
            summary,
            payload_json AS payload,
            sequence,
            created_at AS "createdAt",
            ROW_NUMBER() OVER (
              PARTITION BY thread_id
              ORDER BY
                CASE WHEN sequence IS NULL THEN 1 ELSE 0 END ASC,
                sequence DESC,
                created_at DESC,
                activity_id DESC
            ) AS "recencyRank",
            SUM(LENGTH(payload_json)) OVER (
              PARTITION BY thread_id
              ORDER BY
                CASE WHEN sequence IS NULL THEN 1 ELSE 0 END ASC,
                sequence DESC,
                created_at DESC,
                activity_id DESC
              ROWS UNBOUNDED PRECEDING
            ) AS "recencyPayloadBytes"
          FROM projection_thread_activities
        )
        WHERE
          "recencyRank" <= ${THREAD_ACTIVITY_READ_MODEL_LIMIT}
          AND (
            "recencyRank" = 1
            OR "recencyPayloadBytes" <= ${THREAD_ACTIVITY_READ_MODEL_PAYLOAD_BUDGET_BYTES}
          )
        ORDER BY
          "threadId" ASC,
          CASE WHEN sequence IS NULL THEN 0 ELSE 1 END ASC,
          sequence ASC,
          "createdAt" ASC,
          "activityId" ASC
      `,
  });

  const listThreadSessionRows = SqlSchema.findAll({
    Request: Schema.Void,
    Result: ProjectionThreadSessionDbRowSchema,
    execute: () =>
      sql`
        SELECT
          thread_id AS "threadId",
          status,
          provider_name AS "providerName",
          provider_instance_id AS "providerInstanceId",
          provider_session_id AS "providerSessionId",
          provider_thread_id AS "providerThreadId",
          runtime_mode AS "runtimeMode",
          active_turn_id AS "activeTurnId",
          last_error AS "lastError",
          updated_at AS "updatedAt"
        FROM projection_thread_sessions
        ORDER BY thread_id ASC
      `,
  });

  const listCheckpointRows = SqlSchema.findAll({
    Request: Schema.Void,
    Result: ProjectionCheckpointDbRowSchema,
    execute: () =>
      sql`
        SELECT
          thread_id AS "threadId",
          turn_id AS "turnId",
          checkpoint_turn_count AS "checkpointTurnCount",
          checkpoint_ref AS "checkpointRef",
          checkpoint_status AS "status",
          checkpoint_files_json AS "files",
          assistant_message_id AS "assistantMessageId",
          completed_at AS "completedAt"
        FROM projection_turns
        WHERE checkpoint_turn_count IS NOT NULL
        ORDER BY thread_id ASC, checkpoint_turn_count ASC
      `,
  });

  const listLatestTurnRows = SqlSchema.findAll({
    Request: Schema.Void,
    Result: ProjectionLatestTurnDbRowSchema,
    execute: () =>
      sql`
        SELECT
          thread_id AS "threadId",
          turn_id AS "turnId",
          state,
          requested_at AS "requestedAt",
          started_at AS "startedAt",
          completed_at AS "completedAt",
          assistant_message_id AS "assistantMessageId",
          source_proposed_plan_thread_id AS "sourceProposedPlanThreadId",
          source_proposed_plan_id AS "sourceProposedPlanId"
        FROM projection_turns
        WHERE turn_id IS NOT NULL
        ORDER BY thread_id ASC, requested_at DESC, turn_id DESC
      `,
  });

  const listProjectionStateRows = SqlSchema.findAll({
    Request: Schema.Void,
    Result: ProjectionStateDbRowSchema,
    execute: () =>
      sql`
        SELECT
          projector,
          last_applied_sequence AS "lastAppliedSequence",
          updated_at AS "updatedAt"
        FROM projection_state
      `,
  });

  const listBootstrapThreadSummaryRows = SqlSchema.findAll({
    Request: Schema.Void,
    Result: ProjectionBootstrapThreadSummaryRowSchema,
    execute: () =>
      sql`
        SELECT
          threads.thread_id AS "threadId",
          (
            SELECT MAX(messages.created_at)
            FROM projection_thread_messages AS messages
            WHERE messages.thread_id = threads.thread_id
              AND messages.role = 'user'
          ) AS "latestUserMessageAt",
          (
            SELECT COUNT(*)
            FROM projection_pending_approvals AS pending
            WHERE pending.thread_id = threads.thread_id
              AND pending.status = 'pending'
          ) AS "pendingApprovalCount",
          (
            SELECT COUNT(*)
            FROM (
              SELECT json_extract(activities.payload_json, '$.requestId') AS request_id
              FROM projection_thread_activities AS activities
              WHERE activities.thread_id = threads.thread_id
                AND activities.kind = 'user-input.requested'
                AND json_extract(activities.payload_json, '$.requestId') IS NOT NULL
              EXCEPT
              SELECT json_extract(activities.payload_json, '$.requestId') AS request_id
              FROM projection_thread_activities AS activities
              WHERE activities.thread_id = threads.thread_id
                AND activities.kind = 'user-input.resolved'
                AND json_extract(activities.payload_json, '$.requestId') IS NOT NULL
            )
          ) AS "pendingUserInputCount",
          (
            SELECT COUNT(*)
            FROM projection_thread_proposed_plans AS plans
            WHERE plans.thread_id = threads.thread_id
              AND plans.implemented_at IS NULL
          ) AS "hasActionableProposedPlan"
        FROM projection_threads AS threads
        ORDER BY threads.created_at ASC, threads.thread_id ASC
      `,
  });

  const getThreadRowById = SqlSchema.findOneOption({
    Request: ThreadIdLookupInput,
    Result: ProjectionThreadDbRowSchema,
    execute: ({ threadId }) =>
      sql`
        SELECT
          thread_id AS "threadId",
          project_id AS "projectId",
          title,
          model_selection_json AS "modelSelection",
          runtime_mode AS "runtimeMode",
          interaction_mode AS "interactionMode",
          mcp_server_ids_json AS "mcpServerIds",
          branch,
          worktree_path AS "worktreePath",
          visibility,
          owner_json AS "owner",
          delete_on_settled AS "deleteOnSettled",
          latest_turn_id AS "latestTurnId",
          created_at AS "createdAt",
          updated_at AS "updatedAt",
          archived_at AS "archivedAt",
          deleted_at AS "deletedAt"
        FROM projection_threads
        WHERE thread_id = ${threadId}
          AND deleted_at IS NULL
        LIMIT 1
      `,
  });

  const getProjectRowById = SqlSchema.findOneOption({
    Request: ProjectIdLookupInput,
    Result: ProjectionProjectLookupRowSchema,
    execute: ({ projectId }) =>
      sql`
        SELECT
          project_id AS "projectId",
          title,
          workspace_root AS "workspaceRoot",
          default_model_selection_json AS "defaultModelSelection",
          scripts_json AS "scripts",
          COALESCE(global_script_defaults_json, '[]') AS "globalScriptDefaults",
          COALESCE(managed_processes_json, '[]') AS "managedProcesses",
          created_at AS "createdAt",
          updated_at AS "updatedAt",
          deleted_at AS "deletedAt"
        FROM projection_projects
        WHERE project_id = ${projectId}
          AND deleted_at IS NULL
        LIMIT 1
      `,
  });

  const getBootstrapThreadSummaryRowByThread = SqlSchema.findOneOption({
    Request: ThreadIdLookupInput,
    Result: ProjectionBootstrapThreadSummaryRowSchema,
    execute: ({ threadId }) =>
      sql`
        SELECT
          threads.thread_id AS "threadId",
          (
            SELECT MAX(messages.created_at)
            FROM projection_thread_messages AS messages
            WHERE messages.thread_id = threads.thread_id
              AND messages.role = 'user'
          ) AS "latestUserMessageAt",
          (
            SELECT COUNT(*)
            FROM projection_pending_approvals AS pending
            WHERE pending.thread_id = threads.thread_id
              AND pending.status = 'pending'
          ) AS "pendingApprovalCount",
          (
            SELECT COUNT(*)
            FROM (
              SELECT json_extract(activities.payload_json, '$.requestId') AS request_id
              FROM projection_thread_activities AS activities
              WHERE activities.thread_id = threads.thread_id
                AND activities.kind = 'user-input.requested'
                AND json_extract(activities.payload_json, '$.requestId') IS NOT NULL
              EXCEPT
              SELECT json_extract(activities.payload_json, '$.requestId') AS request_id
              FROM projection_thread_activities AS activities
              WHERE activities.thread_id = threads.thread_id
                AND activities.kind = 'user-input.resolved'
                AND json_extract(activities.payload_json, '$.requestId') IS NOT NULL
            )
          ) AS "pendingUserInputCount",
          (
            SELECT COUNT(*)
            FROM projection_thread_proposed_plans AS plans
            WHERE plans.thread_id = threads.thread_id
              AND plans.implemented_at IS NULL
          ) AS "hasActionableProposedPlan"
        FROM projection_threads AS threads
        WHERE threads.thread_id = ${threadId}
        LIMIT 1
      `,
  });

  const listThreadMessageRowsByThread = SqlSchema.findAll({
    Request: ThreadIdLookupInput,
    Result: ProjectionThreadMessageDbRowSchema,
    execute: ({ threadId }) =>
      sql`
        SELECT
          message_id AS "messageId",
          thread_id AS "threadId",
          turn_id AS "turnId",
          role,
          text,
          attachments_json AS "attachments",
          is_streaming AS "isStreaming",
          created_at AS "createdAt",
          updated_at AS "updatedAt"
        FROM projection_thread_messages
        WHERE thread_id = ${threadId}
        ORDER BY created_at ASC, message_id ASC
      `,
  });

  const listThreadProposedPlanRowsByThread = SqlSchema.findAll({
    Request: ThreadIdLookupInput,
    Result: ProjectionThreadProposedPlanDbRowSchema,
    execute: ({ threadId }) =>
      sql`
        SELECT
          plan_id AS "planId",
          thread_id AS "threadId",
          turn_id AS "turnId",
          plan_markdown AS "planMarkdown",
          implemented_at AS "implementedAt",
          implementation_thread_id AS "implementationThreadId",
          created_at AS "createdAt",
          updated_at AS "updatedAt"
        FROM projection_thread_proposed_plans
        WHERE thread_id = ${threadId}
        ORDER BY created_at ASC, plan_id ASC
      `,
  });

  const listThreadActivityRowsByThread = SqlSchema.findAll({
    Request: ThreadIdLookupInput,
    Result: ProjectionThreadActivityDbRowSchema,
    execute: ({ threadId }) =>
      sql`
        SELECT
          activity_id AS "activityId",
          thread_id AS "threadId",
          turn_id AS "turnId",
          tone,
          kind,
          summary,
          payload_json AS "payload",
          sequence,
          created_at AS "createdAt"
        FROM projection_thread_activities
        WHERE thread_id = ${threadId}
        ORDER BY
          CASE WHEN sequence IS NULL THEN 0 ELSE 1 END ASC,
          sequence ASC,
          created_at ASC,
          activity_id ASC
      `,
  });

  const getThreadSessionRowByThread = SqlSchema.findOneOption({
    Request: ThreadIdLookupInput,
    Result: ProjectionThreadSessionDbRowSchema,
    execute: ({ threadId }) =>
      sql`
        SELECT
          thread_id AS "threadId",
          status,
          provider_name AS "providerName",
          provider_instance_id AS "providerInstanceId",
          provider_session_id AS "providerSessionId",
          provider_thread_id AS "providerThreadId",
          runtime_mode AS "runtimeMode",
          active_turn_id AS "activeTurnId",
          last_error AS "lastError",
          updated_at AS "updatedAt"
        FROM projection_thread_sessions
        WHERE thread_id = ${threadId}
        LIMIT 1
      `,
  });

  const listLatestTurnRowsByThread = SqlSchema.findAll({
    Request: ThreadIdLookupInput,
    Result: ProjectionLatestTurnDbRowSchema,
    execute: ({ threadId }) =>
      sql`
        SELECT
          thread_id AS "threadId",
          turn_id AS "turnId",
          state,
          requested_at AS "requestedAt",
          started_at AS "startedAt",
          completed_at AS "completedAt",
          assistant_message_id AS "assistantMessageId",
          source_proposed_plan_thread_id AS "sourceProposedPlanThreadId",
          source_proposed_plan_id AS "sourceProposedPlanId"
        FROM projection_turns
        WHERE turn_id IS NOT NULL
          AND thread_id = ${threadId}
        ORDER BY requested_at DESC, turn_id DESC
      `,
  });

  const readProjectionCounts = SqlSchema.findOne({
    Request: Schema.Void,
    Result: ProjectionCountsRowSchema,
    execute: () =>
      sql`
        SELECT
          (SELECT COUNT(*) FROM projection_projects) AS "projectCount",
          (SELECT COUNT(*) FROM projection_threads) AS "threadCount"
      `,
  });

  const buildThreadMessagesByThread = (
    rows: ReadonlyArray<typeof ProjectionThreadMessageDbRowSchema.Type>,
  ): {
    readonly byThread: Map<string, Array<OrchestrationMessage>>;
    readonly updatedAt: string | null;
  } => {
    const byThread = new Map<string, Array<OrchestrationMessage>>();
    let updatedAt: string | null = null;
    for (const row of rows) {
      updatedAt = maxIso(updatedAt, row.updatedAt);
      const threadMessages = byThread.get(row.threadId) ?? [];
      threadMessages.push({
        id: row.messageId,
        role: row.role,
        text: row.text,
        ...(row.attachments !== null ? { attachments: row.attachments } : {}),
        turnId: row.turnId,
        streaming: row.isStreaming === 1,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
      });
      byThread.set(row.threadId, threadMessages);
    }
    return { byThread, updatedAt };
  };

  const buildThreadProposedPlansByThread = (
    rows: ReadonlyArray<typeof ProjectionThreadProposedPlanDbRowSchema.Type>,
  ): {
    readonly byThread: Map<string, Array<OrchestrationProposedPlan>>;
    readonly updatedAt: string | null;
  } => {
    const byThread = new Map<string, Array<OrchestrationProposedPlan>>();
    let updatedAt: string | null = null;
    for (const row of rows) {
      updatedAt = maxIso(updatedAt, row.updatedAt);
      const threadProposedPlans = byThread.get(row.threadId) ?? [];
      threadProposedPlans.push({
        id: row.planId,
        turnId: row.turnId,
        planMarkdown: row.planMarkdown,
        implementedAt: row.implementedAt,
        implementationThreadId: row.implementationThreadId,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
      });
      byThread.set(row.threadId, threadProposedPlans);
    }
    return { byThread, updatedAt };
  };

  const buildThreadActivitiesByThread = (
    rows: ReadonlyArray<typeof ProjectionThreadActivityDbRowSchema.Type>,
  ): {
    readonly byThread: Map<string, Array<OrchestrationThreadActivity>>;
    readonly updatedAt: string | null;
  } => {
    const byThread = new Map<string, Array<OrchestrationThreadActivity>>();
    let updatedAt: string | null = null;
    for (const row of rows) {
      updatedAt = maxIso(updatedAt, row.createdAt);
      const threadActivities = byThread.get(row.threadId) ?? [];
      threadActivities.push({
        id: row.activityId,
        tone: row.tone,
        kind: row.kind,
        summary: row.summary,
        payload: row.payload,
        turnId: row.turnId,
        ...(row.sequence !== null ? { sequence: row.sequence } : {}),
        createdAt: row.createdAt,
      });
      byThread.set(row.threadId, threadActivities);
    }
    return { byThread, updatedAt };
  };

  const buildCheckpointsByThread = (
    rows: ReadonlyArray<typeof ProjectionCheckpointDbRowSchema.Type>,
  ): {
    readonly byThread: Map<string, Array<OrchestrationCheckpointSummary>>;
    readonly updatedAt: string | null;
  } => {
    const byThread = new Map<string, Array<OrchestrationCheckpointSummary>>();
    let updatedAt: string | null = null;
    for (const row of rows) {
      updatedAt = maxIso(updatedAt, row.completedAt);
      const threadCheckpoints = byThread.get(row.threadId) ?? [];
      threadCheckpoints.push({
        turnId: row.turnId,
        checkpointTurnCount: row.checkpointTurnCount,
        checkpointRef: row.checkpointRef,
        status: row.status,
        files: row.files,
        assistantMessageId: row.assistantMessageId,
        completedAt: row.completedAt,
      });
      byThread.set(row.threadId, threadCheckpoints);
    }
    return { byThread, updatedAt };
  };

  const getActiveProjectRowByWorkspaceRoot = SqlSchema.findOneOption({
    Request: WorkspaceRootLookupInput,
    Result: ProjectionProjectLookupRowSchema,
    execute: ({ workspaceRoot }) =>
      sql`
        SELECT
          project_id AS "projectId",
          title,
          workspace_root AS "workspaceRoot",
          default_model_selection_json AS "defaultModelSelection",
          scripts_json AS "scripts",
          COALESCE(global_script_defaults_json, '[]') AS "globalScriptDefaults",
          COALESCE(managed_processes_json, '[]') AS "managedProcesses",
          created_at AS "createdAt",
          updated_at AS "updatedAt",
          deleted_at AS "deletedAt"
        FROM projection_projects
        WHERE workspace_root = ${workspaceRoot}
          AND deleted_at IS NULL
        ORDER BY created_at ASC, project_id ASC
        LIMIT 1
      `,
  });

  const getFirstActiveThreadIdByProject = SqlSchema.findOneOption({
    Request: ProjectIdLookupInput,
    Result: ProjectionThreadIdLookupRowSchema,
    execute: ({ projectId }) =>
      sql`
        SELECT
          thread_id AS "threadId"
        FROM projection_threads
        WHERE project_id = ${projectId}
          AND deleted_at IS NULL
          AND visibility = 'normal'
        ORDER BY created_at ASC, thread_id ASC
        LIMIT 1
      `,
  });

  const getThreadCheckpointContextThreadRow = SqlSchema.findOneOption({
    Request: ThreadIdLookupInput,
    Result: ProjectionThreadCheckpointContextThreadRowSchema,
    execute: ({ threadId }) =>
      sql`
        SELECT
          threads.thread_id AS "threadId",
          threads.project_id AS "projectId",
          projects.workspace_root AS "workspaceRoot",
          threads.worktree_path AS "worktreePath"
        FROM projection_threads AS threads
        INNER JOIN projection_projects AS projects
          ON projects.project_id = threads.project_id
        WHERE threads.thread_id = ${threadId}
          AND threads.deleted_at IS NULL
        LIMIT 1
      `,
  });

  const listCheckpointRowsByThread = SqlSchema.findAll({
    Request: ThreadIdLookupInput,
    Result: ProjectionCheckpointDbRowSchema,
    execute: ({ threadId }) =>
      sql`
        SELECT
          thread_id AS "threadId",
          turn_id AS "turnId",
          checkpoint_turn_count AS "checkpointTurnCount",
          checkpoint_ref AS "checkpointRef",
          checkpoint_status AS "status",
          checkpoint_files_json AS "files",
          assistant_message_id AS "assistantMessageId",
          completed_at AS "completedAt"
        FROM projection_turns
        WHERE thread_id = ${threadId}
          AND checkpoint_turn_count IS NOT NULL
        ORDER BY checkpoint_turn_count ASC
      `,
  });

  const buildProjects = Effect.fn("ProjectionSnapshotQuery.buildProjects")(function* (
    projectRows: ReadonlyArray<typeof ProjectionProjectDbRowSchema.Type>,
  ) {
    const repositoryIdentities = new Map(
      yield* Effect.forEach(
        projectRows.filter((row) => row.deletedAt === null),
        (row) =>
          sourceControl.resolveRepositoryIdentity(row.workspaceRoot).pipe(
            Effect.timeoutOption(repositoryIdentityResolutionTimeout),
            Effect.map(Option.getOrNull),
            Effect.map((identity) => [row.projectId, identity] as const),
          ),
        { concurrency: repositoryIdentityResolutionConcurrency },
      ),
    );

    return projectRows.map((row) => ({
      id: row.projectId,
      title: row.title,
      workspaceRoot: row.workspaceRoot,
      repositoryIdentity: repositoryIdentities.get(row.projectId) ?? null,
      defaultModelSelection: row.defaultModelSelection,
      scripts: row.scripts,
      globalScriptDefaults: row.globalScriptDefaults,
      managedProcesses: row.managedProcesses,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      deletedAt: row.deletedAt,
    })) satisfies ReadonlyArray<OrchestrationProject>;
  });

  const decodeSnapshot = (snapshot: {
    readonly snapshotSequence: number;
    readonly projects: ReadonlyArray<OrchestrationProject>;
    readonly threads: ReadonlyArray<OrchestrationThread>;
    readonly updatedAt: string;
  }) =>
    decodeReadModel(snapshot).pipe(
      Effect.mapError(toPersistenceDecodeError("ProjectionSnapshotQuery.decodeSnapshot")),
    );

  const getBootstrapSnapshot: ProjectionSnapshotQueryShape["getBootstrapSnapshot"] = () =>
    sql
      .withTransaction(
        Effect.all([
          listProjectRows(undefined).pipe(
            Effect.mapError(
              toPersistenceSqlOrDecodeError(
                "ProjectionSnapshotQuery.getBootstrapSnapshot:listProjects:query",
                "ProjectionSnapshotQuery.getBootstrapSnapshot:listProjects:decodeRows",
              ),
            ),
          ),
          listThreadRows(undefined).pipe(
            Effect.mapError(
              toPersistenceSqlOrDecodeError(
                "ProjectionSnapshotQuery.getBootstrapSnapshot:listThreads:query",
                "ProjectionSnapshotQuery.getBootstrapSnapshot:listThreads:decodeRows",
              ),
            ),
          ),
          listThreadSessionRows(undefined).pipe(
            Effect.mapError(
              toPersistenceSqlOrDecodeError(
                "ProjectionSnapshotQuery.getBootstrapSnapshot:listThreadSessions:query",
                "ProjectionSnapshotQuery.getBootstrapSnapshot:listThreadSessions:decodeRows",
              ),
            ),
          ),
          listLatestTurnRows(undefined).pipe(
            Effect.mapError(
              toPersistenceSqlOrDecodeError(
                "ProjectionSnapshotQuery.getBootstrapSnapshot:listLatestTurns:query",
                "ProjectionSnapshotQuery.getBootstrapSnapshot:listLatestTurns:decodeRows",
              ),
            ),
          ),
          listBootstrapThreadSummaryRows(undefined).pipe(
            Effect.mapError(
              toPersistenceSqlOrDecodeError(
                "ProjectionSnapshotQuery.getBootstrapSnapshot:listBootstrapThreadSummaryRows:query",
                "ProjectionSnapshotQuery.getBootstrapSnapshot:listBootstrapThreadSummaryRows:decodeRows",
              ),
            ),
          ),
          listProjectionStateRows(undefined).pipe(
            Effect.mapError(
              toPersistenceSqlOrDecodeError(
                "ProjectionSnapshotQuery.getBootstrapSnapshot:listProjectionState:query",
                "ProjectionSnapshotQuery.getBootstrapSnapshot:listProjectionState:decodeRows",
              ),
            ),
          ),
        ]),
      )
      .pipe(
        Effect.flatMap(
          ([
            projectRows,
            threadRows,
            sessionRows,
            latestTurnRows,
            bootstrapThreadSummaryRows,
            stateRows,
          ]) =>
            Effect.gen(function* () {
              let updatedAt: string | null = null;
              for (const row of projectRows) {
                updatedAt = maxIso(updatedAt, row.updatedAt);
              }
              for (const row of threadRows) {
                updatedAt = maxIso(updatedAt, row.updatedAt);
              }
              for (const row of sessionRows) {
                updatedAt = maxIso(updatedAt, row.updatedAt);
              }
              for (const row of latestTurnRows) {
                updatedAt = maxIso(updatedAt, row.requestedAt);
                if (row.startedAt !== null) {
                  updatedAt = maxIso(updatedAt, row.startedAt);
                }
                if (row.completedAt !== null) {
                  updatedAt = maxIso(updatedAt, row.completedAt);
                }
              }
              for (const row of stateRows) {
                updatedAt = maxIso(updatedAt, row.updatedAt);
              }
              for (const row of bootstrapThreadSummaryRows) {
                if (row.latestUserMessageAt !== null) {
                  updatedAt = maxIso(updatedAt, row.latestUserMessageAt);
                }
              }

              const [projects, latestTurnByThread, sessionsByThread] = yield* Effect.all([
                buildProjects(projectRows),
                Effect.succeed(buildLatestTurnByThread(latestTurnRows)),
                Effect.succeed(buildSessionByThread(sessionRows)),
              ]);
              const bootstrapSummaryByThreadId = new Map(
                bootstrapThreadSummaryRows.map((row) => [row.threadId, row] as const),
              );
              const threads: ReadonlyArray<OrchestrationThreadShell> = threadRows
                .filter((row) => row.deletedAt === null && row.archivedAt === null)
                .map((row) => {
                  const summary = bootstrapSummaryByThreadId.get(row.threadId);
                  const visibilityFields = threadVisibilityFields(row);
                  return {
                    id: row.threadId,
                    projectId: row.projectId,
                    title: row.title,
                    modelSelection: row.modelSelection,
                    runtimeMode: row.runtimeMode,
                    interactionMode: row.interactionMode,
                    mcpServerIds: row.mcpServerIds,
                    branch: row.branch,
                    worktreePath: row.worktreePath,
                    visibility: visibilityFields.visibility,
                    owner: visibilityFields.owner,
                    deleteOnSettled: visibilityFields.deleteOnSettled,
                    latestTurn: latestTurnByThread.get(row.threadId) ?? null,
                    createdAt: row.createdAt,
                    updatedAt: row.updatedAt,
                    archivedAt: row.archivedAt,
                    session: sessionsByThread.get(row.threadId) ?? null,
                    latestUserMessageAt: summary?.latestUserMessageAt ?? null,
                    hasPendingApprovals: (summary?.pendingApprovalCount ?? 0) > 0,
                    hasPendingUserInput: (summary?.pendingUserInputCount ?? 0) > 0,
                    hasActionableProposedPlan: (summary?.hasActionableProposedPlan ?? 0) > 0,
                  };
                });
              return yield* decodeBootstrapSnapshot({
                snapshotSequence: computeSnapshotSequence(stateRows),
                projects,
                threads,
                updatedAt: updatedAt ?? new Date(0).toISOString(),
              });
            }),
        ),
        Effect.mapError((error) => {
          if (isPersistenceError(error)) {
            return error;
          }
          return toPersistenceSqlError("ProjectionSnapshotQuery.getBootstrapSnapshot:query")(error);
        }),
      );

  const getArchivedShellSnapshot: ProjectionSnapshotQueryShape["getArchivedShellSnapshot"] = () =>
    sql
      .withTransaction(
        Effect.all([
          listProjectRows(undefined).pipe(
            Effect.mapError(
              toPersistenceSqlOrDecodeError(
                "ProjectionSnapshotQuery.getArchivedShellSnapshot:listProjects:query",
                "ProjectionSnapshotQuery.getArchivedShellSnapshot:listProjects:decodeRows",
              ),
            ),
          ),
          listThreadRows(undefined).pipe(
            Effect.mapError(
              toPersistenceSqlOrDecodeError(
                "ProjectionSnapshotQuery.getArchivedShellSnapshot:listThreads:query",
                "ProjectionSnapshotQuery.getArchivedShellSnapshot:listThreads:decodeRows",
              ),
            ),
          ),
          listThreadSessionRows(undefined).pipe(
            Effect.mapError(
              toPersistenceSqlOrDecodeError(
                "ProjectionSnapshotQuery.getArchivedShellSnapshot:listThreadSessions:query",
                "ProjectionSnapshotQuery.getArchivedShellSnapshot:listThreadSessions:decodeRows",
              ),
            ),
          ),
          listLatestTurnRows(undefined).pipe(
            Effect.mapError(
              toPersistenceSqlOrDecodeError(
                "ProjectionSnapshotQuery.getArchivedShellSnapshot:listLatestTurns:query",
                "ProjectionSnapshotQuery.getArchivedShellSnapshot:listLatestTurns:decodeRows",
              ),
            ),
          ),
          listBootstrapThreadSummaryRows(undefined).pipe(
            Effect.mapError(
              toPersistenceSqlOrDecodeError(
                "ProjectionSnapshotQuery.getArchivedShellSnapshot:listBootstrapThreadSummaryRows:query",
                "ProjectionSnapshotQuery.getArchivedShellSnapshot:listBootstrapThreadSummaryRows:decodeRows",
              ),
            ),
          ),
          listProjectionStateRows(undefined).pipe(
            Effect.mapError(
              toPersistenceSqlOrDecodeError(
                "ProjectionSnapshotQuery.getArchivedShellSnapshot:listProjectionState:query",
                "ProjectionSnapshotQuery.getArchivedShellSnapshot:listProjectionState:decodeRows",
              ),
            ),
          ),
        ]),
      )
      .pipe(
        Effect.flatMap(
          ([
            projectRows,
            threadRows,
            sessionRows,
            latestTurnRows,
            bootstrapThreadSummaryRows,
            stateRows,
          ]) =>
            Effect.gen(function* () {
              const archivedThreadRows = threadRows.filter(
                (row) => row.deletedAt === null && row.archivedAt !== null,
              );
              const archivedThreadIds = new Set(archivedThreadRows.map((row) => row.threadId));
              const archivedProjectIds = new Set(archivedThreadRows.map((row) => row.projectId));

              let updatedAt: string | null = null;
              for (const row of projectRows) {
                if (!archivedProjectIds.has(row.projectId)) {
                  continue;
                }
                updatedAt = maxIso(updatedAt, row.updatedAt);
              }
              for (const row of archivedThreadRows) {
                updatedAt = maxIso(updatedAt, row.updatedAt);
              }
              for (const row of sessionRows) {
                if (!archivedThreadIds.has(row.threadId)) {
                  continue;
                }
                updatedAt = maxIso(updatedAt, row.updatedAt);
              }
              for (const row of latestTurnRows) {
                if (!archivedThreadIds.has(row.threadId)) {
                  continue;
                }
                updatedAt = maxIso(updatedAt, row.requestedAt);
                if (row.startedAt !== null) {
                  updatedAt = maxIso(updatedAt, row.startedAt);
                }
                if (row.completedAt !== null) {
                  updatedAt = maxIso(updatedAt, row.completedAt);
                }
              }
              for (const row of stateRows) {
                updatedAt = maxIso(updatedAt, row.updatedAt);
              }
              for (const row of bootstrapThreadSummaryRows) {
                if (row.latestUserMessageAt !== null && archivedThreadIds.has(row.threadId)) {
                  updatedAt = maxIso(updatedAt, row.latestUserMessageAt);
                }
              }

              const [projects, latestTurnByThread, sessionsByThread] = yield* Effect.all([
                buildProjects(projectRows),
                Effect.succeed(buildLatestTurnByThread(latestTurnRows)),
                Effect.succeed(buildSessionByThread(sessionRows)),
              ]);
              const bootstrapSummaryByThreadId = new Map(
                bootstrapThreadSummaryRows.map((row) => [row.threadId, row] as const),
              );

              const threads: ReadonlyArray<OrchestrationThreadShell> = archivedThreadRows.map(
                (row) => {
                  const summary = bootstrapSummaryByThreadId.get(row.threadId);
                  const visibilityFields = threadVisibilityFields(row);
                  return {
                    id: row.threadId,
                    projectId: row.projectId,
                    title: row.title,
                    modelSelection: row.modelSelection,
                    runtimeMode: row.runtimeMode,
                    interactionMode: row.interactionMode,
                    mcpServerIds: row.mcpServerIds,
                    branch: row.branch,
                    worktreePath: row.worktreePath,
                    visibility: visibilityFields.visibility,
                    owner: visibilityFields.owner,
                    deleteOnSettled: visibilityFields.deleteOnSettled,
                    latestTurn: latestTurnByThread.get(row.threadId) ?? null,
                    createdAt: row.createdAt,
                    updatedAt: row.updatedAt,
                    archivedAt: row.archivedAt,
                    session: sessionsByThread.get(row.threadId) ?? null,
                    latestUserMessageAt: summary?.latestUserMessageAt ?? null,
                    hasPendingApprovals: (summary?.pendingApprovalCount ?? 0) > 0,
                    hasPendingUserInput: (summary?.pendingUserInputCount ?? 0) > 0,
                    hasActionableProposedPlan: (summary?.hasActionableProposedPlan ?? 0) > 0,
                  };
                },
              );

              return yield* decodeShellSnapshot({
                snapshotSequence: computeSnapshotSequence(stateRows),
                projects: projects.filter((project) => archivedProjectIds.has(project.id)),
                threads,
                updatedAt: updatedAt ?? new Date(0).toISOString(),
              });
            }),
        ),
        Effect.mapError((error) => {
          if (isPersistenceError(error)) {
            return error;
          }
          return toPersistenceSqlError("ProjectionSnapshotQuery.getArchivedShellSnapshot:query")(
            error,
          );
        }),
      );

  const getSnapshot: ProjectionSnapshotQueryShape["getSnapshot"] = () =>
    sql
      .withTransaction(
        Effect.all([
          listProjectRows(undefined).pipe(
            Effect.mapError(
              toPersistenceSqlOrDecodeError(
                "ProjectionSnapshotQuery.getSnapshot:listProjects:query",
                "ProjectionSnapshotQuery.getSnapshot:listProjects:decodeRows",
              ),
            ),
          ),
          listThreadRows(undefined).pipe(
            Effect.mapError(
              toPersistenceSqlOrDecodeError(
                "ProjectionSnapshotQuery.getSnapshot:listThreads:query",
                "ProjectionSnapshotQuery.getSnapshot:listThreads:decodeRows",
              ),
            ),
          ),
          listThreadMessageRows(undefined).pipe(
            Effect.mapError(
              toPersistenceSqlOrDecodeError(
                "ProjectionSnapshotQuery.getSnapshot:listThreadMessages:query",
                "ProjectionSnapshotQuery.getSnapshot:listThreadMessages:decodeRows",
              ),
            ),
          ),
          listThreadProposedPlanRows(undefined).pipe(
            Effect.mapError(
              toPersistenceSqlOrDecodeError(
                "ProjectionSnapshotQuery.getSnapshot:listThreadProposedPlans:query",
                "ProjectionSnapshotQuery.getSnapshot:listThreadProposedPlans:decodeRows",
              ),
            ),
          ),
          listThreadActivityRows(undefined).pipe(
            Effect.mapError(
              toPersistenceSqlOrDecodeError(
                "ProjectionSnapshotQuery.getSnapshot:listThreadActivities:query",
                "ProjectionSnapshotQuery.getSnapshot:listThreadActivities:decodeRows",
              ),
            ),
          ),
          listThreadSessionRows(undefined).pipe(
            Effect.mapError(
              toPersistenceSqlOrDecodeError(
                "ProjectionSnapshotQuery.getSnapshot:listThreadSessions:query",
                "ProjectionSnapshotQuery.getSnapshot:listThreadSessions:decodeRows",
              ),
            ),
          ),
          listCheckpointRows(undefined).pipe(
            Effect.mapError(
              toPersistenceSqlOrDecodeError(
                "ProjectionSnapshotQuery.getSnapshot:listCheckpoints:query",
                "ProjectionSnapshotQuery.getSnapshot:listCheckpoints:decodeRows",
              ),
            ),
          ),
          listLatestTurnRows(undefined).pipe(
            Effect.mapError(
              toPersistenceSqlOrDecodeError(
                "ProjectionSnapshotQuery.getSnapshot:listLatestTurns:query",
                "ProjectionSnapshotQuery.getSnapshot:listLatestTurns:decodeRows",
              ),
            ),
          ),
          listProjectionStateRows(undefined).pipe(
            Effect.mapError(
              toPersistenceSqlOrDecodeError(
                "ProjectionSnapshotQuery.getSnapshot:listProjectionState:query",
                "ProjectionSnapshotQuery.getSnapshot:listProjectionState:decodeRows",
              ),
            ),
          ),
        ]),
      )
      .pipe(
        Effect.flatMap(
          ([
            projectRows,
            threadRows,
            messageRows,
            proposedPlanRows,
            activityRows,
            sessionRows,
            checkpointRows,
            latestTurnRows,
            stateRows,
          ]) =>
            Effect.gen(function* () {
              let updatedAt: string | null = null;
              for (const row of projectRows) {
                updatedAt = maxIso(updatedAt, row.updatedAt);
              }
              for (const row of threadRows) {
                updatedAt = maxIso(updatedAt, row.updatedAt);
              }
              for (const row of stateRows) {
                updatedAt = maxIso(updatedAt, row.updatedAt);
              }

              const [
                projects,
                latestTurnByThread,
                sessionsByThread,
                messagesResult,
                proposedPlansResult,
                activitiesResult,
                checkpointsResult,
              ] = yield* Effect.all([
                buildProjects(projectRows),
                Effect.succeed(buildLatestTurnByThread(latestTurnRows)),
                Effect.succeed(buildSessionByThread(sessionRows)),
                Effect.succeed(buildThreadMessagesByThread(messageRows)),
                Effect.succeed(buildThreadProposedPlansByThread(proposedPlanRows)),
                Effect.succeed(buildThreadActivitiesByThread(activityRows)),
                Effect.succeed(buildCheckpointsByThread(checkpointRows)),
              ]);

              if (messagesResult.updatedAt !== null) {
                updatedAt = maxIso(updatedAt, messagesResult.updatedAt);
              }
              if (proposedPlansResult.updatedAt !== null) {
                updatedAt = maxIso(updatedAt, proposedPlansResult.updatedAt);
              }
              if (activitiesResult.updatedAt !== null) {
                updatedAt = maxIso(updatedAt, activitiesResult.updatedAt);
              }
              if (checkpointsResult.updatedAt !== null) {
                updatedAt = maxIso(updatedAt, checkpointsResult.updatedAt);
              }
              for (const row of sessionRows) {
                updatedAt = maxIso(updatedAt, row.updatedAt);
              }
              for (const row of latestTurnRows) {
                updatedAt = maxIso(updatedAt, row.requestedAt);
                if (row.startedAt !== null) {
                  updatedAt = maxIso(updatedAt, row.startedAt);
                }
                if (row.completedAt !== null) {
                  updatedAt = maxIso(updatedAt, row.completedAt);
                }
              }

              const threads: ReadonlyArray<OrchestrationThread> = threadRows.map((row) => ({
                id: row.threadId,
                projectId: row.projectId,
                title: row.title,
                modelSelection: row.modelSelection,
                runtimeMode: row.runtimeMode,
                interactionMode: row.interactionMode,
                mcpServerIds: row.mcpServerIds,
                branch: row.branch,
                worktreePath: row.worktreePath,
                ...threadVisibilityFields(row),
                latestTurn: latestTurnByThread.get(row.threadId) ?? null,
                createdAt: row.createdAt,
                updatedAt: row.updatedAt,
                archivedAt: row.archivedAt,
                deletedAt: row.deletedAt,
                messages: messagesResult.byThread.get(row.threadId) ?? [],
                proposedPlans: proposedPlansResult.byThread.get(row.threadId) ?? [],
                activities: activitiesResult.byThread.get(row.threadId) ?? [],
                checkpoints: checkpointsResult.byThread.get(row.threadId) ?? [],
                session: sessionsByThread.get(row.threadId) ?? null,
              }));

              return yield* decodeSnapshot({
                snapshotSequence: computeSnapshotSequence(stateRows),
                projects,
                threads,
                updatedAt: updatedAt ?? new Date(0).toISOString(),
              });
            }),
        ),
        Effect.mapError((error) => {
          if (isPersistenceError(error)) {
            return error;
          }
          return toPersistenceSqlError("ProjectionSnapshotQuery.getSnapshot:query")(error);
        }),
      );

  const getThreadSnapshot: ProjectionSnapshotQueryShape["getThreadSnapshot"] = (threadId) =>
    sql
      .withTransaction(
        Effect.all([
          getThreadRowById({ threadId }).pipe(
            Effect.mapError(
              toPersistenceSqlOrDecodeError(
                "ProjectionSnapshotQuery.getThreadSnapshot:getThread:query",
                "ProjectionSnapshotQuery.getThreadSnapshot:getThread:decodeRow",
              ),
            ),
          ),
          listThreadMessageRowsByThread({ threadId }).pipe(
            Effect.mapError(
              toPersistenceSqlOrDecodeError(
                "ProjectionSnapshotQuery.getThreadSnapshot:listMessages:query",
                "ProjectionSnapshotQuery.getThreadSnapshot:listMessages:decodeRows",
              ),
            ),
          ),
          listThreadProposedPlanRowsByThread({ threadId }).pipe(
            Effect.mapError(
              toPersistenceSqlOrDecodeError(
                "ProjectionSnapshotQuery.getThreadSnapshot:listPlans:query",
                "ProjectionSnapshotQuery.getThreadSnapshot:listPlans:decodeRows",
              ),
            ),
          ),
          listThreadActivityRowsByThread({ threadId }).pipe(
            Effect.mapError(
              toPersistenceSqlOrDecodeError(
                "ProjectionSnapshotQuery.getThreadSnapshot:listActivities:query",
                "ProjectionSnapshotQuery.getThreadSnapshot:listActivities:decodeRows",
              ),
            ),
          ),
          getThreadSessionRowByThread({ threadId }).pipe(
            Effect.mapError(
              toPersistenceSqlOrDecodeError(
                "ProjectionSnapshotQuery.getThreadSnapshot:getSession:query",
                "ProjectionSnapshotQuery.getThreadSnapshot:getSession:decodeRow",
              ),
            ),
          ),
          listCheckpointRowsByThread({ threadId }).pipe(
            Effect.mapError(
              toPersistenceSqlOrDecodeError(
                "ProjectionSnapshotQuery.getThreadSnapshot:listCheckpoints:query",
                "ProjectionSnapshotQuery.getThreadSnapshot:listCheckpoints:decodeRows",
              ),
            ),
          ),
          listLatestTurnRowsByThread({ threadId }).pipe(
            Effect.mapError(
              toPersistenceSqlOrDecodeError(
                "ProjectionSnapshotQuery.getThreadSnapshot:listLatestTurns:query",
                "ProjectionSnapshotQuery.getThreadSnapshot:listLatestTurns:decodeRows",
              ),
            ),
          ),
        ]),
      )
      .pipe(
        Effect.map(
          ([
            threadRow,
            messageRows,
            proposedPlanRows,
            activityRows,
            sessionRow,
            checkpointRows,
            latestTurnRows,
          ]) => {
            if (Option.isNone(threadRow)) {
              return Option.none<OrchestrationThread>();
            }

            const latestTurnByThread = buildLatestTurnByThread(latestTurnRows);
            const messagesResult = buildThreadMessagesByThread(messageRows);
            const proposedPlansResult = buildThreadProposedPlansByThread(proposedPlanRows);
            const activitiesResult = buildThreadActivitiesByThread(activityRows);
            const checkpointsResult = buildCheckpointsByThread(checkpointRows);
            const sessionsByThread = Option.isSome(sessionRow)
              ? buildSessionByThread([sessionRow.value])
              : new Map<string, OrchestrationSession>();

            return Option.some({
              id: threadRow.value.threadId,
              projectId: threadRow.value.projectId,
              title: threadRow.value.title,
              modelSelection: threadRow.value.modelSelection,
              runtimeMode: threadRow.value.runtimeMode,
              interactionMode: threadRow.value.interactionMode,
              mcpServerIds: threadRow.value.mcpServerIds,
              branch: threadRow.value.branch,
              worktreePath: threadRow.value.worktreePath,
              ...threadVisibilityFields(threadRow.value),
              latestTurn: latestTurnByThread.get(threadId) ?? null,
              createdAt: threadRow.value.createdAt,
              updatedAt: threadRow.value.updatedAt,
              archivedAt: threadRow.value.archivedAt,
              deletedAt: threadRow.value.deletedAt,
              messages: messagesResult.byThread.get(threadId) ?? [],
              proposedPlans: proposedPlansResult.byThread.get(threadId) ?? [],
              activities: activitiesResult.byThread.get(threadId) ?? [],
              checkpoints: checkpointsResult.byThread.get(threadId) ?? [],
              session: sessionsByThread.get(threadId) ?? null,
            } satisfies OrchestrationThread);
          },
        ),
        Effect.mapError((error) => {
          if (isPersistenceError(error)) {
            return error;
          }
          return toPersistenceSqlError("ProjectionSnapshotQuery.getThreadSnapshot:query")(error);
        }),
      );

  const getCounts: ProjectionSnapshotQueryShape["getCounts"] = () =>
    readProjectionCounts(undefined).pipe(
      Effect.mapError(
        toPersistenceSqlOrDecodeError(
          "ProjectionSnapshotQuery.getCounts:query",
          "ProjectionSnapshotQuery.getCounts:decodeRow",
        ),
      ),
      Effect.map(
        (row): ProjectionSnapshotCounts => ({
          projectCount: row.projectCount,
          threadCount: row.threadCount,
        }),
      ),
    );

  const getActiveProjectByWorkspaceRoot: ProjectionSnapshotQueryShape["getActiveProjectByWorkspaceRoot"] =
    (workspaceRoot) =>
      getActiveProjectRowByWorkspaceRoot({ workspaceRoot }).pipe(
        Effect.mapError(
          toPersistenceSqlOrDecodeError(
            "ProjectionSnapshotQuery.getActiveProjectByWorkspaceRoot:query",
            "ProjectionSnapshotQuery.getActiveProjectByWorkspaceRoot:decodeRow",
          ),
        ),
        Effect.flatMap((option) =>
          Option.isNone(option)
            ? Effect.succeed(Option.none<OrchestrationProject>())
            : sourceControl.resolveRepositoryIdentity(option.value.workspaceRoot).pipe(
                Effect.map((repositoryIdentity) =>
                  Option.some({
                    id: option.value.projectId,
                    title: option.value.title,
                    workspaceRoot: option.value.workspaceRoot,
                    repositoryIdentity,
                    defaultModelSelection: option.value.defaultModelSelection,
                    scripts: option.value.scripts,
                    globalScriptDefaults: option.value.globalScriptDefaults,
                    managedProcesses: option.value.managedProcesses,
                    createdAt: option.value.createdAt,
                    updatedAt: option.value.updatedAt,
                    deletedAt: option.value.deletedAt,
                  } satisfies OrchestrationProject),
                ),
              ),
        ),
      );

  const getFirstActiveThreadIdByProjectId: ProjectionSnapshotQueryShape["getFirstActiveThreadIdByProjectId"] =
    (projectId) =>
      getFirstActiveThreadIdByProject({ projectId }).pipe(
        Effect.mapError(
          toPersistenceSqlOrDecodeError(
            "ProjectionSnapshotQuery.getFirstActiveThreadIdByProjectId:query",
            "ProjectionSnapshotQuery.getFirstActiveThreadIdByProjectId:decodeRow",
          ),
        ),
        Effect.map(Option.map((row) => row.threadId)),
      );

  const getProjectShellById: ProjectionSnapshotQueryShape["getProjectShellById"] = (projectId) =>
    getProjectRowById({ projectId }).pipe(
      Effect.mapError(
        toPersistenceSqlOrDecodeError(
          "ProjectionSnapshotQuery.getProjectShellById:query",
          "ProjectionSnapshotQuery.getProjectShellById:decodeRow",
        ),
      ),
      Effect.flatMap((option) =>
        Option.isNone(option)
          ? Effect.succeed(Option.none<OrchestrationProject>())
          : sourceControl.resolveRepositoryIdentity(option.value.workspaceRoot).pipe(
              Effect.map((repositoryIdentity) =>
                Option.some({
                  id: option.value.projectId,
                  title: option.value.title,
                  workspaceRoot: option.value.workspaceRoot,
                  repositoryIdentity,
                  defaultModelSelection: option.value.defaultModelSelection,
                  scripts: option.value.scripts,
                  globalScriptDefaults: option.value.globalScriptDefaults,
                  managedProcesses: option.value.managedProcesses,
                  createdAt: option.value.createdAt,
                  updatedAt: option.value.updatedAt,
                  deletedAt: option.value.deletedAt,
                } satisfies OrchestrationProject),
              ),
            ),
      ),
    );

  const getThreadShellById: ProjectionSnapshotQueryShape["getThreadShellById"] = (threadId) =>
    Effect.all([
      getThreadRowById({ threadId }).pipe(
        Effect.mapError(
          toPersistenceSqlOrDecodeError(
            "ProjectionSnapshotQuery.getThreadShellById:getThread:query",
            "ProjectionSnapshotQuery.getThreadShellById:getThread:decodeRow",
          ),
        ),
      ),
      getThreadSessionRowByThread({ threadId }).pipe(
        Effect.mapError(
          toPersistenceSqlOrDecodeError(
            "ProjectionSnapshotQuery.getThreadShellById:getThreadSession:query",
            "ProjectionSnapshotQuery.getThreadShellById:getThreadSession:decodeRow",
          ),
        ),
      ),
      listLatestTurnRowsByThread({ threadId }).pipe(
        Effect.mapError(
          toPersistenceSqlOrDecodeError(
            "ProjectionSnapshotQuery.getThreadShellById:listLatestTurns:query",
            "ProjectionSnapshotQuery.getThreadShellById:listLatestTurns:decodeRows",
          ),
        ),
      ),
      getBootstrapThreadSummaryRowByThread({ threadId }).pipe(
        Effect.mapError(
          toPersistenceSqlOrDecodeError(
            "ProjectionSnapshotQuery.getThreadShellById:getBootstrapThreadSummary:query",
            "ProjectionSnapshotQuery.getThreadShellById:getBootstrapThreadSummary:decodeRow",
          ),
        ),
      ),
    ]).pipe(
      Effect.map(([threadRow, sessionRow, latestTurnRows, summaryRow]) => {
        if (Option.isNone(threadRow)) {
          return Option.none<OrchestrationThreadShell>();
        }

        const latestTurn = buildLatestTurnByThread(latestTurnRows).get(threadId) ?? null;
        const session = Option.isSome(sessionRow)
          ? (buildSessionByThread([sessionRow.value]).get(threadId) ?? null)
          : null;
        const summary = Option.isSome(summaryRow) ? summaryRow.value : null;

        return Option.some({
          id: threadRow.value.threadId,
          projectId: threadRow.value.projectId,
          title: threadRow.value.title,
          modelSelection: threadRow.value.modelSelection,
          runtimeMode: threadRow.value.runtimeMode,
          interactionMode: threadRow.value.interactionMode,
          mcpServerIds: threadRow.value.mcpServerIds,
          branch: threadRow.value.branch,
          worktreePath: threadRow.value.worktreePath,
          ...threadVisibilityFields(threadRow.value),
          latestTurn,
          createdAt: threadRow.value.createdAt,
          updatedAt: threadRow.value.updatedAt,
          archivedAt: threadRow.value.archivedAt,
          session,
          latestUserMessageAt: summary?.latestUserMessageAt ?? null,
          hasPendingApprovals: (summary?.pendingApprovalCount ?? 0) > 0,
          hasPendingUserInput: (summary?.pendingUserInputCount ?? 0) > 0,
          hasActionableProposedPlan: (summary?.hasActionableProposedPlan ?? 0) > 0,
        } satisfies OrchestrationThreadShell);
      }),
    );

  const getThreadCheckpointContext: ProjectionSnapshotQueryShape["getThreadCheckpointContext"] = (
    threadId,
  ) =>
    Effect.gen(function* () {
      const threadRow = yield* getThreadCheckpointContextThreadRow({ threadId }).pipe(
        Effect.mapError(
          toPersistenceSqlOrDecodeError(
            "ProjectionSnapshotQuery.getThreadCheckpointContext:getThread:query",
            "ProjectionSnapshotQuery.getThreadCheckpointContext:getThread:decodeRow",
          ),
        ),
      );
      if (Option.isNone(threadRow)) {
        return Option.none<ProjectionThreadCheckpointContext>();
      }

      const checkpointRows = yield* listCheckpointRowsByThread({ threadId }).pipe(
        Effect.mapError(
          toPersistenceSqlOrDecodeError(
            "ProjectionSnapshotQuery.getThreadCheckpointContext:listCheckpoints:query",
            "ProjectionSnapshotQuery.getThreadCheckpointContext:listCheckpoints:decodeRows",
          ),
        ),
      );

      return Option.some({
        threadId: threadRow.value.threadId,
        projectId: threadRow.value.projectId,
        workspaceRoot: threadRow.value.workspaceRoot,
        worktreePath: threadRow.value.worktreePath,
        checkpoints: checkpointRows.map(
          (row): OrchestrationCheckpointSummary => ({
            turnId: row.turnId,
            checkpointTurnCount: row.checkpointTurnCount,
            checkpointRef: row.checkpointRef,
            status: row.status,
            files: row.files,
            assistantMessageId: row.assistantMessageId,
            completedAt: row.completedAt,
          }),
        ),
      });
    });

  return {
    getBootstrapSnapshot,
    getArchivedShellSnapshot,
    getSnapshot,
    getCounts,
    getActiveProjectByWorkspaceRoot,
    getFirstActiveThreadIdByProjectId,
    getProjectShellById,
    getThreadShellById,
    getThreadSnapshot,
    getThreadCheckpointContext,
  } satisfies ProjectionSnapshotQueryShape;
});

export const OrchestrationProjectionSnapshotQueryLive = Layer.effect(
  ProjectionSnapshotQuery,
  makeProjectionSnapshotQuery,
).pipe(Layer.provide(SourceControlWorkspaceLive));
