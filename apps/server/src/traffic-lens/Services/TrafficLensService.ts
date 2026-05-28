import { Effect, Context } from "effect";
import type {
  TrafficLensDeleteOverrideInput,
  TrafficLensDeleteProfileInput,
  TrafficLensDeleteRuleInput,
  TrafficLensDetail,
  TrafficLensEntry,
  TrafficLensError,
  TrafficLensEvent,
  TrafficLensFinding,
  TrafficLensIngestPayload,
  TrafficLensListFindingsInput,
  TrafficLensNotFoundError,
  TrafficLensOverride,
  TrafficLensProfile,
  TrafficLensQueryInput,
  TrafficLensReplayInput,
  TrafficLensReplayResponse,
  TrafficLensRule,
  TrafficLensUpsertOverrideInput,
  TrafficLensUpsertProfileInput,
  TrafficLensUpsertRuleInput,
} from "@fenrir/contracts";

export interface TrafficLensServiceShape {
  readonly ingestTraffic: (payload: TrafficLensIngestPayload) => Effect.Effect<void>;
  readonly queryTraffic: (
    input: TrafficLensQueryInput,
  ) => Effect.Effect<readonly TrafficLensEntry[]>;
  readonly getTrafficDetail: (
    id: number,
  ) => Effect.Effect<TrafficLensDetail, TrafficLensNotFoundError>;
  readonly clearTraffic: (tabId?: string) => Effect.Effect<void>;
  readonly subscribe: (listener: (event: TrafficLensEvent) => void) => Effect.Effect<() => void>;
  readonly replayRequest: (
    input: TrafficLensReplayInput,
  ) => Effect.Effect<TrafficLensReplayResponse, TrafficLensError>;
  readonly listProfiles: () => Effect.Effect<readonly TrafficLensProfile[]>;
  readonly upsertProfile: (
    input: TrafficLensUpsertProfileInput,
  ) => Effect.Effect<TrafficLensProfile, TrafficLensError>;
  readonly deleteProfile: (
    input: TrafficLensDeleteProfileInput,
  ) => Effect.Effect<void, TrafficLensError>;
  readonly listRules: () => Effect.Effect<readonly TrafficLensRule[]>;
  readonly upsertRule: (
    input: TrafficLensUpsertRuleInput,
  ) => Effect.Effect<TrafficLensRule, TrafficLensError>;
  readonly deleteRule: (input: TrafficLensDeleteRuleInput) => Effect.Effect<void, TrafficLensError>;
  readonly listOverrides: () => Effect.Effect<readonly TrafficLensOverride[]>;
  readonly upsertOverride: (
    input: TrafficLensUpsertOverrideInput,
  ) => Effect.Effect<TrafficLensOverride, TrafficLensError>;
  readonly deleteOverride: (
    input: TrafficLensDeleteOverrideInput,
  ) => Effect.Effect<void, TrafficLensError>;
  readonly listFindings: (
    input: TrafficLensListFindingsInput,
  ) => Effect.Effect<readonly TrafficLensFinding[]>;
}

export class TrafficLensService extends Context.Service<
  TrafficLensService,
  TrafficLensServiceShape
>()("fenrir/traffic-lens/TrafficLensService") {}
