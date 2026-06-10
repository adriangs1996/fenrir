import { Effect } from "effect";

import { WS_METHODS } from "@fenrir/contracts";

import { PlanRunnerService } from "../../plan-runner/Services/PlanRunner";
import { makeRpcDomain } from "../handlers";

export const makePlanRunnerRoutes = Effect.gen(function* () {
  const planRunnerService = yield* PlanRunnerService;

  const planRunner = makeRpcDomain("planRunner");

  return {
    [WS_METHODS.planRunnerStart]: planRunner.effect(WS_METHODS.planRunnerStart, (input) =>
      planRunnerService.start(input),
    ),
    [WS_METHODS.planRunnerRerunFromFailure]: planRunner.effect(
      WS_METHODS.planRunnerRerunFromFailure,
      (input) => planRunnerService.rerunFromFailure(input),
    ),
    [WS_METHODS.planRunnerGetStatus]: planRunner.effect(WS_METHODS.planRunnerGetStatus, (input) =>
      planRunnerService.getStatus(input.runId),
    ),
    [WS_METHODS.planRunnerCancel]: planRunner.effect(WS_METHODS.planRunnerCancel, (input) =>
      planRunnerService.cancel(input.runId),
    ),
    [WS_METHODS.planRunnerStop]: planRunner.effect(WS_METHODS.planRunnerStop, (input) =>
      planRunnerService.stop(input.runId),
    ),
    [WS_METHODS.planRunnerResume]: planRunner.effect(WS_METHODS.planRunnerResume, (input) =>
      planRunnerService.resume(input.runId),
    ),
    [WS_METHODS.subscribePlanRunnerEvents]: planRunner.stream(
      WS_METHODS.subscribePlanRunnerEvents,
      (_input) => planRunnerService.streamEvents,
    ),
    [WS_METHODS.planRunnerListFeatures]: planRunner.effect(
      WS_METHODS.planRunnerListFeatures,
      (input) => planRunnerService.listFeatures(input),
    ),
    [WS_METHODS.planRunnerGetFeaturePlans]: planRunner.effect(
      WS_METHODS.planRunnerGetFeaturePlans,
      (input) => planRunnerService.getFeaturePlans(input),
    ),
    [WS_METHODS.planRunnerGetFeatureRun]: planRunner.effect(
      WS_METHODS.planRunnerGetFeatureRun,
      (input) => planRunnerService.getFeatureRun(input),
    ),
    [WS_METHODS.planRunnerListRuns]: planRunner.effect(WS_METHODS.planRunnerListRuns, (input) =>
      planRunnerService.listRuns(input),
    ),
    [WS_METHODS.planRunnerGetStepLog]: planRunner.effect(WS_METHODS.planRunnerGetStepLog, (input) =>
      planRunnerService.getStepLog(input),
    ),
    [WS_METHODS.planRunnerArchiveFeature]: planRunner.effect(
      WS_METHODS.planRunnerArchiveFeature,
      (input) => planRunnerService.archiveFeature(input),
    ),
    [WS_METHODS.planRunnerUnarchiveFeature]: planRunner.effect(
      WS_METHODS.planRunnerUnarchiveFeature,
      (input) => planRunnerService.unarchiveFeature(input),
    ),
    [WS_METHODS.planRunnerListArchivedFeatures]: planRunner.effect(
      WS_METHODS.planRunnerListArchivedFeatures,
      (input) => planRunnerService.listArchivedFeatures(input),
    ),
    [WS_METHODS.planRunnerRenameFeature]: planRunner.effect(
      WS_METHODS.planRunnerRenameFeature,
      (input) => planRunnerService.renameFeature(input),
    ),
  };
});
