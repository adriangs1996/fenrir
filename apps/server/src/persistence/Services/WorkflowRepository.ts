/**
 * WorkflowRepository - Persistence for thread-scoped workflow drafts and runs.
 *
 * This is the durable source of truth for generated workflow source, run
 * snapshots, named agents, live state, task proposals, and timeline events.
 *
 * @module WorkflowRepository
 */
import {
  IsoDateTime,
  ProjectId,
  ThreadId,
  WorkflowAgentSnapshot,
  WorkflowDraft,
  WorkflowEvent,
  WorkflowEventKind,
  WorkflowInputRequestSnapshot,
  WorkflowRunId,
  WorkflowRunSnapshot,
  WorkflowRunStatus,
  WorkflowStepSnapshot,
  WorkflowTaskSnapshot,
  WorkflowId,
  WorkflowStateEntry,
} from "@fenrir/contracts";
import { Context, Option, Schema } from "effect";
import type { Effect } from "effect";

import type { ProjectionRepositoryError } from "../Errors.ts";

export const WorkflowDraftRow = WorkflowDraft;
export type WorkflowDraftRow = typeof WorkflowDraftRow.Type;

export const WorkflowRunRow = Schema.Struct({
  runId: WorkflowRunId,
  workflowId: WorkflowId,
  projectId: ProjectId,
  originThreadId: ThreadId,
  name: Schema.String,
  args: Schema.Unknown,
  sourceSnapshot: Schema.String,
  sourceHash: Schema.String,
  status: WorkflowRunStatus,
  summary: Schema.NullOr(Schema.String),
  startedAt: IsoDateTime,
  completedAt: Schema.NullOr(IsoDateTime),
  lastUpdatedAt: IsoDateTime,
});
export type WorkflowRunRow = typeof WorkflowRunRow.Type;

export const WorkflowEventAppend = Schema.Struct({
  workflowId: WorkflowId,
  runId: Schema.NullOr(WorkflowRunId),
  stepId: Schema.NullOr(WorkflowStepSnapshot.fields.stepId),
  agentId: Schema.NullOr(WorkflowAgentSnapshot.fields.agentId),
  taskId: Schema.NullOr(WorkflowTaskSnapshot.fields.taskId),
  kind: WorkflowEventKind,
  title: Schema.String,
  body: Schema.NullOr(Schema.String),
  payload: Schema.Unknown,
  createdAt: IsoDateTime,
});
export type WorkflowEventAppend = typeof WorkflowEventAppend.Type;

export const WorkflowDraftPatch = Schema.Struct({
  source: Schema.optional(Schema.String),
  sourceHash: Schema.optional(Schema.String),
  status: Schema.optional(WorkflowDraft.fields.status),
  validationStatus: Schema.optional(WorkflowDraft.fields.validationStatus),
  validationError: Schema.optional(Schema.NullOr(Schema.String)),
  archivedAt: Schema.optional(Schema.NullOr(IsoDateTime)),
  updatedAt: IsoDateTime,
});
export type WorkflowDraftPatch = typeof WorkflowDraftPatch.Type;

export const WorkflowRunPatch = Schema.Struct({
  status: Schema.optional(WorkflowRunSnapshot.fields.status),
  summary: Schema.optional(Schema.NullOr(Schema.String)),
  completedAt: Schema.optional(Schema.NullOr(IsoDateTime)),
  lastUpdatedAt: IsoDateTime,
});
export type WorkflowRunPatch = typeof WorkflowRunPatch.Type;

export interface WorkflowRepositoryShape {
  readonly insertDraft: (row: WorkflowDraftRow) => Effect.Effect<void, ProjectionRepositoryError>;
  readonly updateDraft: (
    workflowId: WorkflowId,
    patch: WorkflowDraftPatch,
  ) => Effect.Effect<WorkflowDraftRow, ProjectionRepositoryError>;
  readonly getDraft: (
    workflowId: WorkflowId,
  ) => Effect.Effect<Option.Option<WorkflowDraftRow>, ProjectionRepositoryError>;
  readonly listDraftsForThread: (input: {
    readonly projectId: ProjectId;
    readonly originThreadId: ThreadId;
  }) => Effect.Effect<ReadonlyArray<WorkflowDraftRow>, ProjectionRepositoryError>;
  readonly latestRunnableDraftForThread: (input: {
    readonly projectId: ProjectId;
    readonly originThreadId: ThreadId;
  }) => Effect.Effect<Option.Option<WorkflowDraftRow>, ProjectionRepositoryError>;

  readonly insertRun: (row: WorkflowRunRow) => Effect.Effect<void, ProjectionRepositoryError>;
  readonly updateRun: (
    runId: WorkflowRunId,
    patch: WorkflowRunPatch,
  ) => Effect.Effect<WorkflowRunSnapshot, ProjectionRepositoryError>;
  readonly getRun: (
    runId: WorkflowRunId,
  ) => Effect.Effect<Option.Option<WorkflowRunSnapshot>, ProjectionRepositoryError>;
  readonly listRunsForWorkflow: (
    workflowId: WorkflowId,
  ) => Effect.Effect<ReadonlyArray<WorkflowRunSnapshot>, ProjectionRepositoryError>;
  readonly listRunsForThread: (input: {
    readonly projectId: ProjectId;
    readonly originThreadId: ThreadId;
  }) => Effect.Effect<ReadonlyArray<WorkflowRunSnapshot>, ProjectionRepositoryError>;
  readonly listActiveRuns: () => Effect.Effect<
    ReadonlyArray<WorkflowRunSnapshot>,
    ProjectionRepositoryError
  >;

  readonly upsertStep: (
    step: WorkflowStepSnapshot,
  ) => Effect.Effect<WorkflowStepSnapshot, ProjectionRepositoryError>;
  readonly upsertAgent: (
    agent: WorkflowAgentSnapshot,
  ) => Effect.Effect<WorkflowAgentSnapshot, ProjectionRepositoryError>;
  readonly upsertTask: (
    task: WorkflowTaskSnapshot,
  ) => Effect.Effect<WorkflowTaskSnapshot, ProjectionRepositoryError>;
  readonly upsertInputRequest: (
    inputRequest: WorkflowInputRequestSnapshot,
  ) => Effect.Effect<WorkflowInputRequestSnapshot, ProjectionRepositoryError>;
  readonly upsertState: (
    entry: WorkflowStateEntry,
  ) => Effect.Effect<WorkflowStateEntry, ProjectionRepositoryError>;

  readonly appendEvent: (
    event: WorkflowEventAppend,
  ) => Effect.Effect<WorkflowEvent, ProjectionRepositoryError>;
  readonly listEventsForRun: (
    runId: WorkflowRunId,
  ) => Effect.Effect<ReadonlyArray<WorkflowEvent>, ProjectionRepositoryError>;
}

export class WorkflowRepository extends Context.Service<
  WorkflowRepository,
  WorkflowRepositoryShape
>()("fenrir/persistence/Services/WorkflowRepository") {}
