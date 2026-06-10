import { Schema } from "effect";
import * as Rpc from "effect/unstable/rpc/Rpc";

import {
  PlanRunnerStartInput,
  PlanRunnerStartResult,
  PlanRunnerGetStatusInput,
  PlanRunSnapshot,
  PlanRunnerCancelInput,
  PlanRunnerStopInput,
  PlanRunnerResumeInput,
  PlanRunnerError,
  PlanRunnerNotFoundError,
  PlanRunnerEvent,
  PlanRunnerListFeaturesInput,
  PlanRunnerListFeaturesResult,
  PlanRunnerGetFeaturePlansInput,
  PlanRunnerGetFeaturePlansResult,
  PlanRunnerGetFeatureRunInput,
  PlanRunnerGetFeatureRunResult,
  PlanRunnerListRunsInput,
  PlanRunnerListRunsResult,
  PlanRunnerGetStepLogInput,
  PlanRunnerGetStepLogResult,
  PlanRunnerArchiveFeatureInput,
  PlanRunnerArchiveFeatureResult,
  PlanRunnerUnarchiveFeatureInput,
  PlanRunnerUnarchiveFeatureResult,
  PlanRunnerListArchivedFeaturesInput,
  PlanRunnerListArchivedFeaturesResult,
  PlanRunnerRenameFeatureInput,
  PlanRunnerRenameFeatureResult,
  PlanRunnerRerunFromFailureInput,
} from "../planRunner";
import { WS_METHODS } from "./methods";

export const WsPlanRunnerStartRpc = Rpc.make(WS_METHODS.planRunnerStart, {
  payload: PlanRunnerStartInput,
  success: PlanRunnerStartResult,
  error: PlanRunnerError,
});

export const WsPlanRunnerGetStatusRpc = Rpc.make(WS_METHODS.planRunnerGetStatus, {
  payload: PlanRunnerGetStatusInput,
  success: PlanRunSnapshot,
  error: Schema.Union([PlanRunnerError, PlanRunnerNotFoundError]),
});

export const WsPlanRunnerCancelRpc = Rpc.make(WS_METHODS.planRunnerCancel, {
  payload: PlanRunnerCancelInput,
  error: Schema.Union([PlanRunnerError, PlanRunnerNotFoundError]),
});

export const WsPlanRunnerStopRpc = Rpc.make(WS_METHODS.planRunnerStop, {
  payload: PlanRunnerStopInput,
  error: Schema.Union([PlanRunnerError, PlanRunnerNotFoundError]),
});

export const WsPlanRunnerResumeRpc = Rpc.make(WS_METHODS.planRunnerResume, {
  payload: PlanRunnerResumeInput,
  error: Schema.Union([PlanRunnerError, PlanRunnerNotFoundError]),
});

export const WsSubscribePlanRunnerEventsRpc = Rpc.make(WS_METHODS.subscribePlanRunnerEvents, {
  payload: Schema.Struct({}),
  success: PlanRunnerEvent,
  stream: true,
});

export const WsPlanRunnerListFeaturesRpc = Rpc.make(WS_METHODS.planRunnerListFeatures, {
  payload: PlanRunnerListFeaturesInput,
  success: PlanRunnerListFeaturesResult,
  error: PlanRunnerError,
});

export const WsPlanRunnerGetFeaturePlansRpc = Rpc.make(WS_METHODS.planRunnerGetFeaturePlans, {
  payload: PlanRunnerGetFeaturePlansInput,
  success: PlanRunnerGetFeaturePlansResult,
  error: PlanRunnerError,
});

export const WsPlanRunnerGetFeatureRunRpc = Rpc.make(WS_METHODS.planRunnerGetFeatureRun, {
  payload: PlanRunnerGetFeatureRunInput,
  success: PlanRunnerGetFeatureRunResult,
  error: PlanRunnerError,
});

export const WsPlanRunnerListRunsRpc = Rpc.make(WS_METHODS.planRunnerListRuns, {
  payload: PlanRunnerListRunsInput,
  success: PlanRunnerListRunsResult,
  error: PlanRunnerError,
});

export const WsPlanRunnerGetStepLogRpc = Rpc.make(WS_METHODS.planRunnerGetStepLog, {
  payload: PlanRunnerGetStepLogInput,
  success: PlanRunnerGetStepLogResult,
  error: Schema.Union([PlanRunnerError, PlanRunnerNotFoundError]),
});

export const WsPlanRunnerArchiveFeatureRpc = Rpc.make(WS_METHODS.planRunnerArchiveFeature, {
  payload: PlanRunnerArchiveFeatureInput,
  success: PlanRunnerArchiveFeatureResult,
  error: PlanRunnerError,
});

export const WsPlanRunnerUnarchiveFeatureRpc = Rpc.make(WS_METHODS.planRunnerUnarchiveFeature, {
  payload: PlanRunnerUnarchiveFeatureInput,
  success: PlanRunnerUnarchiveFeatureResult,
  error: PlanRunnerError,
});

export const WsPlanRunnerListArchivedFeaturesRpc = Rpc.make(
  WS_METHODS.planRunnerListArchivedFeatures,
  {
    payload: PlanRunnerListArchivedFeaturesInput,
    success: PlanRunnerListArchivedFeaturesResult,
    error: PlanRunnerError,
  },
);

export const WsPlanRunnerRenameFeatureRpc = Rpc.make(WS_METHODS.planRunnerRenameFeature, {
  payload: PlanRunnerRenameFeatureInput,
  success: PlanRunnerRenameFeatureResult,
  error: PlanRunnerError,
});

export const WsPlanRunnerRerunFromFailureRpc = Rpc.make(WS_METHODS.planRunnerRerunFromFailure, {
  payload: PlanRunnerRerunFromFailureInput,
  success: PlanRunnerStartResult,
  error: Schema.Union([PlanRunnerError, PlanRunnerNotFoundError]),
});
