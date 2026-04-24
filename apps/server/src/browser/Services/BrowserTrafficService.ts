import { Effect, ServiceMap } from "effect";
import type {
  BrowserTrafficEntry,
  BrowserTrafficDetail,
  BrowserTrafficQueryInput,
  BrowserTrafficIngestPayload,
  BrowserTrafficNotFoundError,
  BrowserEvent,
} from "@fenrir/contracts";

export interface BrowserTrafficServiceShape {
  readonly ingestTraffic: (payload: BrowserTrafficIngestPayload) => Effect.Effect<void>;
  readonly queryTraffic: (input: BrowserTrafficQueryInput) => Effect.Effect<readonly BrowserTrafficEntry[]>;
  readonly getTrafficDetail: (id: number) => Effect.Effect<BrowserTrafficDetail, BrowserTrafficNotFoundError>;
  readonly clearTraffic: (tabId?: string) => Effect.Effect<void>;
  readonly subscribe: (listener: (event: BrowserEvent) => void) => Effect.Effect<() => void>;
}

export class BrowserTrafficService extends ServiceMap.Service<
  BrowserTrafficService,
  BrowserTrafficServiceShape
>()("t3/browser/Services/BrowserTrafficService") {}
