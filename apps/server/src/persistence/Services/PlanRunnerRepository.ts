/**
 * PlanRunnerRepository - Persistence repository for plan-runner durable state.
 *
 * Centralizes reads + writes of `plan_runner_feature_runs`, `plan_runner_steps`,
 * `plan_runner_internal_threads`, and `plan_runner_synthetic_log_entries`. Returns
 * fully reconstructed `PlanRunSnapshot` values to consumers — the in-memory
 * `activeRuns` map in the runtime is no longer the source of truth.
 *
 * @module PlanRunnerRepository
 */
import {
  FeatureState,
  IsoDateTime,
  ModelSelection,
  NonNegativeInt,
  PlanRunId,
  PlanRunnerLogEntryKind,
  PlanRunnerStepKind,
  PlanRunnerThreadRole,
  PlanRunSnapshot,
  PlanState,
  ProjectId,
  ThreadId,
  TrimmedNonEmptyString,
} from "@fenrir/contracts";
import { Option, Schema, ServiceMap } from "effect";
import type { Effect } from "effect";

import type { ProjectionRepositoryError } from "../Errors.ts";

// ─── Row schemas ────────────────────────────────────────────────────────────

/**
 * Persisted row for `plan_runner_feature_runs`. Maps 1:1 to columns; consumers
 * receive `PlanRunSnapshot` reconstructions (run + steps + internal threads),
 * not raw rows.
 */
export const PlanRunnerRunRow = Schema.Struct({
  runId: PlanRunId,
  projectId: ProjectId,
  featureName: TrimmedNonEmptyString,
  state: FeatureState,
  summary: Schema.NullOr(Schema.String),
  branch: TrimmedNonEmptyString,
  worktreePath: Schema.NullOr(Schema.String),
  ownsWorktree: Schema.Boolean,
  modelSelection: ModelSelection,
  maxConcurrency: Schema.Number,
  startedAt: IsoDateTime,
  completedAt: Schema.NullOr(IsoDateTime),
  lastUpdatedAt: IsoDateTime,
});
export type PlanRunnerRunRow = typeof PlanRunnerRunRow.Type;

/**
 * Persisted row for `plan_runner_steps`. One row per declared step (plan,
 * analyzer, integration). `startedAt IS NULL` means the step has not begun;
 * such rows are excluded from `PlanRunSnapshot.steps` history but still
 * contribute to `PlanRunSnapshot.plans`.
 */
export const PlanRunnerStepRow = Schema.Struct({
  runId: PlanRunId,
  stepKey: TrimmedNonEmptyString,
  stepKind: PlanRunnerStepKind,
  planId: Schema.NullOr(Schema.String),
  filename: Schema.NullOr(TrimmedNonEmptyString),
  planMarkdown: Schema.NullOr(Schema.String),
  dependsOn: Schema.Array(Schema.String),
  state: PlanState,
  maxRetries: Schema.Number,
  retriesUsed: Schema.Number,
  error: Schema.NullOr(Schema.String),
  failureSummary: Schema.NullOr(Schema.String),
  startedAt: Schema.NullOr(IsoDateTime),
  completedAt: Schema.NullOr(IsoDateTime),
  executionOrder: NonNegativeInt,
});
export type PlanRunnerStepRow = typeof PlanRunnerStepRow.Type;

/**
 * Persisted row for `plan_runner_internal_threads`. Tracks the orchestration
 * threads spawned per step (executor/reviewer/analyzer/integration). The
 * caller drives orchestration thread deletion separately when a run is
 * replaced or removed.
 */
export const PlanRunnerInternalThreadRow = Schema.Struct({
  runId: PlanRunId,
  stepKey: TrimmedNonEmptyString,
  threadId: ThreadId,
  threadRole: PlanRunnerThreadRole,
  createdAt: IsoDateTime,
});
export type PlanRunnerInternalThreadRow = typeof PlanRunnerInternalThreadRow.Type;

/**
 * Persisted row for `plan_runner_synthetic_log_entries`. Synthetic entries
 * are runner-generated events (status, retry, recovery) that never came
 * from a provider thread; `threadId`/`threadRole` are intentionally absent.
 */
export const PlanRunnerSyntheticLogEntryRow = Schema.Struct({
  runId: PlanRunId,
  stepKey: TrimmedNonEmptyString,
  sequence: NonNegativeInt,
  kind: PlanRunnerLogEntryKind,
  title: Schema.NullOr(Schema.String),
  bodyMarkdown: Schema.NullOr(Schema.String),
  bodyText: Schema.NullOr(Schema.String),
  copyText: Schema.NullOr(Schema.String),
  payload: Schema.Unknown,
  createdAt: IsoDateTime,
});
export type PlanRunnerSyntheticLogEntryRow = typeof PlanRunnerSyntheticLogEntryRow.Type;

