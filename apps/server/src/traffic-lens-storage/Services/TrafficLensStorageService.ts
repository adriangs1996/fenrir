import { Effect, ServiceMap } from "effect";
import type {
  TrafficLensArchivedSessionStorageSummary,
  TrafficLensClearPersistedOriginInput,
  TrafficLensCookieSnapshot,
  TrafficLensDomStorageEntry,
  TrafficLensDomStorageSnapshot,
  TrafficLensError,
  TrafficLensGetApplicableCookiesInput,
  TrafficLensGetLocalStorageInput,
  TrafficLensGetSessionStorageSnapshotInput,
  TrafficLensGetStorageVersionsInput,
  TrafficLensListSessionStorageSnapshotsInput,
  TrafficLensListStorageOriginsInput,
  TrafficLensStorageAreaVersion,
  TrafficLensStorageIngestPayload,
  TrafficLensStorageOriginSummary,
  TrafficLensUpdateSessionStorageSnapshotInput,
} from "@fenrir/contracts";

export interface TrafficLensStorageServiceShape {
  readonly ingestSnapshot: (
    payload: TrafficLensStorageIngestPayload,
  ) => Effect.Effect<void, TrafficLensError>;
  readonly listOrigins: (
    input: TrafficLensListStorageOriginsInput,
  ) => Effect.Effect<readonly TrafficLensStorageOriginSummary[]>;
  readonly getCookieSnapshot: (
    input: TrafficLensGetApplicableCookiesInput,
  ) => Effect.Effect<TrafficLensCookieSnapshot | null>;
  readonly getLocalStorageSnapshot: (
    input: TrafficLensGetLocalStorageInput,
  ) => Effect.Effect<TrafficLensDomStorageSnapshot | null>;
  readonly listSessionStorageSnapshots: (
    input: TrafficLensListSessionStorageSnapshotsInput,
  ) => Effect.Effect<readonly TrafficLensArchivedSessionStorageSummary[]>;
  readonly getSessionStorageSnapshot: (
    input: TrafficLensGetSessionStorageSnapshotInput,
  ) => Effect.Effect<readonly TrafficLensDomStorageEntry[], TrafficLensError>;
  readonly updateSessionStorageSnapshot: (
    input: TrafficLensUpdateSessionStorageSnapshotInput,
  ) => Effect.Effect<void, TrafficLensError>;
  readonly getStorageVersions: (
    input: TrafficLensGetStorageVersionsInput,
  ) => Effect.Effect<readonly TrafficLensStorageAreaVersion[]>;
  readonly clearPersistedOrigin: (
    input: TrafficLensClearPersistedOriginInput,
  ) => Effect.Effect<void, TrafficLensError>;
}

export class TrafficLensStorageService extends ServiceMap.Service<
  TrafficLensStorageService,
  TrafficLensStorageServiceShape
>()("fenrir/traffic-lens-storage/TrafficLensStorageService") {}
