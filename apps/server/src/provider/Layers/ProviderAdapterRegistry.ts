/**
 * ProviderAdapterRegistryLive - In-memory provider adapter lookup layer.
 *
 * Binds provider kinds (codex/claudeAgent/...) to concrete adapter services.
 * This layer only performs adapter lookup; it does not route session-scoped
 * calls or own provider lifecycle workflows.
 *
 * @module ProviderAdapterRegistryLive
 */
import {
  defaultInstanceIdForDriver,
  ProviderInstanceId,
  type ProviderKind,
  type ProviderInstanceId as ProviderInstanceIdType,
} from "@fenrir/contracts";
import { Effect, Layer } from "effect";

import { ProviderUnsupportedError, type ProviderAdapterError } from "../Errors.ts";
import type { ProviderAdapterShape } from "../Services/ProviderAdapter.ts";
import {
  ProviderAdapterRegistry,
  type ProviderAdapterRegistryShape,
} from "../Services/ProviderAdapterRegistry.ts";
import { ClaudeAdapter } from "../Services/ClaudeAdapter.ts";
import { CodexAdapter } from "../Services/CodexAdapter.ts";
import { ServerSettingsService } from "../../serverSettings.ts";

function toBuiltInProviderKind(value: string): ProviderKind | undefined {
  return value === "codex" || value === "claudeAgent" ? value : undefined;
}

export interface ProviderAdapterRegistryLiveOptions {
  readonly adapters?: ReadonlyArray<ProviderAdapterShape<ProviderAdapterError>>;
}

const makeProviderAdapterRegistry = Effect.fn("makeProviderAdapterRegistry")(function* (
  options?: ProviderAdapterRegistryLiveOptions,
) {
  const serverSettings = yield* ServerSettingsService;
  const adapters =
    options?.adapters !== undefined
      ? options.adapters
      : [yield* CodexAdapter, yield* ClaudeAdapter];
  const byProvider = new Map(adapters.map((adapter) => [adapter.provider, adapter]));
  const byInstance = new Map<ProviderInstanceIdType, ProviderAdapterShape<ProviderAdapterError>>(
    adapters.map((adapter) => [defaultInstanceIdForDriver(adapter.provider), adapter]),
  );

  const resolveConfiguredInstanceProvider = (
    instanceId: ProviderInstanceIdType,
  ): Effect.Effect<ProviderKind | undefined> =>
    serverSettings.getSettings.pipe(
      Effect.map((settings) => {
        const entry = settings.providerInstances[instanceId];
        if (!entry) {
          return undefined;
        }
        return toBuiltInProviderKind(entry.driver);
      }),
      Effect.orElseSucceed(() => undefined),
    );

  const getByInstance: ProviderAdapterRegistryShape["getByInstance"] = (instanceId) => {
    const adapter = byInstance.get(instanceId);
    if (adapter) {
      return Effect.succeed(adapter);
    }
    return resolveConfiguredInstanceProvider(instanceId).pipe(
      Effect.flatMap((provider) => {
        if (!provider) {
          return Effect.fail(new ProviderUnsupportedError({ provider: instanceId }));
        }
        const configuredAdapter = byProvider.get(provider);
        return configuredAdapter
          ? Effect.succeed(configuredAdapter)
          : Effect.fail(new ProviderUnsupportedError({ provider: instanceId }));
      }),
    );
  };

  const getByProvider: ProviderAdapterRegistryShape["getByProvider"] = (provider) => {
    const adapter = byProvider.get(provider);
    if (!adapter) {
      return Effect.fail(new ProviderUnsupportedError({ provider }));
    }
    return Effect.succeed(adapter);
  };

  const listProviders: ProviderAdapterRegistryShape["listProviders"] = () =>
    Effect.sync(() => Array.from(byProvider.keys()));
  const listInstances: ProviderAdapterRegistryShape["listInstances"] = () =>
    serverSettings.getSettings.pipe(
      Effect.map((settings) => {
        const instanceIds = new Set<string>(Array.from(byInstance.keys()));
        for (const [instanceId, entry] of Object.entries(settings.providerInstances)) {
          if (entry && toBuiltInProviderKind(entry.driver) !== undefined) {
            instanceIds.add(instanceId);
          }
        }
        return Array.from(instanceIds).map((instanceId) =>
          ProviderInstanceId.makeUnsafe(instanceId),
        );
      }),
      Effect.orElseSucceed(() => Array.from(byInstance.keys())),
    );

  return {
    getByInstance,
    listInstances,
    getByProvider,
    listProviders,
  } satisfies ProviderAdapterRegistryShape;
});

export const ProviderAdapterRegistryLive = Layer.effect(
  ProviderAdapterRegistry,
  makeProviderAdapterRegistry(),
);