// ─── Aggregated read shapes ─────────────────────────────────────────────────

/**
 * Per-feature run summary. Excludes `planCount` because that is derived from
 * filesystem scans; callers merge the two on demand.
 */
export const PlanRunnerFeatureRunSummary = Schema.Struct({
  featureName: TrimmedNonEmptyString,
  hasActiveRun: Schema.Boolean,
  activeRunId: Schema.NullOr(PlanRunId),
  lastRunId: Schema.NullOr(PlanRunId),
  lastRunState: Schema.NullOr(FeatureState),
  lastRunUpdatedAt: Schema.NullOr(IsoDateTime),
});
export type PlanRunnerFeatureRunSummary = typeof PlanRunnerFeatureRunSummary.Type;

// ─── Patch shapes ───────────────────────────────────────────────────────────

/**
 * Mutation patch for a feature run. Every patch carries `lastUpdatedAt` so
 * the row's freshness reflects the actual state transition (not client time).
 */
export const PlanRunnerRunStatePatch = Schema.Struct({
  state: Schema.optional(FeatureState),
  summary: Schema.optional(Schema.NullOr(Schema.String)),
  completedAt: Schema.optional(Schema.NullOr(IsoDateTime)),
  lastUpdatedAt: IsoDateTime,
});
export type PlanRunnerRunStatePatch = typeof PlanRunnerRunStatePatch.Type;

/**
 * Mutation patch for a single step row. Caller passes only the fields that
 * changed; the repository keeps untouched columns intact.
 */
export const PlanRunnerStepStatePatch = Schema.Struct({
  state: Schema.optional(PlanState),
  error: Schema.optional(Schema.NullOr(Schema.String)),
  failureSummary: Schema.optional(Schema.NullOr(Schema.String)),
  retriesUsed: Schema.optional(Schema.Number),
  startedAt: Schema.optional(Schema.NullOr(IsoDateTime)),
  completedAt: Schema.optional(Schema.NullOr(IsoDateTime)),
});
export type PlanRunnerStepStatePatch = typeof PlanRunnerStepStatePatch.Type;

/**
 * Body of a synthetic log entry append. Sequence is assigned by the
 * repository inside a transaction so callers never race on it.
 */
export const PlanRunnerSyntheticLogEntryAppend = Schema.Struct({
  kind: PlanRunnerLogEntryKind,
  title: Schema.NullOr(Schema.String),
  bodyMarkdown: Schema.NullOr(Schema.String),
  bodyText: Schema.NullOr(Schema.String),
  copyText: Schema.NullOr(Schema.String),
  payload: Schema.Unknown,
  createdAt: IsoDateTime,
});
export type PlanRunnerSyntheticLogEntryAppend = typeof PlanRunnerSyntheticLogEntryAppend.Type;

// ─── Method input shapes ────────────────────────────────────────────────────

export const GetFeatureRunInput = Schema.Struct({
  projectId: ProjectId,
  featureName: TrimmedNonEmptyString,
});
export type GetFeatureRunInput = typeof GetFeatureRunInput.Type;

export const GetRunByIdInput = Schema.Struct({
  runId: PlanRunId,
});
export type GetRunByIdInput = typeof GetRunByIdInput.Type;

export const ListRunsInput = Schema.Struct({
  projectId: Schema.optional(ProjectId),
});
export type ListRunsInput = typeof ListRunsInput.Type;

export const ListFeatureSummariesInput = Schema.Struct({
  projectId: ProjectId,
});
export type ListFeatureSummariesInput = typeof ListFeatureSummariesInput.Type;

export const InsertRunSnapshotInput = Schema.Struct({
  run: PlanRunnerRunRow,
  steps: Schema.Array(PlanRunnerStepRow),
  internalThreads: Schema.Array(PlanRunnerInternalThreadRow),
});
export type InsertRunSnapshotInput = typeof InsertRunSnapshotInput.Type;

export const ReplaceFeatureRunInput = Schema.Struct({
  projectId: ProjectId,
  featureName: TrimmedNonEmptyString,
  run: PlanRunnerRunRow,
  steps: Schema.Array(PlanRunnerStepRow),
  internalThreads: Schema.Array(PlanRunnerInternalThreadRow),
  /**
   * Optional explicit prior run id to ensure delete-targets the row the
   * caller saw. If omitted, the repo falls back to looking up by
   * `(projectId, featureName)`.
   */
  oldRunId: Schema.optional(PlanRunId),
});
export type ReplaceFeatureRunInput = typeof ReplaceFeatureRunInput.Type;

