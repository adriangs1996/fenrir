import { Effect, Schema } from "effect";
import {
  IsoDateTime,
  makeEntityId,
  NonNegativeInt,
  ProjectId,
  ThreadId,
  TrimmedNonEmptyString,
} from "./baseSchemas";
import { ModelSelection, RuntimeMode } from "./orchestration";
import { McpServerId } from "./mcp";

// ─── Branded IDs ────────────────────────────────────────────────────────────

export const WorkflowId = makeEntityId("WorkflowId");
export type WorkflowId = typeof WorkflowId.Type;

export const WorkflowRunId = makeEntityId("WorkflowRunId");
export type WorkflowRunId = typeof WorkflowRunId.Type;

export const WorkflowStepId = makeEntityId("WorkflowStepId");
export type WorkflowStepId = typeof WorkflowStepId.Type;

export const WorkflowAgentId = makeEntityId("WorkflowAgentId");
export type WorkflowAgentId = typeof WorkflowAgentId.Type;

export const WorkflowTaskId = makeEntityId("WorkflowTaskId");
export type WorkflowTaskId = typeof WorkflowTaskId.Type;

export const WorkflowEventId = makeEntityId("WorkflowEventId");
export type WorkflowEventId = typeof WorkflowEventId.Type;

export const WorkflowInputRequestId = makeEntityId("WorkflowInputRequestId");
export type WorkflowInputRequestId = typeof WorkflowInputRequestId.Type;

// ─── State Enums ────────────────────────────────────────────────────────────

export const WorkflowDraftStatus = Schema.Literals(["draft", "validated", "invalid", "archived"]);
export type WorkflowDraftStatus = typeof WorkflowDraftStatus.Type;

export const WorkflowValidationStatus = Schema.Literals(["pending", "valid", "invalid"]);
export type WorkflowValidationStatus = typeof WorkflowValidationStatus.Type;

export const WorkflowRunStatus = Schema.Literals([
  "running",
  "paused",
  "completed",
  "failed",
  "cancelled",
  "interrupted",
]);
export type WorkflowRunStatus = typeof WorkflowRunStatus.Type;

export const WorkflowStepStatus = Schema.Literals([
  "pending",
  "running",
  "completed",
  "failed",
  "skipped",
]);
export type WorkflowStepStatus = typeof WorkflowStepStatus.Type;

export const WorkflowAgentStatus = Schema.Literals([
  "idle",
  "running",
  "waiting",
  "failed",
  "stopped",
]);
export type WorkflowAgentStatus = typeof WorkflowAgentStatus.Type;

export const WorkflowTaskStatus = Schema.Literals([
  "proposed",
  "accepted",
  "rejected",
  "running",
  "completed",
  "failed",
]);
export type WorkflowTaskStatus = typeof WorkflowTaskStatus.Type;

export const WorkflowTaskKind = Schema.Literals([
  "research",
  "analysis",
  "implementation",
  "other",
]);
export type WorkflowTaskKind = typeof WorkflowTaskKind.Type;

export const WorkflowInputRequestStatus = Schema.Literals(["pending", "resolved", "cancelled"]);
export type WorkflowInputRequestStatus = typeof WorkflowInputRequestStatus.Type;

export const WorkflowEventKind = Schema.Literals([
  "workflow.draft.created",
  "workflow.draft.archived",
  "workflow.source.opened",
  "workflow.source.synced",
  "workflow.validation.changed",
  "workflow.run.started",
  "workflow.run.paused",
  "workflow.run.resumed",
  "workflow.run.completed",
  "workflow.run.failed",
  "workflow.run.cancelled",
  "workflow.run.interrupted",
  "workflow.step.started",
  "workflow.step.completed",
  "workflow.step.failed",
  "workflow.step.skipped",
  "workflow.agent.created",
  "workflow.agent.message.sent",
  "workflow.agent.message.completed",
  "workflow.state.updated",
  "workflow.note.added",
  "workflow.task.proposed",
  "workflow.task.accepted",
  "workflow.task.rejected",
  "workflow.task.started",
  "workflow.task.completed",
  "workflow.task.failed",
  "workflow.input.requested",
  "workflow.input.resolved",
  "workflow.input.cancelled",
  "workflow.notification.emitted",
]);
export type WorkflowEventKind = typeof WorkflowEventKind.Type;

// ─── Snapshots ──────────────────────────────────────────────────────────────

export const WorkflowDraft = Schema.Struct({
  workflowId: WorkflowId,
  projectId: ProjectId,
  originThreadId: ThreadId,
  name: TrimmedNonEmptyString,
  description: Schema.NullOr(Schema.String),
  source: Schema.String,
  sourceHash: TrimmedNonEmptyString,
  status: WorkflowDraftStatus,
  validationStatus: WorkflowValidationStatus,
  validationError: Schema.NullOr(Schema.String),
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
  archivedAt: Schema.NullOr(IsoDateTime),
});
export type WorkflowDraft = typeof WorkflowDraft.Type;

