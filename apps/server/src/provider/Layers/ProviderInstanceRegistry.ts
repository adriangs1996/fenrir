import {
  defaultInstanceIdForDriver,
  type ProviderInstanceConfig,
  ProviderInstanceId,
  ProviderDriverKind,
  type ProviderKind,
  type ServerProvider,
  type ServerSettings,
} from "@fenrir/contracts";
import { Effect, Equal, Layer, PubSub, Ref, Stream } from "effect";

import { ClaudeProviderLive } from "./ClaudeProvider.ts";
import { CodexProviderLive } from "./CodexProvider.ts";
import { buildUnavailableProviderSnapshot } from "../unavailableProviderSnapshot.ts";
import type { ClaudeProviderShape } from "../Services/ClaudeProvider.ts";
import { ClaudeProvider } from "../Services/ClaudeProvider.ts";
import type { CodexProviderShape } from "../Services/CodexProvider.ts";
import { CodexProvider } from "../Services/CodexProvider.ts";
import {
  ProviderInstanceRegistry,
  type ProviderInstanceRecord,
  type ProviderInstanceRegistryShape,
} from "../Services/ProviderInstanceRegistry.ts";
import { ServerSettingsService } from "../../serverSettings.ts";

const BUILT_IN_PROVIDER_KINDS = [
  "codex",
  "claudeAgent",
] as const satisfies ReadonlyArray<ProviderKind>;

function isBuiltInProviderKind(value: string): value is ProviderKind {
  return value === "codex" || value === "claudeAgent";
}

function toProviderInstanceConfigMap(
  settings: ServerSettings,
): Partial<Record<ProviderInstanceId, ProviderInstanceConfig>> {
  return settings.providerInstances;
}

function unavailableDriverReason(driver: string): string {
  return `This Fenrir build does not ship the '${driver}' provider driver yet.`;
}

function mergeDefaultInstanceConfig(input: {
  readonly provider: ProviderKind;
  readonly explicitEntry: ProviderInstanceConfig | undefined;
}): ProviderInstanceConfig | undefined {
  const explicitEntry = input.explicitEntry;
  if (explicitEntry === undefined) {
    return undefined;
  }
  if (explicitEntry.driver !== input.provider) {
    return undefined;
  }
  return explicitEntry;
}

function withProviderInstancePresentation(input: {
  readonly snapshot: ServerProvider;
  readonly instanceId: ProviderInstanceId;
  readonly driver: ProviderKind;
  readonly displayName: string | undefined;
}): ServerProvider {
  return {
    ...input.snapshot,
    instanceId: input.instanceId,
    driver: ProviderDriverKind.makeUnsafe(input.driver),
    ...(input.displayName ? { displayName: input.displayName } : {}),
  };
}

function haveInstanceRecordsChanged(
  previous: ReadonlyArray<ProviderInstanceRecord>,
  next: ReadonlyArray<ProviderInstanceRecord>,
): boolean {
  if (previous.length !== next.length) {
    return true;
  }
  return previous.some((entry, index) => {
    const candidate = next[index];
    if (candidate === undefined) {
      return true;
    }
    return (
      entry.provider !== candidate.provider ||
      entry.instanceId !== candidate.instanceId ||
      entry.displayName !== candidate.displayName ||
      entry.snapshot !== candidate.snapshot
    );
  });
}

