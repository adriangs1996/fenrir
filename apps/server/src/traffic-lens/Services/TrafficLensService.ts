import { Effect, ServiceMap } from "effect";
import type {
  TrafficLensEntry,
  TrafficLensDetail,
  TrafficLensQueryInput,
  TrafficLensIngestPayload,
  TrafficLensNotFoundError,
  TrafficLensEvent,
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
}

export class TrafficLensService extends ServiceMap.Service<
  TrafficLensService,
  TrafficLensServiceShape
>()("fenrir/traffic-lens/TrafficLensService") {}
