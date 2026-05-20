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
import type { ProviderKind, ServerProvider } from "@fenrir/contracts";
import { Effect, Equal, Layer, PubSub, Ref, Stream } from "effect";

import { ProviderInstanceRegistryLive } from "./ProviderInstanceRegistry.ts";
import { ProviderInstanceRegistry } from "../Services/ProviderInstanceRegistry.ts";
import { ProviderRegistry, type ProviderRegistryShape } from "../Services/ProviderRegistry.ts";

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

export const haveProvidersChanged = (
  previousProviders: ReadonlyArray<ServerProvider>,
  nextProviders: ReadonlyArray<ServerProvider>,
): boolean => !Equal.equals(previousProviders, nextProviders);

export const ProviderRegistryLive = Layer.effect(
  ProviderRegistry,
  Effect.gen(function* () {
    const instanceRegistry = yield* ProviderInstanceRegistry;
    const changesPubSub = yield* Effect.acquireRelease(
      PubSub.unbounded<ReadonlyArray<ServerProvider>>(),
      PubSub.shutdown,
    );
    const providersRef = yield* Ref.make<ReadonlyArray<ServerProvider>>(
      yield* loadProviders(instanceRegistry),
    );

    const syncProviders = Effect.fn("syncProviders")(function* (options?: {
      readonly publish?: boolean;
    }) {
      const previousProviders = yield* Ref.get(providersRef);
      const providers = yield* loadProviders(instanceRegistry);
      yield* Ref.set(providersRef, providers);

      if (options?.publish !== false && haveProvidersChanged(previousProviders, providers)) {
        yield* PubSub.publish(changesPubSub, providers);
      }

      return providers;
    });

    yield* Stream.runForEach(instanceRegistry.streamChanges, () => syncProviders()).pipe(
      Effect.forkScoped,
    );

    const refresh = Effect.fn("refresh")(function* (provider?: ProviderKind) {
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
      get streamChanges() {
        return Stream.fromPubSub(changesPubSub);
      },
    } satisfies ProviderRegistryShape;
  }),
).pipe(Layer.provideMerge(ProviderInstanceRegistryLive));
