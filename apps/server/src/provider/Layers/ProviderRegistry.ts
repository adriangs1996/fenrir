/**
 * ProviderRegistryLive - Aggregates provider-instance snapshot services.
 *
 * The current Fenrir runtime still only routes the default built-in
 * instances live, but it now projects them through a real instance
 * registry so the rest of the server can migrate toward instance-aware
 * provider state.
 *
 * @module ProviderRegistryLive
 */
import {
  ProviderDriverKind,
  type ProviderInstanceId,
  type ProviderKind,
  type ServerProvider,
  type ServerProviderUpdateState,
} from "@fenrir/contracts";
import { Effect, Equal, Layer, PubSub, Ref, Stream } from "effect";

import { ProviderInstanceRegistryLive } from "./ProviderInstanceRegistry.ts";
import { ProviderInstanceRegistry } from "../Services/ProviderInstanceRegistry.ts";
import { ProviderRegistry, type ProviderRegistryShape } from "../Services/ProviderRegistry.ts";
import {
  CLAUDE_MAINTENANCE,
  CODEX_MAINTENANCE,
  CURSOR_MAINTENANCE,
  makeManualOnlyProviderMaintenanceCapabilities,
  OPENCODE_MAINTENANCE,
  resolveProviderMaintenanceCapabilitiesEffect,
  type ProviderMaintenanceCapabilities,
} from "../providerMaintenance.ts";
import {
  resolveCursorInstanceSettings,
  resolveEffectiveClaudeSettings,
  resolveEffectiveCodexSettings,
  resolveOpenCodeInstanceSettings,
} from "../providerSettings.ts";
import { ServerSettingsService } from "../../serverSettings.ts";

const loadProviders = (
  registry: typeof ProviderInstanceRegistry.Service,
): Effect.Effect<ReadonlyArray<ServerProvider>> =>
  Effect.gen(function* () {
    const liveInstances = yield* registry.listInstances;
    const liveSnapshots = yield* Effect.forEach(
      liveInstances,
      (instance) => instance.snapshot.getSnapshot,
      {
        concurrency: "unbounded",
      },
    );
    const unavailableSnapshots = yield* registry.listUnavailable;
    return [...liveSnapshots, ...unavailableSnapshots];
  });

type MaintenanceActionStateKey = `${ProviderInstanceId}:update`;

function maintenanceActionStateKey(instanceId: ProviderInstanceId): MaintenanceActionStateKey {
  return `${instanceId}:update`;
}

function applyProviderUpdateState(
  provider: ServerProvider,
  updateStates: ReadonlyMap<MaintenanceActionStateKey, ServerProviderUpdateState>,
): ServerProvider {
  const instanceId = provider.instanceId;
  if (!instanceId) {
    return provider;
  }

  const updateState = updateStates.get(maintenanceActionStateKey(instanceId));
  if (!updateState) {
    const { updateState: _updateState, ...withoutUpdateState } = provider;
    return withoutUpdateState;
  }
  return {
    ...provider,
    updateState,
  };
}

export const haveProvidersChanged = (
  previousProviders: ReadonlyArray<ServerProvider>,
  nextProviders: ReadonlyArray<ServerProvider>,
): boolean => !Equal.equals(previousProviders, nextProviders);

