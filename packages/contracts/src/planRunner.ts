import { Schema } from "effect";
import {
  IsoDateTime,
  makeEntityId,
  NonNegativeInt,
  TrimmedNonEmptyString,
  ThreadId,
  ProjectId,
} from "./baseSchemas";
import { ModelSelection } from "./orchestration";

// ─── Branded IDs ────────────────────────────────────────────────────────────

export const PlanRunId = makeEntityId("PlanRunId");
export type PlanRunId = typeof PlanRunId.Type;

export const PlanRunnerLogEntryId = makeEntityId("PlanRunnerLogEntryId");
export type PlanRunnerLogEntryId = typeof PlanRunnerLogEntryId.Type;

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
  "recovering",
]);
export type FeatureState = typeof FeatureState.Type;

// ─── Step / Thread / Log Kinds ─────────────────────────────────────────────

export const PlanRunnerStepKind = Schema.Literals(["plan", "analyzer", "integration"]);
export type PlanRunnerStepKind = typeof PlanRunnerStepKind.Type;

export const PlanRunnerThreadRole = Schema.Literals([
  "executor",
  "reviewer",
  "analyzer",
  "integration",
]);
export type PlanRunnerThreadRole = typeof PlanRunnerThreadRole.Type;

export const PlanRunnerLogEntryKind = Schema.Literals([
  "runner.status",
  "runner.retry",
  "runner.recovery",
  "prompt",
  "assistant",
  "activity",
]);
export type PlanRunnerLogEntryKind = typeof PlanRunnerLogEntryKind.Type;

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

// ─── Step Snapshot ──────────────────────────────────────────────────────────

export const PlanRunnerThreadRef = Schema.Struct({
  threadId: ThreadId,
  role: PlanRunnerThreadRole,
});
export type PlanRunnerThreadRef = typeof PlanRunnerThreadRef.Type;

/**
 * Per-step snapshot for all started/loggable steps in a run, including the
 * Analyzer and Integration phases. `stepKey` is the stable identifier used to
 * fetch step logs and correlate streaming append events.
 */
export const PlanRunnerStepSnapshot = Schema.Struct({
  stepKey: TrimmedNonEmptyString,
  kind: PlanRunnerStepKind,
  planId: Schema.NullOr(Schema.String),
  filename: Schema.NullOr(TrimmedNonEmptyString),
  state: PlanState,
  failureSummary: Schema.NullOr(Schema.String),
  startedAt: Schema.NullOr(IsoDateTime),
  completedAt: Schema.NullOr(IsoDateTime),
  executionOrder: Schema.NullOr(NonNegativeInt),
  threadRefs: Schema.Array(PlanRunnerThreadRef),
});
export type PlanRunnerStepSnapshot = typeof PlanRunnerStepSnapshot.Type;

// ─── PlanRunSnapshot ────────────────────────────────────────────────────────

export const PlanRunSnapshot = Schema.Struct({
  runId: PlanRunId,
  featureName: TrimmedNonEmptyString,
  projectId: ProjectId,
  branch: TrimmedNonEmptyString,
  worktreePath: Schema.NullOr(Schema.String),
  state: FeatureState,
  plans: Schema.Array(PlanNode),
  /** Maximum number of plans executing in parallel. */
  maxConcurrency: Schema.Number,
  analyzerThreadId: Schema.NullOr(ThreadId),
  integrationThreadId: Schema.NullOr(ThreadId),
  /** Normalized step history across plan/analyzer/integration phases. */
  steps: Schema.Array(PlanRunnerStepSnapshot),
  startedAt: IsoDateTime,
  completedAt: Schema.NullOr(IsoDateTime),
  /** Wall-clock timestamp of the last mutation to this snapshot. */
  lastUpdatedAt: IsoDateTime,
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
  /** Most recent stored run for this feature, regardless of active state. */
  lastRunId: Schema.NullOr(PlanRunId),
  lastRunState: Schema.NullOr(FeatureState),
  lastRunUpdatedAt: Schema.NullOr(IsoDateTime),
});
export type FeatureSummary = typeof FeatureSummary.Type;

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

