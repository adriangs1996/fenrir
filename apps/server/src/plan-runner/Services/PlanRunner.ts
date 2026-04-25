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

  readonly streamEvents: Stream.Stream<PlanRunnerEvent>;
}

export class PlanRunnerService extends ServiceMap.Service<
  PlanRunnerService,
  PlanRunnerServiceShape
>()("t3/plan-runner/Services/PlanRunner") {}