const makeProviderInstanceRegistry = Effect.gen(function* () {
  const codexProvider = yield* CodexProvider;
  const claudeProvider = yield* ClaudeProvider;
  const serverSettings = yield* ServerSettingsService;
  const changesPubSub = yield* Effect.acquireRelease(PubSub.unbounded<void>(), PubSub.shutdown);

  const wrapSnapshotShape = (
    provider: ProviderKind,
    instanceId: ProviderInstanceId,
    displayName: string | undefined,
    base: CodexProviderShape | ClaudeProviderShape,
    enabledOverride?: boolean,
  ) => ({
    getSnapshot: base.getSnapshot.pipe(
      Effect.map((snapshot) =>
        withProviderInstancePresentation({
          snapshot:
            enabledOverride === undefined ? snapshot : { ...snapshot, enabled: enabledOverride },
          instanceId,
          driver: provider,
          displayName,
        }),
      ),
    ),
    refresh: base.refresh.pipe(
      Effect.map((snapshot) =>
        withProviderInstancePresentation({
          snapshot:
            enabledOverride === undefined ? snapshot : { ...snapshot, enabled: enabledOverride },
          instanceId,
          driver: provider,
          displayName,
        }),
      ),
    ),
    get streamChanges() {
      return Stream.map(base.streamChanges, (snapshot) =>
        withProviderInstancePresentation({
          snapshot:
            enabledOverride === undefined ? snapshot : { ...snapshot, enabled: enabledOverride },
          instanceId,
          driver: provider,
          displayName,
        }),
      );
    },
  });

  const buildRegistryState = Effect.fn("buildProviderInstanceRegistryState")(
    (settings: ServerSettings) =>
      Effect.gen(function* () {
        const explicitInstances = toProviderInstanceConfigMap(settings);
        const liveEntries: ProviderInstanceRecord[] = [];
        const unavailableInputs: Array<Parameters<typeof buildUnavailableProviderSnapshot>[0]> = [];

        for (const provider of BUILT_IN_PROVIDER_KINDS) {
          const instanceId = defaultInstanceIdForDriver(provider);
          const explicitEntry = mergeDefaultInstanceConfig({
            provider,
            explicitEntry: explicitInstances[instanceId],
          });
          const displayName = explicitEntry?.displayName;
          liveEntries.push({
            provider,
            instanceId,
            ...(displayName ? { displayName } : {}),
            snapshot: wrapSnapshotShape(
              provider,
              instanceId,
              displayName,
              provider === "codex" ? codexProvider : claudeProvider,
            ),
          });
        }

        for (const [rawInstanceId, explicitEntry] of Object.entries(explicitInstances)) {
          if (explicitEntry === undefined) {
            continue;
          }

          const instanceId = ProviderInstanceId.makeUnsafe(rawInstanceId);
          if (
            rawInstanceId === explicitEntry.driver &&
            isBuiltInProviderKind(explicitEntry.driver)
          ) {
            continue;
          }

          if (!isBuiltInProviderKind(explicitEntry.driver)) {
            unavailableInputs.push({
              driverKind: explicitEntry.driver,
              instanceId: instanceId as ProviderInstanceId,
              checkedAt: new Date().toISOString(),
              reason: unavailableDriverReason(explicitEntry.driver),
              ...(explicitEntry.displayName ? { displayName: explicitEntry.displayName } : {}),
              ...(explicitEntry.accentColor ? { accentColor: explicitEntry.accentColor } : {}),
            });
            continue;
          }

          liveEntries.push({
            provider: explicitEntry.driver,
            instanceId: instanceId as ProviderInstanceId,
            ...(explicitEntry.displayName ? { displayName: explicitEntry.displayName } : {}),
            snapshot: wrapSnapshotShape(
              explicitEntry.driver,
              instanceId as ProviderInstanceId,
              explicitEntry.displayName,
              explicitEntry.driver === "codex" ? codexProvider : claudeProvider,
              explicitEntry.enabled,
            ),
          });
        }

        const unavailable = yield* Effect.forEach(
          unavailableInputs,
          (entry) => buildUnavailableProviderSnapshot(entry),
          { concurrency: "unbounded" },
        );

        return {
          instances: liveEntries,
          unavailable,
        } as const;
      }),
  );

  const initialSettings = yield* serverSettings.getSettings;
  const initialState = yield* buildRegistryState(initialSettings);
  const instancesRef = yield* Ref.make(initialState.instances);
  const unavailableRef = yield* Ref.make(initialState.unavailable);

  const reconcile = Effect.fn("reconcileProviderInstances")(function* (settings: ServerSettings) {
    const previousInstances = yield* Ref.get(instancesRef);
    const previousUnavailable = yield* Ref.get(unavailableRef);
    const nextState = yield* buildRegistryState(settings);
    yield* Ref.set(instancesRef, nextState.instances);
    yield* Ref.set(unavailableRef, nextState.unavailable);

    if (
      haveInstanceRecordsChanged(previousInstances, nextState.instances) ||
      !Equal.equals(previousUnavailable, nextState.unavailable)
    ) {
      yield* PubSub.publish(changesPubSub, undefined);
    }
  });

  yield* Stream.runForEach(serverSettings.streamChanges, reconcile).pipe(Effect.forkScoped);
  yield* Stream.runForEach(codexProvider.streamChanges, () =>
    PubSub.publish(changesPubSub, undefined),
  ).pipe(Effect.forkScoped);
  yield* Stream.runForEach(claudeProvider.streamChanges, () =>
    PubSub.publish(changesPubSub, undefined),
  ).pipe(Effect.forkScoped);

  return {
    getInstance: (instanceId) =>
      Ref.get(instancesRef).pipe(
        Effect.map((instances) => instances.find((instance) => instance.instanceId === instanceId)),
      ),
    listInstances: Ref.get(instancesRef),
    listUnavailable: Ref.get(unavailableRef),
    get streamChanges() {
      return Stream.fromPubSub(changesPubSub);
    },
  } satisfies ProviderInstanceRegistryShape;
});

export const ProviderInstanceRegistryLive = Layer.effect(
  ProviderInstanceRegistry,
  makeProviderInstanceRegistry,
).pipe(Layer.provideMerge(CodexProviderLive), Layer.provideMerge(ClaudeProviderLive));
