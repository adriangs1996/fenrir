import { Schema } from "effect";
import {
  IsoDateTime,
  makeEntityId,
  TrimmedNonEmptyString,
  ThreadId,
  ProjectId,
} from "./baseSchemas";
import { ModelSelection } from "./orchestration";

// ─── Branded IDs ────────────────────────────────────────────────────────────

export const PlanRunId = makeEntityId("PlanRunId");
export type PlanRunId = typeof PlanRunId.Type;

// ─── State Enums ────────────────────────────────────────────────────────────

export const PlanState = Schema.Literals([
  "blocked",
  "ready",
  "running",
  "reviewing",
  "done",
  "failed",
  "skipped",
]);
export type PlanState = typeof PlanState.Type;

export const FeatureState = Schema.Literals([
  "analyzing",
  "executing",
  "integrating",
  "completed",
  "failed",
]);
export type FeatureState = typeof FeatureState.Type;

// ─── PlanNode ───────────────────────────────────────────────────────────────

export const PlanNode = Schema.Struct({
  planId: Schema.String,
  filename: TrimmedNonEmptyString,
  state: PlanState,
  dependsOn: Schema.Array(Schema.String),
  maxRetries: Schema.Number,
  retriesUsed: Schema.Number,
  executorThreadId: Schema.NullOr(ThreadId),
  reviewerThreadId: Schema.NullOr(ThreadId),
  error: Schema.NullOr(Schema.String),
  startedAt: Schema.NullOr(IsoDateTime),
  completedAt: Schema.NullOr(IsoDateTime),
});
export type PlanNode = typeof PlanNode.Type;

// ─── PlanRunSnapshot ────────────────────────────────────────────────────────

export const PlanRunSnapshot = Schema.Struct({
  runId: PlanRunId,
  featureName: TrimmedNonEmptyString,
  projectId: ProjectId,
  branch: TrimmedNonEmptyString,
  state: FeatureState,
  plans: Schema.Array(PlanNode),
  analyzerThreadId: Schema.NullOr(ThreadId),
  integrationThreadId: Schema.NullOr(ThreadId),
  startedAt: IsoDateTime,
  completedAt: Schema.NullOr(IsoDateTime),
  summary: Schema.NullOr(Schema.String),
});
export type PlanRunSnapshot = typeof PlanRunSnapshot.Type;

// ─── RPC Input / Output Schemas ─────────────────────────────────────────────

export const PlanRunnerStartInput = Schema.Struct({
  projectId: ProjectId,
  featureName: TrimmedNonEmptyString,
  modelSelection: Schema.optional(ModelSelection),
});
export type PlanRunnerStartInput = typeof PlanRunnerStartInput.Type;

export const PlanRunnerStartResult = Schema.Struct({
  runId: PlanRunId,
  branch: TrimmedNonEmptyString,
});
export type PlanRunnerStartResult = typeof PlanRunnerStartResult.Type;

export const PlanRunnerGetStatusInput = Schema.Struct({ runId: PlanRunId });
export type PlanRunnerGetStatusInput = typeof PlanRunnerGetStatusInput.Type;

export const PlanRunnerCancelInput = Schema.Struct({ runId: PlanRunId });
export type PlanRunnerCancelInput = typeof PlanRunnerCancelInput.Type;

// ─── List Features ───────────────────────────────────────────

export const PlanRunnerListFeaturesInput = Schema.Struct({
  projectId: ProjectId,
});

export const FeatureSummary = Schema.Struct({
  featureName: TrimmedNonEmptyString,
  planCount: Schema.Number,
  hasActiveRun: Schema.Boolean,
  activeRunId: Schema.NullOr(PlanRunId),
});

export const PlanRunnerListFeaturesResult = Schema.Struct({
  features: Schema.Array(FeatureSummary),
});

// ─── Get Feature Plans ───────────────────────────────────────

export const PlanRunnerGetFeaturePlansInput = Schema.Struct({
  projectId: ProjectId,
  featureName: TrimmedNonEmptyString,
});

export const PlanFileSummary = Schema.Struct({
  planId: Schema.String,
  filename: TrimmedNonEmptyString,
  dependsOn: Schema.Array(Schema.String),
  maxRetries: Schema.Number,
  content: Schema.String,
});

export const PlanRunnerGetFeaturePlansResult = Schema.Struct({
  featureName: TrimmedNonEmptyString,
  plans: Schema.Array(PlanFileSummary),
});

// ─── List Runs ───────────────────────────────────────────────

export const PlanRunnerListRunsInput = Schema.Struct({
  projectId: Schema.optional(ProjectId),
});

export const PlanRunnerListRunsResult = Schema.Struct({
  runs: Schema.Array(PlanRunSnapshot),
});

// ─── Streaming Events ───────────────────────────────────────────────────────

export const PlanRunnerEvent = Schema.Union([
  Schema.Struct({
    type: Schema.Literal("planRunner.stateChanged"),
    runId: PlanRunId,
    snapshot: PlanRunSnapshot,
  }),
  Schema.Struct({
    type: Schema.Literal("planRunner.planStateChanged"),
    runId: PlanRunId,
    planId: Schema.String,
    state: PlanState,
    retriesUsed: Schema.Number,
    error: Schema.NullOr(Schema.String),
  }),
  Schema.Struct({
    type: Schema.Literal("planRunner.completed"),
    runId: PlanRunId,
    state: FeatureState,
    summary: Schema.NullOr(Schema.String),
    completedAt: IsoDateTime,
  }),
]);
export type PlanRunnerEvent = typeof PlanRunnerEvent.Type;

// ─── Errors ─────────────────────────────────────────────────────────────────

export class PlanRunnerError extends Schema.TaggedErrorClass<PlanRunnerError>()(
  "PlanRunnerError",
  {
    message: TrimmedNonEmptyString,
    cause: Schema.optional(Schema.Unknown),
  },
) {}

export class PlanRunnerNotFoundError extends Schema.TaggedErrorClass<PlanRunnerNotFoundError>()(
  "PlanRunnerNotFoundError",
  {
    runId: PlanRunId,
    message: TrimmedNonEmptyString,
  },
) {}

// ─── WS Method Constants ────────────────────────────────────────────────────

export const PLAN_RUNNER_WS_METHODS = {
  start: "planRunner.start",
  getStatus: "planRunner.getStatus",
  cancel: "planRunner.cancel",
  subscribe: "subscribePlanRunnerEvents",
  listFeatures: "planRunner.listFeatures",
  getFeaturePlans: "planRunner.getFeaturePlans",
  listRuns: "planRunner.listRuns",
} as const;
