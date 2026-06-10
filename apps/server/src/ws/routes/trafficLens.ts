import { Effect, Queue, Stream } from "effect";

import { type TrafficLensEvent, WS_METHODS } from "@fenrir/contracts";

import { TrafficLensService } from "../../traffic-lens/Services/TrafficLensService";
import { TrafficLensStorageService } from "../../traffic-lens-storage/Services/TrafficLensStorageService";
import { makeRpcDomain } from "../handlers";

export const makeTrafficLensRoutes = Effect.gen(function* () {
  const trafficLensService = yield* TrafficLensService;
  const trafficLensStorageService = yield* TrafficLensStorageService;

  const trafficLens = makeRpcDomain("trafficLens");

  return {
    [WS_METHODS.trafficLensGetTraffic]: trafficLens.effect(
      WS_METHODS.trafficLensGetTraffic,
      (input) => trafficLensService.queryTraffic(input),
    ),
    [WS_METHODS.trafficLensGetTrafficDetail]: trafficLens.effect(
      WS_METHODS.trafficLensGetTrafficDetail,
      (input) => trafficLensService.getTrafficDetail(input.id),
    ),
    [WS_METHODS.trafficLensClearTraffic]: trafficLens.effect(
      WS_METHODS.trafficLensClearTraffic,
      (input) => trafficLensService.clearTraffic(input.tabId),
    ),
    [WS_METHODS.trafficLensReplayRequest]: trafficLens.effect(
      WS_METHODS.trafficLensReplayRequest,
      (input) => trafficLensService.replayRequest(input),
    ),
    [WS_METHODS.trafficLensListFindings]: trafficLens.effect(
      WS_METHODS.trafficLensListFindings,
      (input) => trafficLensService.listFindings(input),
    ),
    [WS_METHODS.trafficLensListRules]: trafficLens.effect(
      WS_METHODS.trafficLensListRules,
      (_input) => trafficLensService.listRules(),
    ),
    [WS_METHODS.trafficLensUpsertRule]: trafficLens.effect(
      WS_METHODS.trafficLensUpsertRule,
      (input) => trafficLensService.upsertRule(input),
    ),
    [WS_METHODS.trafficLensDeleteRule]: trafficLens.effect(
      WS_METHODS.trafficLensDeleteRule,
      (input) => trafficLensService.deleteRule(input),
    ),
    [WS_METHODS.trafficLensListOverrides]: trafficLens.effect(
      WS_METHODS.trafficLensListOverrides,
      (_input) => trafficLensService.listOverrides(),
    ),
    [WS_METHODS.trafficLensUpsertOverride]: trafficLens.effect(
      WS_METHODS.trafficLensUpsertOverride,
      (input) => trafficLensService.upsertOverride(input),
    ),
    [WS_METHODS.trafficLensDeleteOverride]: trafficLens.effect(
      WS_METHODS.trafficLensDeleteOverride,
      (input) => trafficLensService.deleteOverride(input),
    ),
    [WS_METHODS.trafficLensListProfiles]: trafficLens.effect(
      WS_METHODS.trafficLensListProfiles,
      (_input) => trafficLensService.listProfiles(),
    ),
    [WS_METHODS.trafficLensUpsertProfile]: trafficLens.effect(
      WS_METHODS.trafficLensUpsertProfile,
      (input) => trafficLensService.upsertProfile(input),
    ),
    [WS_METHODS.trafficLensDeleteProfile]: trafficLens.effect(
      WS_METHODS.trafficLensDeleteProfile,
      (input) => trafficLensService.deleteProfile(input),
    ),
    [WS_METHODS.trafficLensListStorageOrigins]: trafficLens.effect(
      WS_METHODS.trafficLensListStorageOrigins,
      (input) => trafficLensStorageService.listOrigins(input),
    ),
    [WS_METHODS.trafficLensGetCookieSnapshot]: trafficLens.effect(
      WS_METHODS.trafficLensGetCookieSnapshot,
      (input) => trafficLensStorageService.getCookieSnapshot(input),
    ),
    [WS_METHODS.trafficLensGetLocalStorageSnapshot]: trafficLens.effect(
      WS_METHODS.trafficLensGetLocalStorageSnapshot,
      (input) => trafficLensStorageService.getLocalStorageSnapshot(input),
    ),
    [WS_METHODS.trafficLensListSessionStorageSnapshots]: trafficLens.effect(
      WS_METHODS.trafficLensListSessionStorageSnapshots,
      (input) => trafficLensStorageService.listSessionStorageSnapshots(input),
    ),
    [WS_METHODS.trafficLensGetSessionStorageSnapshot]: trafficLens.effect(
      WS_METHODS.trafficLensGetSessionStorageSnapshot,
      (input) => trafficLensStorageService.getSessionStorageSnapshot(input),
    ),
    [WS_METHODS.trafficLensUpdateSessionStorageSnapshot]: trafficLens.effect(
      WS_METHODS.trafficLensUpdateSessionStorageSnapshot,
      (input) => trafficLensStorageService.updateSessionStorageSnapshot(input),
    ),
    [WS_METHODS.trafficLensGetStorageVersions]: trafficLens.effect(
      WS_METHODS.trafficLensGetStorageVersions,
      (input) => trafficLensStorageService.getStorageVersions(input),
    ),
    [WS_METHODS.trafficLensClearPersistedOrigin]: trafficLens.effect(
      WS_METHODS.trafficLensClearPersistedOrigin,
      (input) => trafficLensStorageService.clearPersistedOrigin(input),
    ),
    [WS_METHODS.subscribeTrafficLensEvents]: trafficLens.stream(
      WS_METHODS.subscribeTrafficLensEvents,
      (_input) =>
        Stream.callback<TrafficLensEvent>((queue) =>
          Effect.acquireRelease(
            trafficLensService.subscribe((event) => {
              Queue.offerUnsafe(queue, event);
            }),
            (unsubscribe) => Effect.sync(unsubscribe),
          ),
        ),
    ),
  };
});