export const ProviderRegistryLive = Layer.effect(
  ProviderRegistry,
  Effect.gen(function* () {
    const instanceRegistry = yield* ProviderInstanceRegistry;
    const serverSettings = yield* ServerSettingsService;
    const changesPubSub = yield* Effect.acquireRelease(
      PubSub.unbounded<ReadonlyArray<ServerProvider>>(),
      PubSub.shutdown,
    );
    const maintenanceActionStatesRef = yield* Ref.make<
      ReadonlyMap<MaintenanceActionStateKey, ServerProviderUpdateState>
    >(new Map());
    const providersRef = yield* Ref.make<ReadonlyArray<ServerProvider>>(
      yield* loadProviders(instanceRegistry),
    );

    const applyMaintenanceState = Effect.fn("applyProviderMaintenanceState")(function* (
      providers: ReadonlyArray<ServerProvider>,
    ) {
      const updateStates = yield* Ref.get(maintenanceActionStatesRef);
      return providers.map((provider) => applyProviderUpdateState(provider, updateStates));
    });

    const syncProviders = Effect.fn("syncProviders")(function* (options?: {
      readonly publish?: boolean;
    }) {
      const previousProviders = yield* Ref.get(providersRef);
      const providers = yield* loadProviders(instanceRegistry).pipe(
        Effect.flatMap(applyMaintenanceState),
      );
      yield* Ref.set(providersRef, providers);

      if (options?.publish !== false && haveProvidersChanged(previousProviders, providers)) {
        yield* PubSub.publish(changesPubSub, providers);
      }

      return providers;
    });

    yield* Stream.runForEach(instanceRegistry.streamChanges, () => syncProviders()).pipe(
      Effect.forkScoped,
    );

    const refresh = Effect.fn("refresh")(function* (provider?: ProviderKind | ProviderDriverKind) {
      const liveInstances = yield* instanceRegistry.listInstances;
      const matchingInstances =
        provider === undefined
          ? liveInstances
          : liveInstances.filter((instance) => instance.provider === provider);

      yield* Effect.forEach(matchingInstances, (instance) => instance.snapshot.refresh, {
        concurrency: "unbounded",
        discard: true,
      });

      return yield* syncProviders();
    });

    const refreshInstance = Effect.fn("refreshInstance")(function* (
      instanceId: ProviderInstanceId,
    ) {
      const instance = yield* instanceRegistry.getInstance(instanceId);
      if (instance) {
        yield* instance.snapshot.refresh;
      }
      return yield* syncProviders();
    });

    const resolveCapabilities = Effect.fn("resolveProviderMaintenanceCapabilities")(function* (
      instanceId: ProviderInstanceId,
      provider: ProviderDriverKind,
    ) {
      const settings = yield* serverSettings.getSettings;
      switch (provider) {
        case "codex": {
          const providerSettings = yield* resolveEffectiveCodexSettings(settings, instanceId);
          return yield* resolveProviderMaintenanceCapabilitiesEffect(CODEX_MAINTENANCE, {
            binaryPath: providerSettings.binaryPath,
          });
        }
        case "claudeAgent": {
          const providerSettings = yield* resolveEffectiveClaudeSettings(settings, instanceId);
          return yield* resolveProviderMaintenanceCapabilitiesEffect(CLAUDE_MAINTENANCE, {
            binaryPath: providerSettings.binaryPath,
          });
        }
        case "opencode": {
          const providerSettings = yield* resolveOpenCodeInstanceSettings(settings, instanceId);
          return yield* resolveProviderMaintenanceCapabilitiesEffect(OPENCODE_MAINTENANCE, {
            binaryPath: providerSettings.binaryPath,
          });
        }
        case "cursor": {
          const providerSettings = yield* resolveCursorInstanceSettings(settings, instanceId);
          return yield* resolveProviderMaintenanceCapabilitiesEffect(CURSOR_MAINTENANCE, {
            binaryPath: providerSettings.binaryPath,
          });
        }
        default:
          return makeManualOnlyProviderMaintenanceCapabilities({
            provider,
            packageName: null,
          }) satisfies ProviderMaintenanceCapabilities;
      }
    });

    const setProviderMaintenanceActionState = Effect.fn("setProviderMaintenanceActionState")(
      function* (input: {
        readonly instanceId: ProviderInstanceId;
        readonly action: "update";
        readonly state: ServerProviderUpdateState | null;
      }) {
        yield* Ref.update(maintenanceActionStatesRef, (states) => {
          const next = new Map(states);
          const key = maintenanceActionStateKey(input.instanceId);
          if (input.state) {
            next.set(key, input.state);
          } else {
            next.delete(key);
          }
          return next;
        });
        return yield* syncProviders();
      },
    );

    return {
      getProviders: syncProviders({ publish: false }).pipe(
        Effect.tapError(Effect.logError),
        Effect.orElseSucceed(() => []),
      ),
      refresh: (provider?: ProviderKind) =>
        refresh(provider).pipe(
          Effect.tapError(Effect.logError),
          Effect.orElseSucceed(() => []),
        ),
      refreshInstance: (instanceId) =>
        refreshInstance(instanceId).pipe(
          Effect.tapError(Effect.logError),
          Effect.orElseSucceed(() => []),
        ),
      getProviderMaintenanceCapabilitiesForInstance: (instanceId, provider) =>
        resolveCapabilities(instanceId, provider).pipe(
          Effect.tapError(Effect.logWarning),
          Effect.orElseSucceed(() =>
            makeManualOnlyProviderMaintenanceCapabilities({
              provider,
              packageName: null,
            }),
          ),
        ),
      setProviderMaintenanceActionState,
      get streamChanges() {
        return Stream.fromPubSub(changesPubSub);
      },
    } satisfies ProviderRegistryShape;
  }),
).pipe(Layer.provideMerge(ProviderInstanceRegistryLive));
