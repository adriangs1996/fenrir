import type {
  ProviderDriverKind,
  ProviderInstanceId,
  ProviderKind,
  ServerProvider,
} from "@fenrir/contracts";
import { Context } from "effect";
import type { Effect, Stream } from "effect";

import type { ServerProviderShape } from "./ServerProvider.ts";

export interface ProviderInstanceRecord {
  readonly provider: ProviderKind | ProviderDriverKind;
  readonly driverKind: ProviderDriverKind;
  readonly instanceId: ProviderInstanceId;
  readonly displayName?: string;
  readonly snapshot: ServerProviderShape;
}

export interface ProviderInstanceRegistryShape {
  readonly getInstance: (
    instanceId: ProviderInstanceId,
  ) => Effect.Effect<ProviderInstanceRecord | undefined>;
  readonly listInstances: Effect.Effect<ReadonlyArray<ProviderInstanceRecord>>;
  readonly listUnavailable: Effect.Effect<ReadonlyArray<ServerProvider>>;
  readonly streamChanges: Stream.Stream<void>;
}

export class ProviderInstanceRegistry extends Context.Service<
  ProviderInstanceRegistry,
  ProviderInstanceRegistryShape
>()("t3/provider/Services/ProviderInstanceRegistry") {}