export const ReplaceFeatureRunResult = Schema.Struct({
  deletedRunId: Schema.NullOr(PlanRunId),
});
export type ReplaceFeatureRunResult = typeof ReplaceFeatureRunResult.Type;

export const UpdateRunStateInput = Schema.Struct({
  runId: PlanRunId,
  patch: PlanRunnerRunStatePatch,
});
export type UpdateRunStateInput = typeof UpdateRunStateInput.Type;

export const UpdateStepStateInput = Schema.Struct({
  runId: PlanRunId,
  stepKey: TrimmedNonEmptyString,
  patch: PlanRunnerStepStatePatch,
  /** Bumped onto the run row alongside the step write to keep freshness in sync. */
  lastUpdatedAt: IsoDateTime,
});
export type UpdateStepStateInput = typeof UpdateStepStateInput.Type;

export const SetStepExecutionOrderInput = Schema.Struct({
  runId: PlanRunId,
  stepKey: TrimmedNonEmptyString,
  executionOrder: NonNegativeInt,
  lastUpdatedAt: IsoDateTime,
});
export type SetStepExecutionOrderInput = typeof SetStepExecutionOrderInput.Type;

export const AppendSyntheticLogEntryInput = Schema.Struct({
  runId: PlanRunId,
  stepKey: TrimmedNonEmptyString,
  entry: PlanRunnerSyntheticLogEntryAppend,
});
export type AppendSyntheticLogEntryInput = typeof AppendSyntheticLogEntryInput.Type;

export const ListSyntheticLogEntriesInput = Schema.Struct({
  runId: PlanRunId,
  stepKey: TrimmedNonEmptyString,
});
export type ListSyntheticLogEntriesInput = typeof ListSyntheticLogEntriesInput.Type;

export const ListInternalThreadRefsInput = Schema.Struct({
  runId: PlanRunId,
});
export type ListInternalThreadRefsInput = typeof ListInternalThreadRefsInput.Type;

export const RegisterInternalThreadInput = Schema.Struct({
  runId: PlanRunId,
  stepKey: TrimmedNonEmptyString,
  threadId: ThreadId,
  threadRole: PlanRunnerThreadRole,
  createdAt: IsoDateTime,
});
export type RegisterInternalThreadInput = typeof RegisterInternalThreadInput.Type;

export const DeleteRunInput = Schema.Struct({
  runId: PlanRunId,
});
export type DeleteRunInput = typeof DeleteRunInput.Type;

// ─── Service shape ──────────────────────────────────────────────────────────

/**
 * PlanRunnerRepositoryShape - Plan-runner durable state API.
 *
 * Snapshot reads (`getFeatureRun`, `getRunById`, `listRuns`,
 * `listRecoverableRuns`) reconstruct `PlanRunSnapshot` deterministically from
 * normalized rows. Mutations (`updateRunState`, `updateStepState`,
 * `setStepExecutionOrder`, `appendSyntheticLogEntry`) bump
 * `last_updated_at` so freshness reflects state transitions, not client
 * clocks.
 *
 * `replaceFeatureRun` is the only supported way to start a new run for a
 * feature that already has a persisted run — it replaces the prior row
 * inside one transaction and returns the deleted run id so the caller can
 * issue follow-up orchestration thread deletions.
 */
export interface PlanRunnerRepositoryShape {
  /**
   * Reconstructs the latest run for a feature. Returns `Option.none` when no
   * row exists. Filename-based plan graph + started-only step history.
   */
  readonly getFeatureRun: (
    input: GetFeatureRunInput,
  ) => Effect.Effect<Option.Option<PlanRunSnapshot>, ProjectionRepositoryError>;

  /**
   * Reconstructs a single run by id. Returns `Option.none` when the run is
   * not persisted.
   */
  readonly getRunById: (
    input: GetRunByIdInput,
  ) => Effect.Effect<Option.Option<PlanRunSnapshot>, ProjectionRepositoryError>;

  /**
   * Lists all runs, optionally scoped to a project. Each run is fully
   * reconstructed (steps + internal threads).
   */
  readonly listRuns: (
    input: ListRunsInput,
  ) => Effect.Effect<ReadonlyArray<PlanRunSnapshot>, ProjectionRepositoryError>;