export const WorkflowStepSnapshot = Schema.Struct({
  stepId: WorkflowStepId,
  runId: WorkflowRunId,
  stepKey: TrimmedNonEmptyString,
  status: WorkflowStepStatus,
  result: Schema.Unknown,
  error: Schema.NullOr(Schema.String),
  sequence: NonNegativeInt,
  startedAt: Schema.NullOr(IsoDateTime),
  completedAt: Schema.NullOr(IsoDateTime),
});
export type WorkflowStepSnapshot = typeof WorkflowStepSnapshot.Type;

export const WorkflowAgentSnapshot = Schema.Struct({
  agentId: WorkflowAgentId,
  runId: WorkflowRunId,
  name: TrimmedNonEmptyString,
  role: Schema.String,
  threadId: Schema.NullOr(ThreadId),
  status: WorkflowAgentStatus,
  modelSelection: Schema.optional(ModelSelection),
  runtimeMode: Schema.optional(RuntimeMode),
  mcpServerIds: Schema.Array(McpServerId).pipe(Schema.withDecodingDefault(Effect.succeed([]))),
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
});
export type WorkflowAgentSnapshot = typeof WorkflowAgentSnapshot.Type;

export const WorkflowTaskSnapshot = Schema.Struct({
  taskId: WorkflowTaskId,
  runId: WorkflowRunId,
  title: TrimmedNonEmptyString,
  reason: Schema.NullOr(Schema.String),
  kind: WorkflowTaskKind,
  assignee: Schema.NullOr(TrimmedNonEmptyString),
  prompt: Schema.String,
  status: WorkflowTaskStatus,
  createdByAgentId: Schema.NullOr(WorkflowAgentId),
  result: Schema.Unknown,
  error: Schema.NullOr(Schema.String),
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
});
export type WorkflowTaskSnapshot = typeof WorkflowTaskSnapshot.Type;

export const WorkflowInputRequestSnapshot = Schema.Struct({
  requestId: WorkflowInputRequestId,
  runId: WorkflowRunId,
  title: TrimmedNonEmptyString,
  body: Schema.NullOr(Schema.String),
  fields: Schema.Unknown,
  status: WorkflowInputRequestStatus,
  response: Schema.Unknown,
  createdAt: IsoDateTime,
  resolvedAt: Schema.NullOr(IsoDateTime),
});
export type WorkflowInputRequestSnapshot = typeof WorkflowInputRequestSnapshot.Type;

export const WorkflowEvent = Schema.Struct({
  eventId: WorkflowEventId,
  workflowId: WorkflowId,
  runId: Schema.NullOr(WorkflowRunId),
  stepId: Schema.NullOr(WorkflowStepId),
  agentId: Schema.NullOr(WorkflowAgentId),
  taskId: Schema.NullOr(WorkflowTaskId),
  kind: WorkflowEventKind,
  title: TrimmedNonEmptyString,
  body: Schema.NullOr(Schema.String),
  payload: Schema.Unknown,
  sequence: NonNegativeInt,
  createdAt: IsoDateTime,
});
export type WorkflowEvent = typeof WorkflowEvent.Type;

export const WorkflowStateEntry = Schema.Struct({
  runId: WorkflowRunId,
  scope: TrimmedNonEmptyString,
  key: TrimmedNonEmptyString,
  value: Schema.Unknown,
  updatedAt: IsoDateTime,
});
export type WorkflowStateEntry = typeof WorkflowStateEntry.Type;

export const WorkflowRunSnapshot = Schema.Struct({
  runId: WorkflowRunId,
  workflowId: WorkflowId,
  projectId: ProjectId,
  originThreadId: ThreadId,
  name: TrimmedNonEmptyString,
  args: Schema.Unknown,
  sourceHash: TrimmedNonEmptyString,
  status: WorkflowRunStatus,
  summary: Schema.NullOr(Schema.String),
  startedAt: IsoDateTime,
  completedAt: Schema.NullOr(IsoDateTime),
  lastUpdatedAt: IsoDateTime,
  steps: Schema.Array(WorkflowStepSnapshot),
  agents: Schema.Array(WorkflowAgentSnapshot),
  tasks: Schema.Array(WorkflowTaskSnapshot),
  inputRequests: Schema.Array(WorkflowInputRequestSnapshot),
  state: Schema.Array(WorkflowStateEntry),
});
export type WorkflowRunSnapshot = typeof WorkflowRunSnapshot.Type;

export const WorkflowThreadSummary = Schema.Struct({
  workflow: WorkflowDraft,
  latestRun: Schema.NullOr(WorkflowRunSnapshot),
  activeRunCount: NonNegativeInt,
  pendingInputCount: NonNegativeInt,
});
export type WorkflowThreadSummary = typeof WorkflowThreadSummary.Type;

// ─── RPC Inputs / Outputs ──────────────────────────────────────────────────

