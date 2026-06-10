import { Schema } from "effect";
import * as Rpc from "effect/unstable/rpc/Rpc";

import {
  TrafficLensArchivedSessionStorageSummary,
  TrafficLensClearPersistedOriginInput,
  TrafficLensDeleteOverrideInput,
  TrafficLensDeleteProfileInput,
  TrafficLensDeleteRuleInput,
  TrafficLensDomStorageEntry,
  TrafficLensDomStorageSnapshot,
  TrafficLensError,
  TrafficLensEvent,
  TrafficLensDetail,
  TrafficLensEntry,
  TrafficLensFinding,
  TrafficLensGetApplicableCookiesInput,
  TrafficLensGetLocalStorageInput,
  TrafficLensGetSessionStorageSnapshotInput,
  TrafficLensGetStorageVersionsInput,
  TrafficLensListFindingsInput,
  TrafficLensListSessionStorageSnapshotsInput,
  TrafficLensListStorageOriginsInput,
  TrafficLensNotFoundError,
  TrafficLensOverride,
  TrafficLensQueryInput,
  TrafficLensReplayInput,
  TrafficLensReplayResponse,
  TrafficLensRule,
  TrafficLensProfile,
  TrafficLensStorageAreaVersion,
  TrafficLensStorageOriginSummary,
  TrafficLensCookieSnapshot,
  TrafficLensUpsertOverrideInput,
  TrafficLensUpsertProfileInput,
  TrafficLensUpsertRuleInput,
  TrafficLensUpdateSessionStorageSnapshotInput,
} from "../trafficLens";
import { WS_METHODS } from "./methods";

export const WsTrafficLensGetTrafficRpc = Rpc.make(WS_METHODS.trafficLensGetTraffic, {
  payload: TrafficLensQueryInput,
  success: Schema.Array(TrafficLensEntry),
  error: TrafficLensError,
});

export const WsTrafficLensGetTrafficDetailRpc = Rpc.make(WS_METHODS.trafficLensGetTrafficDetail, {
  payload: Schema.Struct({ id: Schema.Number }),
  success: TrafficLensDetail,
  error: Schema.Union([TrafficLensError, TrafficLensNotFoundError]),
});

export const WsTrafficLensClearTrafficRpc = Rpc.make(WS_METHODS.trafficLensClearTraffic, {
  payload: Schema.Struct({ tabId: Schema.optional(Schema.String) }),
  error: TrafficLensError,
});

export const WsSubscribeTrafficLensEventsRpc = Rpc.make(WS_METHODS.subscribeTrafficLensEvents, {
  payload: Schema.Struct({}),
  success: TrafficLensEvent,
  stream: true,
});

export const WsTrafficLensReplayRequestRpc = Rpc.make(WS_METHODS.trafficLensReplayRequest, {
  payload: TrafficLensReplayInput,
  success: TrafficLensReplayResponse,
  error: TrafficLensError,
});

export const WsTrafficLensListFindingsRpc = Rpc.make(WS_METHODS.trafficLensListFindings, {
  payload: TrafficLensListFindingsInput,
  success: Schema.Array(TrafficLensFinding),
  error: TrafficLensError,
});

export const WsTrafficLensListRulesRpc = Rpc.make(WS_METHODS.trafficLensListRules, {
  payload: Schema.Struct({}),
  success: Schema.Array(TrafficLensRule),
  error: TrafficLensError,
});

export const WsTrafficLensUpsertRuleRpc = Rpc.make(WS_METHODS.trafficLensUpsertRule, {
  payload: TrafficLensUpsertRuleInput,
  success: TrafficLensRule,
  error: TrafficLensError,
});

export const WsTrafficLensDeleteRuleRpc = Rpc.make(WS_METHODS.trafficLensDeleteRule, {
  payload: TrafficLensDeleteRuleInput,
  error: TrafficLensError,
});