  /**
   * Returns one summary per feature that has a persisted run for the
   * project. `planCount` is filesystem-derived and intentionally absent —
   * callers merge with their own scan.
   */
  readonly listFeatureSummaries: (
    input: ListFeatureSummariesInput,
  ) => Effect.Effect<ReadonlyArray<PlanRunnerFeatureRunSummary>, ProjectionRepositoryError>;

  /**
   * Inserts a brand-new run + its steps + its internal thread refs in a
   * single transaction. Throws on conflict — callers that need to overwrite
   * an existing feature run must use `replaceFeatureRun`.
   */
  readonly insertRunSnapshot: (
    input: InsertRunSnapshotInput,
  ) => Effect.Effect<void, ProjectionRepositoryError>;

  /**
   * Atomically replaces any existing run for `(projectId, featureName)` with
   * the supplied next run rows. The replacement is the only supported write
   * path for starting a new run on a feature that already has one; if the
   * transaction cannot complete the entire start must be aborted by the
   * caller.
   *
   * @returns `deletedRunId` of the prior row (or `null` if there was none),
   *          so the caller can drive orchestration-side cleanup.
   */
  readonly replaceFeatureRun: (
    input: ReplaceFeatureRunInput,
  ) => Effect.Effect<ReplaceFeatureRunResult, ProjectionRepositoryError>;

  /**
   * Patches mutable fields on a run row. `lastUpdatedAt` is required so the
   * freshness column reflects the state transition.
   */
  readonly updateRunState: (
    input: UpdateRunStateInput,
  ) => Effect.Effect<void, ProjectionRepositoryError>;

  /**
   * Patches mutable fields on a single step row inside a transaction; the
   * parent run row's `last_updated_at` bumps in lockstep.
   */
  readonly updateStepState: (
    input: UpdateStepStateInput,
  ) => Effect.Effect<void, ProjectionRepositoryError>;

  /**
   * Sets the monotonic execution order on a started step, bumping the run
   * row's `last_updated_at`.
   */
  readonly setStepExecutionOrder: (
    input: SetStepExecutionOrderInput,
  ) => Effect.Effect<void, ProjectionRepositoryError>;

  /**
   * Appends a synthetic log entry under `(runId, stepKey)` with a sequence
   * computed atomically (no caller race). Returns the inserted row.
   */
  readonly appendSyntheticLogEntry: (
    input: AppendSyntheticLogEntryInput,
  ) => Effect.Effect<PlanRunnerSyntheticLogEntryRow, ProjectionRepositoryError>;

  /**
   * Lists synthetic log entries for `(runId, stepKey)` ordered by sequence
   * ascending.
   */
  readonly listSyntheticLogEntries: (
    input: ListSyntheticLogEntriesInput,
  ) => Effect.Effect<ReadonlyArray<PlanRunnerSyntheticLogEntryRow>, ProjectionRepositoryError>;

  /**
   * Lists every internal thread ref persisted for a run, ordered by
   * `created_at` ascending. Useful for both UI rendering and orchestration
   * thread cleanup.
   */
  readonly listInternalThreadRefs: (
    input: ListInternalThreadRefsInput,
  ) => Effect.Effect<ReadonlyArray<PlanRunnerInternalThreadRow>, ProjectionRepositoryError>;

  /**
   * Inserts a single internal thread ref for a step that is already
   * persisted. Bumps the parent run's `last_updated_at` to keep freshness
   * aligned with the spawn event. Idempotent on
   * `(run_id, step_key, thread_id)` — re-registration is a no-op so the
   * runner can replay through `register-on-spawn` paths without coordination.
   */
  readonly registerInternalThread: (
    input: RegisterInternalThreadInput,
  ) => Effect.Effect<void, ProjectionRepositoryError>;

  /**
   * Hard-deletes a run row (cascades to steps, internal threads, and
   * synthetic log entries via FK ON DELETE CASCADE).
   */
  readonly deleteRun: (input: DeleteRunInput) => Effect.Effect<void, ProjectionRepositoryError>;

  /**
   * Returns runs whose terminal `state` was never reached (e.g. the server
   * crashed mid-execution). The recovery reactor drives these toward a
   * terminal state on next startup.
   */
  readonly listRecoverableRuns: () => Effect.Effect<
    ReadonlyArray<PlanRunSnapshot>,
    ProjectionRepositoryError
  >;
}

/**
 * PlanRunnerRepository - Service tag for plan-runner persistence.
 */
export class PlanRunnerRepository extends ServiceMap.Service<
  PlanRunnerRepository,
  PlanRunnerRepositoryShape
>()("t3/persistence/Services/PlanRunnerRepository/PlanRunnerRepository") {}