export const WorkflowCreateDraftInput = Schema.Struct({
  projectId: ProjectId,
  originThreadId: ThreadId,
  name: TrimmedNonEmptyString,
  description: Schema.optional(Schema.NullOr(Schema.String)),
  source: Schema.String,
});
export type WorkflowCreateDraftInput = typeof WorkflowCreateDraftInput.Type;

export const WorkflowCreateDraftResult = Schema.Struct({
  workflow: WorkflowDraft,
});
export type WorkflowCreateDraftResult = typeof WorkflowCreateDraftResult.Type;

export const WorkflowListThreadInput = Schema.Struct({
  projectId: ProjectId,
  originThreadId: ThreadId,
});
export type WorkflowListThreadInput = typeof WorkflowListThreadInput.Type;

export const WorkflowListThreadResult = Schema.Struct({
  workflows: Schema.Array(WorkflowThreadSummary),
  runs: Schema.Array(WorkflowRunSnapshot),
});
export type WorkflowListThreadResult = typeof WorkflowListThreadResult.Type;

export const WorkflowOpenSourceInput = Schema.Struct({
  workflowId: WorkflowId,
});
export type WorkflowOpenSourceInput = typeof WorkflowOpenSourceInput.Type;

export const WorkflowOpenSourceResult = Schema.Struct({
  workflowId: WorkflowId,
  path: TrimmedNonEmptyString,
});
export type WorkflowOpenSourceResult = typeof WorkflowOpenSourceResult.Type;

export const WorkflowSyncSourceInput = Schema.Struct({
  workflowId: WorkflowId,
  source: Schema.String,
});
export type WorkflowSyncSourceInput = typeof WorkflowSyncSourceInput.Type;

export const WorkflowSyncSourceResult = Schema.Struct({
  workflow: WorkflowDraft,
});
export type WorkflowSyncSourceResult = typeof WorkflowSyncSourceResult.Type;

export const WorkflowValidateInput = Schema.Struct({
  workflowId: WorkflowId,
});
export type WorkflowValidateInput = typeof WorkflowValidateInput.Type;

export const WorkflowValidateResult = Schema.Struct({
  workflow: WorkflowDraft,
});
export type WorkflowValidateResult = typeof WorkflowValidateResult.Type;

export const WorkflowArchiveInput = Schema.Struct({
  workflowId: WorkflowId,
});
export type WorkflowArchiveInput = typeof WorkflowArchiveInput.Type;

export const WorkflowArchiveResult = Schema.Struct({
  workflow: WorkflowDraft,
});
export type WorkflowArchiveResult = typeof WorkflowArchiveResult.Type;

export const WorkflowRunInput = Schema.Struct({
  projectId: ProjectId,
  originThreadId: ThreadId,
  workflowId: Schema.optional(WorkflowId),
  args: Schema.optional(Schema.Unknown),
});
export type WorkflowRunInput = typeof WorkflowRunInput.Type;

export const WorkflowRunResult = Schema.Struct({
  run: WorkflowRunSnapshot,
});
export type WorkflowRunResult = typeof WorkflowRunResult.Type;

export const WorkflowRunByIdInput = Schema.Struct({
  runId: WorkflowRunId,
});
export type WorkflowRunByIdInput = typeof WorkflowRunByIdInput.Type;

export const WorkflowStopInput = Schema.Struct({
  runId: WorkflowRunId,
});
export type WorkflowStopInput = typeof WorkflowStopInput.Type;

export const WorkflowRespondToInputInput = Schema.Struct({
  runId: WorkflowRunId,
  requestId: WorkflowInputRequestId,
  response: Schema.Unknown,
});
export type WorkflowRespondToInputInput = typeof WorkflowRespondToInputInput.Type;

export const WorkflowGetTimelineInput = Schema.Struct({
  runId: WorkflowRunId,
});
export type WorkflowGetTimelineInput = typeof WorkflowGetTimelineInput.Type;

export const WorkflowGetTimelineResult = Schema.Struct({
  runId: WorkflowRunId,
  events: Schema.Array(WorkflowEvent),
});
export type WorkflowGetTimelineResult = typeof WorkflowGetTimelineResult.Type;

export const WorkflowEventStreamItem = Schema.Union([
  Schema.Struct({
    type: Schema.Literal("workflow.changed"),
    workflow: WorkflowDraft,
  }),
  Schema.Struct({
    type: Schema.Literal("workflow.run.changed"),
    run: WorkflowRunSnapshot,
  }),
  Schema.Struct({
    type: Schema.Literal("workflow.event.appended"),
    event: WorkflowEvent,
  }),
]);
export type WorkflowEventStreamItem = typeof WorkflowEventStreamItem.Type;

export class WorkflowError extends Schema.TaggedErrorClass<WorkflowError>()("WorkflowError", {
  message: Schema.String,
  cause: Schema.optional(Schema.Defect),
}) {}

export class WorkflowNotFoundError extends Schema.TaggedErrorClass<WorkflowNotFoundError>()(
  "WorkflowNotFoundError",
  {
    message: Schema.String,
    workflowId: Schema.optional(WorkflowId),
    runId: Schema.optional(WorkflowRunId),
  },
) {}
