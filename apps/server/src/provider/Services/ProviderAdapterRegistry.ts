/**
 * ProviderAdapterRegistry - Lookup boundary for provider adapter implementations.
 *
 * Maps a provider kind to the concrete adapter service (Codex, Claude, etc).
 * It does not own session lifecycle or routing rules; `ProviderService` uses
 * this registry together with `ProviderSessionDirectory`.
 *
 * @module ProviderAdapterRegistry
 */
import type { ProviderDriverKind, ProviderInstanceId, ProviderKind } from "@fenrir/contracts";
import { Context } from "effect";
import type { Effect } from "effect";

import type { ProviderAdapterError, ProviderUnsupportedError } from "../Errors.ts";
import type { ProviderAdapterShape } from "./ProviderAdapter.ts";

/**
 * ProviderAdapterRegistryShape - Service API for adapter lookup by provider kind.
 */
export interface ProviderAdapterRegistryShape {
  /**
   * Resolve the adapter for a specific provider instance id.
   */
  readonly getByInstance: (
    instanceId: ProviderInstanceId,
  ) => Effect.Effect<ProviderAdapterShape<ProviderAdapterError>, ProviderUnsupportedError>;

  /**
   * List instance ids currently routed by this registry.
   */
  readonly listInstances: () => Effect.Effect<ReadonlyArray<ProviderInstanceId>>;

  /**
   * Resolve the adapter for a provider kind.
   */
  readonly getByProvider: (
    provider: ProviderKind | ProviderDriverKind,
  ) => Effect.Effect<ProviderAdapterShape<ProviderAdapterError>, ProviderUnsupportedError>;

  /**
   * List provider kinds currently registered.
   */
  readonly listProviders: () => Effect.Effect<ReadonlyArray<ProviderKind | ProviderDriverKind>>;
}

/**
 * ProviderAdapterRegistry - Service tag for provider adapter lookup.
 */
export class ProviderAdapterRegistry extends Context.Service<
  ProviderAdapterRegistry,
  ProviderAdapterRegistryShape
>()("t3/provider/Services/ProviderAdapterRegistry") {}
