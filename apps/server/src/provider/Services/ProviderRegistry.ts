/**
 * ProviderRegistry - Provider snapshot service.
 *
 * Owns provider install/auth/version/model snapshots and exposes the latest
 * provider state to transport layers.
 *
 * @module ProviderRegistry
 */
import type {
  ProviderDriverKind,
  ProviderInstanceId,
  ProviderKind,
  ServerProvider,
  ServerProviderUpdateState,
} from "@fenrir/contracts";
import { ServiceMap } from "effect";
import type { Effect, Stream } from "effect";

import type { ProviderMaintenanceCapabilities } from "../providerMaintenance";

export type ProviderMaintenanceActionKind = "update";

export interface ProviderRegistryShape {
  /**
   * Read the latest provider snapshots.
   */
  readonly getProviders: Effect.Effect<ReadonlyArray<ServerProvider>>;

  /**
   * Refresh all providers, or a single provider when specified.
   */
  readonly refresh: (provider?: ProviderKind) => Effect.Effect<ReadonlyArray<ServerProvider>>;

  /**
   * Refresh one provider instance by instance id.
   */
  readonly refreshInstance: (
    instanceId: ProviderInstanceId,
  ) => Effect.Effect<ReadonlyArray<ServerProvider>>;

  readonly getProviderMaintenanceCapabilitiesForInstance: (
    instanceId: ProviderInstanceId,
    provider: ProviderDriverKind,
  ) => Effect.Effect<ProviderMaintenanceCapabilities>;

  readonly setProviderMaintenanceActionState: (input: {
    readonly instanceId: ProviderInstanceId;
    readonly action: ProviderMaintenanceActionKind;
    readonly state: ServerProviderUpdateState | null;
  }) => Effect.Effect<ReadonlyArray<ServerProvider>>;

  /**
   * Stream of provider snapshot updates.
   */
  readonly streamChanges: Stream.Stream<ReadonlyArray<ServerProvider>>;
}

export class ProviderRegistry extends ServiceMap.Service<ProviderRegistry, ProviderRegistryShape>()(
  "t3/provider/Services/ProviderRegistry",
) {}