// ─── Get Feature Run (feature-scoped lookup) ─────────────────

export const PlanRunnerGetFeatureRunInput = Schema.Struct({
  projectId: ProjectId,
  featureName: TrimmedNonEmptyString,
});
export type PlanRunnerGetFeatureRunInput = typeof PlanRunnerGetFeatureRunInput.Type;

export const PlanRunnerGetFeatureRunResult = Schema.Struct({
  run: Schema.NullOr(PlanRunSnapshot),
});
export type PlanRunnerGetFeatureRunResult = typeof PlanRunnerGetFeatureRunResult.Type;

// ─── List Runs ───────────────────────────────────────────────

export const PlanRunnerListRunsInput = Schema.Struct({
  projectId: Schema.optional(ProjectId),
});

export const PlanRunnerListRunsResult = Schema.Struct({
  runs: Schema.Array(PlanRunSnapshot),
});

// ─── Step Logs ───────────────────────────────────────────────

export const PlanRunnerGetStepLogInput = Schema.Struct({
  runId: PlanRunId,
  stepKey: TrimmedNonEmptyString,
});
export type PlanRunnerGetStepLogInput = typeof PlanRunnerGetStepLogInput.Type;

/**
 * Normalized log entry produced by the server-side monitor projection. The
 * server is the source of truth for rendering — `title`/`bodyMarkdown`/
 * `bodyText`/`copyText` are pre-rendered so the web app does not need to
 * reach into hidden provider threads.
 */
export const PlanRunnerLogEntry = Schema.Struct({
  entryId: PlanRunnerLogEntryId,
  runId: PlanRunId,
  stepKey: TrimmedNonEmptyString,
  kind: PlanRunnerLogEntryKind,
  sequence: NonNegativeInt,
  createdAt: IsoDateTime,
  threadId: Schema.NullOr(ThreadId),
  threadRole: Schema.NullOr(PlanRunnerThreadRole),
  title: TrimmedNonEmptyString,
  bodyMarkdown: Schema.NullOr(Schema.String),
  bodyText: Schema.NullOr(Schema.String),
  copyText: Schema.String,
  /** Structured payload for client-side affordances (links, refs, etc.). */
  payload: Schema.Unknown,
});
export type PlanRunnerLogEntry = typeof PlanRunnerLogEntry.Type;

export const PlanRunnerGetStepLogResult = Schema.Struct({
  runId: PlanRunId,
  stepKey: TrimmedNonEmptyString,
  entries: Schema.Array(PlanRunnerLogEntry),
});
export type PlanRunnerGetStepLogResult = typeof PlanRunnerGetStepLogResult.Type;

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
  Schema.Struct({
    type: Schema.Literal("planRunner.featuresChanged"),
    projectId: ProjectId,
    features: Schema.Array(FeatureSummary),
  }),
  Schema.Struct({
    type: Schema.Literal("planRunner.stepLogAppended"),
    runId: PlanRunId,
    stepKey: TrimmedNonEmptyString,
    entry: PlanRunnerLogEntry,
  }),
]);
export type PlanRunnerEvent = typeof PlanRunnerEvent.Type;

// ─── Errors ─────────────────────────────────────────────────────────────────

export class PlanRunnerError extends Schema.TaggedErrorClass<PlanRunnerError>()("PlanRunnerError", {
  message: TrimmedNonEmptyString,
  cause: Schema.optional(Schema.Unknown),
}) {}

export class PlanRunnerNotFoundError extends Schema.TaggedErrorClass<PlanRunnerNotFoundError>()(
  "PlanRunnerNotFoundError",
  {
    runId: PlanRunId,
    message: TrimmedNonEmptyString,
  },
) {}
