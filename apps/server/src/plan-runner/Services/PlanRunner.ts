import { ServiceMap } from "effect";
import type { Effect, Stream } from "effect";
import type {
  PlanRunId,
  PlanRunSnapshot,
  PlanRunnerEvent,
  PlanRunnerError,
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

  readonly getStatus: (
    runId: PlanRunId,
  ) => Effect.Effect<PlanRunSnapshot, PlanRunnerNotFoundError>;

  readonly cancel: (
    runId: PlanRunId,
  ) => Effect.Effect<void, PlanRunnerNotFoundError | PlanRunnerError>;

  readonly listFeatures: (input: {
    readonly projectId: ProjectId;
  }) => Effect.Effect<
    { features: Array<{ featureName: string; planCount: number; hasActiveRun: boolean; activeRunId: PlanRunId | null }> },
    PlanRunnerError
  >;

  readonly getFeaturePlans: (input: {
    readonly projectId: ProjectId;
    readonly featureName: string;
  }) => Effect.Effect<
    { featureName: string; plans: Array<{ planId: string; filename: string; dependsOn: string[]; maxRetries: number; content: string }> },
    PlanRunnerError
  >;

  readonly listRuns: (input: {
    readonly projectId?: ProjectId | undefined;
  }) => Effect.Effect<
    { runs: Array<PlanRunSnapshot> },
    PlanRunnerError
  >;

  readonly streamEvents: Stream.Stream<PlanRunnerEvent>;
}

export class PlanRunnerService extends ServiceMap.Service<
  PlanRunnerService,
  PlanRunnerServiceShape
>()("t3/plan-runner/Services/PlanRunner") {}
