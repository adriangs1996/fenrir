import { defaultInstanceIdForDriver, type ProviderDriverKind } from "@fenrir/contracts";
import { Effect, Layer } from "effect";

import { type ProviderAdapterError, ProviderUnsupportedError } from "../Errors.ts";
import { ClaudeAdapter } from "../Services/ClaudeAdapter.ts";
import { CodexAdapter } from "../Services/CodexAdapter.ts";
import { OpenCodeAdapter } from "../Services/OpenCodeAdapter.ts";
import type { ProviderAdapterShape } from "../Services/ProviderAdapter.ts";
import { ProviderInstanceRegistry } from "../Services/ProviderInstanceRegistry.ts";
import {
  ProviderAdapterRegistry,
  type ProviderAdapterRegistryShape,
} from "../Services/ProviderAdapterRegistry.ts";

const makeProviderAdapterRegistry = Effect.fn("makeProviderAdapterRegistry")(function* () {
  const instanceRegistry = yield* ProviderInstanceRegistry;
  const codexAdapter = yield* CodexAdapter;
  const claudeAdapter = yield* ClaudeAdapter;
  const openCodeAdapter = yield* OpenCodeAdapter;

  const resolveAdapterForDriver = (
    driverKind: string,
  ): Effect.Effect<ProviderAdapterShape<ProviderAdapterError>, ProviderUnsupportedError> => {
    switch (driverKind) {
      case "codex":
        return Effect.succeed(codexAdapter);
      case "claudeAgent":
        return Effect.succeed(claudeAdapter);
      case "opencode":
        return Effect.succeed(openCodeAdapter);
      default:
        return Effect.fail(new ProviderUnsupportedError({ provider: driverKind }));
    }
  };

  const getByInstance: ProviderAdapterRegistryShape["getByInstance"] = (instanceId) => {
    return instanceRegistry
      .getInstance(instanceId)
      .pipe(
        Effect.flatMap((instance) =>
          instance
            ? resolveAdapterForDriver(instance.driverKind)
            : Effect.fail(new ProviderUnsupportedError({ provider: instanceId })),
        ),
      );
  };

  const getByProvider: ProviderAdapterRegistryShape["getByProvider"] = (provider) => {
    const defaultInstanceId = defaultInstanceIdForDriver(provider);
    return instanceRegistry.listInstances.pipe(
      Effect.map((instances) => {
        const direct = instances.find((instance) => instance.instanceId === defaultInstanceId);
        return direct ?? instances.find((instance) => instance.driverKind === provider);
      }),
      Effect.flatMap((instance) =>
        instance
          ? resolveAdapterForDriver(instance.driverKind)
          : Effect.fail(new ProviderUnsupportedError({ provider })),
      ),
      Effect.mapError(() => new ProviderUnsupportedError({ provider })),
    );
  };

  const listProviders: ProviderAdapterRegistryShape["listProviders"] = () =>
    instanceRegistry.listInstances.pipe(
      Effect.map((instances) => {
        const providers = new Set<ProviderDriverKind>();
        for (const instance of instances) {
          providers.add(instance.driverKind);
        }
        return Array.from(providers);
      }),
    );
  const listInstances: ProviderAdapterRegistryShape["listInstances"] = () =>
    instanceRegistry.listInstances.pipe(
      Effect.map((instances) => instances.map((instance) => instance.instanceId)),
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
