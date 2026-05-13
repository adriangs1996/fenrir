import { ServiceMap } from "effect";
import type { Effect, Stream } from "effect";
import type {
  PlanRunId,
  PlanRunSnapshot,
  PlanRunnerEvent,
  PlanRunnerError,
  PlanRunnerGetFeatureRunResult,
  PlanRunnerGetStepLogResult,
  PlanRunnerArchiveFeatureResult,
  PlanRunnerUnarchiveFeatureResult,
  PlanRunnerListArchivedFeaturesResult,
  PlanRunnerRenameFeatureResult,
  PlanRunnerNotFoundError,
  ProjectId,
  ModelSelection,
} from "@fenrir/contracts";

export interface PlanRunnerServiceShape {
  readonly start: (input: {
    readonly projectId: ProjectId;
    readonly featureName: string;
    readonly modelSelection?: ModelSelection | undefined;
  }) => Effect.Effect<{ runId: PlanRunId; branch: string }, PlanRunnerError>;

  readonly rerunFromFailure: (input: {
    readonly projectId: ProjectId;
    readonly featureName: string;
    readonly failedRunId: PlanRunId;
    readonly modelSelection?: ModelSelection | undefined;
  }) => Effect.Effect<
    { runId: PlanRunId; branch: string },
    PlanRunnerError | PlanRunnerNotFoundError
  >;

  readonly getStatus: (runId: PlanRunId) => Effect.Effect<PlanRunSnapshot, PlanRunnerNotFoundError>;

  readonly cancel: (
    runId: PlanRunId,
  ) => Effect.Effect<void, PlanRunnerNotFoundError | PlanRunnerError>;

  readonly stop: (
    runId: PlanRunId,
  ) => Effect.Effect<void, PlanRunnerNotFoundError | PlanRunnerError>;

  readonly resume: (
    runId: PlanRunId,
  ) => Effect.Effect<void, PlanRunnerNotFoundError | PlanRunnerError>;

  readonly listFeatures: (input: { readonly projectId: ProjectId }) => Effect.Effect<
    {
      features: Array<{
        featureName: string;
        planCount: number;
        hasActiveRun: boolean;
        activeRunId: PlanRunId | null;
        lastRunId: PlanRunId | null;
        lastRunState:
          | "analyzing"
          | "executing"
          | "integrating"
          | "stopped"
          | "completed"
          | "failed"
          | "recovering"
          | null;
        lastRunUpdatedAt: string | null;
      }>;
    },
    PlanRunnerError
  >;

  readonly getFeaturePlans: (input: {
    readonly projectId: ProjectId;
    readonly featureName: string;
  }) => Effect.Effect<
    {
      featureName: string;
      plans: Array<{
        planId: string;
        filename: string;
        dependsOn: string[];
        maxRetries: number;
        content: string;
      }>;
    },
    PlanRunnerError
  >;

  readonly getFeatureRun: (input: {
    readonly projectId: ProjectId;
    readonly featureName: string;
  }) => Effect.Effect<PlanRunnerGetFeatureRunResult, PlanRunnerError>;

  readonly listRuns: (input: {
    readonly projectId?: ProjectId | undefined;
  }) => Effect.Effect<{ runs: Array<PlanRunSnapshot> }, PlanRunnerError>;

  readonly getStepLog: (input: {
    readonly runId: PlanRunId;
    readonly stepKey: string;
  }) => Effect.Effect<PlanRunnerGetStepLogResult, PlanRunnerError | PlanRunnerNotFoundError>;

  readonly archiveFeature: (input: {
    readonly projectId: ProjectId;
    readonly featureName: string;
  }) => Effect.Effect<PlanRunnerArchiveFeatureResult, PlanRunnerError>;

  readonly unarchiveFeature: (input: {
    readonly projectId: ProjectId;
    readonly archivedDirName: string;
  }) => Effect.Effect<PlanRunnerUnarchiveFeatureResult, PlanRunnerError>;

  readonly listArchivedFeatures: (input: {
    readonly projectId?: ProjectId | undefined;
  }) => Effect.Effect<PlanRunnerListArchivedFeaturesResult, PlanRunnerError>;

  readonly renameFeature: (input: {
    readonly projectId: ProjectId;
    readonly featureName: string;
    readonly newFeatureName: string;
  }) => Effect.Effect<PlanRunnerRenameFeatureResult, PlanRunnerError>;

  readonly streamEvents: Stream.Stream<PlanRunnerEvent>;
}

export class PlanRunnerService extends ServiceMap.Service<
  PlanRunnerService,
  PlanRunnerServiceShape
>()("t3/plan-runner/Services/PlanRunner") {}