export const WsTrafficLensListOverridesRpc = Rpc.make(WS_METHODS.trafficLensListOverrides, {
  payload: Schema.Struct({}),
  success: Schema.Array(TrafficLensOverride),
  error: TrafficLensError,
});

export const WsTrafficLensUpsertOverrideRpc = Rpc.make(WS_METHODS.trafficLensUpsertOverride, {
  payload: TrafficLensUpsertOverrideInput,
  success: TrafficLensOverride,
  error: TrafficLensError,
});

export const WsTrafficLensDeleteOverrideRpc = Rpc.make(WS_METHODS.trafficLensDeleteOverride, {
  payload: TrafficLensDeleteOverrideInput,
  error: TrafficLensError,
});

export const WsTrafficLensListProfilesRpc = Rpc.make(WS_METHODS.trafficLensListProfiles, {
  payload: Schema.Struct({}),
  success: Schema.Array(TrafficLensProfile),
  error: TrafficLensError,
});

export const WsTrafficLensUpsertProfileRpc = Rpc.make(WS_METHODS.trafficLensUpsertProfile, {
  payload: TrafficLensUpsertProfileInput,
  success: TrafficLensProfile,
  error: TrafficLensError,
});

export const WsTrafficLensDeleteProfileRpc = Rpc.make(WS_METHODS.trafficLensDeleteProfile, {
  payload: TrafficLensDeleteProfileInput,
  error: TrafficLensError,
});

export const WsTrafficLensListStorageOriginsRpc = Rpc.make(
  WS_METHODS.trafficLensListStorageOrigins,
  {
    payload: TrafficLensListStorageOriginsInput,
    success: Schema.Array(TrafficLensStorageOriginSummary),
    error: TrafficLensError,
  },
);

export const WsTrafficLensGetCookieSnapshotRpc = Rpc.make(WS_METHODS.trafficLensGetCookieSnapshot, {
  payload: TrafficLensGetApplicableCookiesInput,
  success: Schema.NullOr(TrafficLensCookieSnapshot),
  error: TrafficLensError,
});

export const WsTrafficLensGetLocalStorageSnapshotRpc = Rpc.make(
  WS_METHODS.trafficLensGetLocalStorageSnapshot,
  {
    payload: TrafficLensGetLocalStorageInput,
    success: Schema.NullOr(TrafficLensDomStorageSnapshot),
    error: TrafficLensError,
  },
);

export const WsTrafficLensListSessionStorageSnapshotsRpc = Rpc.make(
  WS_METHODS.trafficLensListSessionStorageSnapshots,
  {
    payload: TrafficLensListSessionStorageSnapshotsInput,
    success: Schema.Array(TrafficLensArchivedSessionStorageSummary),
    error: TrafficLensError,
  },
);

export const WsTrafficLensGetSessionStorageSnapshotRpc = Rpc.make(
  WS_METHODS.trafficLensGetSessionStorageSnapshot,
  {
    payload: TrafficLensGetSessionStorageSnapshotInput,
    success: Schema.Array(TrafficLensDomStorageEntry),
    error: TrafficLensError,
  },
);

export const WsTrafficLensUpdateSessionStorageSnapshotRpc = Rpc.make(
  WS_METHODS.trafficLensUpdateSessionStorageSnapshot,
  {
    payload: TrafficLensUpdateSessionStorageSnapshotInput,
    error: TrafficLensError,
  },
);

export const WsTrafficLensGetStorageVersionsRpc = Rpc.make(
  WS_METHODS.trafficLensGetStorageVersions,
  {
    payload: TrafficLensGetStorageVersionsInput,
    success: Schema.Array(TrafficLensStorageAreaVersion),
    error: TrafficLensError,
  },
);

export const WsTrafficLensClearPersistedOriginRpc = Rpc.make(
  WS_METHODS.trafficLensClearPersistedOrigin,
  {
    payload: TrafficLensClearPersistedOriginInput,
    error: TrafficLensError,
  },
);
