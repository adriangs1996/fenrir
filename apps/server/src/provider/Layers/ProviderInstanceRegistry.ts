import {
  DEFAULT_SERVER_SETTINGS,
  defaultInstanceIdForDriver,
  type ModelSelection,
  type ProviderInstanceConfig,
  ProviderInstanceId,
  ProviderDriverKind,
  type ProviderKind,
  type ServerProvider,
  type ServerSettings,
  TextGenerationError,
} from "@fenrir/contracts";
import { deepMerge } from "@fenrir/shared/Struct";
import { Context, Effect, Equal, Layer, PubSub, Ref, Schema, Stream } from "effect";

import { ClaudeProviderLive } from "./ClaudeProvider.ts";
import { CodexProviderLive } from "./CodexProvider.ts";
import { checkCursorProviderStatus, makePendingCursorProvider } from "./CursorProvider.ts";
import { checkOpenCodeProviderStatus, makePendingOpenCodeProvider } from "./OpenCodeProvider.ts";
import { ClaudeTextGenerationLive } from "../../git/Layers/ClaudeTextGeneration.ts";
import { CodexTextGenerationLive } from "../../git/Layers/CodexTextGeneration.ts";
import { OpenCodeTextGenerationLive } from "../../git/Layers/OpenCodeTextGeneration.ts";
import { TextGeneration, type TextGenerationShape } from "../../git/Services/TextGeneration.ts";
import { OpenCodeRuntime, OpenCodeRuntimeLive } from "../opencodeRuntime.ts";
import { BUILT_IN_DRIVERS } from "../builtInDrivers.ts";
import type { BuiltInProviderDriver } from "../ProviderDriver.ts";
import {
  resolveCursorInstanceSettings,
  resolveOpenCodeInstanceSettings,
} from "../providerSettings.ts";
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

type SnapshotSource = CodexProviderShape | ClaudeProviderShape;
const OPENCODE_DRIVER = ProviderDriverKind.make("opencode");
const CURSOR_DRIVER = ProviderDriverKind.make("cursor");

class CodexTextGen extends Context.Service<CodexTextGen, TextGenerationShape>()(
  "t3/provider/Layers/ProviderInstanceRegistry/CodexTextGen",
) {}

class ClaudeTextGen extends Context.Service<ClaudeTextGen, TextGenerationShape>()(
  "t3/provider/Layers/ProviderInstanceRegistry/ClaudeTextGen",
) {}

class OpenCodeTextGen extends Context.Service<OpenCodeTextGen, TextGenerationShape>()(
  "t3/provider/Layers/ProviderInstanceRegistry/OpenCodeTextGen",
) {}

type TextGenerationOperation =
  | "generateCommitMessage"
  | "generatePrContent"
  | "generateBranchName"
  | "generateThreadTitle"
  | "extractDependencies";

function textGenerationProviderForDriver(
  driverKind: string,
  fallback: ModelSelection["provider"],
): ModelSelection["provider"] {
  switch (driverKind) {
    case "codex":
      return "codex";
    case "claudeAgent":
      return "claudeAgent";
    case "opencode":
      return "opencode";
    default:
      return fallback;
  }
}

function bindTextGenerationToInstance(input: {
  readonly instanceId: ProviderInstanceId;
  readonly driverKind: string;
  readonly textGeneration: TextGenerationShape;
}): TextGenerationShape {
  const withInstanceSelection = <T extends { readonly modelSelection: ModelSelection }>(
    request: T,
  ): T =>
    ({
      ...request,
      modelSelection: {
        ...request.modelSelection,
        provider: textGenerationProviderForDriver(
          input.driverKind,
          request.modelSelection.provider,
        ),
        instanceId: input.instanceId,
      },
    }) as T;

  return {
    generateCommitMessage: (request) =>
      input.textGeneration.generateCommitMessage(withInstanceSelection(request)),
    generatePrContent: (request) =>
      input.textGeneration.generatePrContent(withInstanceSelection(request)),
    generateBranchName: (request) =>
      input.textGeneration.generateBranchName(withInstanceSelection(request)),
    generateThreadTitle: (request) =>
      input.textGeneration.generateThreadTitle(withInstanceSelection(request)),
    extractDependencies: (request) =>
      input.textGeneration.extractDependencies(withInstanceSelection(request)),
  } satisfies TextGenerationShape;
}

function makeUnsupportedTextGeneration(input: {
  readonly instanceId: ProviderInstanceId;
  readonly driverKind: string;
}): TextGenerationShape {
  const fail = <A>(operation: TextGenerationOperation): Effect.Effect<A, TextGenerationError> =>
    Effect.fail(
      new TextGenerationError({
        operation,
        detail: `Provider instance '${input.instanceId}' (${input.driverKind}) does not support text generation.`,
      }),
    );

  return {
    generateCommitMessage: () => fail("generateCommitMessage"),
    generatePrContent: () => fail("generatePrContent"),
    generateBranchName: () => fail("generateBranchName"),
    generateThreadTitle: () => fail("generateThreadTitle"),
    extractDependencies: () => fail("extractDependencies"),
  } satisfies TextGenerationShape;
}

function toProviderInstanceConfigMap(
  settings: ServerSettings,
): Partial<Record<ProviderInstanceId, ProviderInstanceConfig>> {
  return settings.providerInstances;
}

function unavailableDriverReason(driver: string): string {
  return `This Fenrir build does not ship the '${driver}' provider driver yet.`;
}

function withProviderInstancePresentation(input: {
  readonly snapshot: ServerProvider;
  readonly instanceId: ProviderInstanceId;
  readonly driverKind: string;
  readonly displayName: string | undefined;
}): ServerProvider {
  return {
    ...input.snapshot,
    instanceId: input.instanceId,
    driver: ProviderDriverKind.make(input.driverKind),
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
      entry.driverKind !== candidate.driverKind ||
      entry.instanceId !== candidate.instanceId ||
      entry.displayName !== candidate.displayName ||
      entry.snapshot !== candidate.snapshot
    );
  });
}

function baseConfigForDriver(
  driver: BuiltInProviderDriver,
  settings: ServerSettings,
): Record<string, unknown> {
  switch (driver.legacyProvider) {
    case "codex":
      return settings.providers.codex as Record<string, unknown>;
    case "claudeAgent":
      return settings.providers.claudeAgent as Record<string, unknown>;
  }
}

function validateBuiltInDriverConfig(input: {
  readonly driver: BuiltInProviderDriver;
  readonly settings: ServerSettings;
  readonly instanceId: ProviderInstanceId;
  readonly entry: ProviderInstanceConfig | undefined;
}): Effect.Effect<void> {
  const decode = Schema.decodeUnknownSync(input.driver.configSchema as never) as (
    value: unknown,
  ) => unknown;
  const merged = deepMerge(baseConfigForDriver(input.driver, input.settings), {
    ...(typeof input.entry?.enabled === "boolean" ? { enabled: input.entry.enabled } : {}),
    ...(input.entry?.config &&
    typeof input.entry.config === "object" &&
    !Array.isArray(input.entry.config)
      ? input.entry.config
      : {}),
  });

  return Effect.sync(() => {
    try {
      decode(merged);
      return { ok: true as const };
    } catch (cause) {
      return { ok: false as const, cause };
    }
  }).pipe(
    Effect.flatMap((result) =>
      result.ok
        ? Effect.void
        : Effect.logWarning("Ignoring invalid provider instance config override", {
            provider: input.driver.legacyProvider,
            driver: input.driver.driverKind,
            instanceId: input.instanceId,
            cause: result.cause,
          }).pipe(Effect.asVoid),
    ),
  );
}

const makeProviderInstanceRegistry = Effect.gen(function* () {
  const codexProvider = yield* CodexProvider;
  const claudeProvider = yield* ClaudeProvider;
  const openCodeRuntime = yield* OpenCodeRuntime;
  const codexTextGeneration = yield* CodexTextGen;
  const claudeTextGeneration = yield* ClaudeTextGen;
  const openCodeTextGeneration = yield* OpenCodeTextGen;
  const serverSettings = yield* ServerSettingsService;
  const changesPubSub = yield* Effect.acquireRelease(PubSub.unbounded<void>(), PubSub.shutdown);

  const snapshotSourceByProvider: Record<ProviderKind, SnapshotSource> = {
    codex: codexProvider,
    claudeAgent: claudeProvider,
  };

  const driverByKind = new Map(BUILT_IN_DRIVERS.map((driver) => [driver.driverKind, driver]));

  const textGenerationForInstance = (
    driverKind: ProviderDriverKind,
    instanceId: ProviderInstanceId,
  ): TextGenerationShape => {
    switch (driverKind) {
      case "codex":
        return bindTextGenerationToInstance({
          instanceId,
          driverKind,
          textGeneration: codexTextGeneration,
        });
      case "claudeAgent":
        return bindTextGenerationToInstance({
          instanceId,
          driverKind,
          textGeneration: claudeTextGeneration,
        });
      case "opencode":
        return bindTextGenerationToInstance({
          instanceId,
          driverKind,
          textGeneration: openCodeTextGeneration,
        });
      default:
        return makeUnsupportedTextGeneration({ instanceId, driverKind });
    }
  };

  const wrapSnapshotShape = (input: {
    readonly provider: ProviderKind;
    readonly driverKind: string;
    readonly instanceId: ProviderInstanceId;
    readonly displayName: string | undefined;
    readonly enabledOverride?: boolean;
  }) => {
    const base = snapshotSourceByProvider[input.provider];
    return {
      getSnapshot: base.getSnapshot.pipe(
        Effect.map((snapshot) =>
          withProviderInstancePresentation({
            snapshot:
              input.enabledOverride === undefined
                ? snapshot
                : { ...snapshot, enabled: input.enabledOverride },
            instanceId: input.instanceId,
            driverKind: input.driverKind,
            displayName: input.displayName,
          }),
        ),
      ),
      refresh: base.refresh.pipe(
        Effect.map((snapshot) =>
          withProviderInstancePresentation({
            snapshot:
              input.enabledOverride === undefined
                ? snapshot
                : { ...snapshot, enabled: input.enabledOverride },
            instanceId: input.instanceId,
            driverKind: input.driverKind,
            displayName: input.displayName,
          }),
        ),
      ),
      get streamChanges() {
        return Stream.map(base.streamChanges, (snapshot) =>
          withProviderInstancePresentation({
            snapshot:
              input.enabledOverride === undefined
                ? snapshot
                : { ...snapshot, enabled: input.enabledOverride },
            instanceId: input.instanceId,
            driverKind: input.driverKind,
            displayName: input.displayName,
          }),
        );
      },
    };
  };

  const buildLiveInstance = Effect.fn("buildProviderLiveInstance")(function* (input: {
    readonly driver: BuiltInProviderDriver;
    readonly settings: ServerSettings;
    readonly instanceId: ProviderInstanceId;
    readonly entry: ProviderInstanceConfig | undefined;
  }) {
    yield* validateBuiltInDriverConfig(input);

    return {
      provider: input.driver.legacyProvider,
      driverKind: input.driver.driverKind,
      instanceId: input.instanceId,
      ...(input.entry?.displayName ? { displayName: input.entry.displayName } : {}),
      textGeneration: textGenerationForInstance(input.driver.driverKind, input.instanceId),
      snapshot: wrapSnapshotShape({
        provider: input.driver.legacyProvider,
        driverKind: input.driver.driverKind,
        instanceId: input.instanceId,
        displayName: input.entry?.displayName,
        ...(input.entry?.enabled !== undefined ? { enabledOverride: input.entry.enabled } : {}),
      }),
    } satisfies ProviderInstanceRecord;
  });

  const buildOpenCodeLiveInstance = (input: {
    readonly instanceId: ProviderInstanceId;
    readonly entry: ProviderInstanceConfig;
  }): ProviderInstanceRecord => ({
    provider: OPENCODE_DRIVER,
    driverKind: OPENCODE_DRIVER,
    instanceId: input.instanceId,
    ...(input.entry.displayName ? { displayName: input.entry.displayName } : {}),
    textGeneration: textGenerationForInstance(OPENCODE_DRIVER, input.instanceId),
    snapshot: {
      getSnapshot: serverSettings.getSettings.pipe(
        Effect.flatMap((settings) =>
          resolveOpenCodeInstanceSettings(settings, input.instanceId).pipe(
            Effect.flatMap((openCodeSettings) =>
              checkOpenCodeProviderStatus(openCodeSettings, process.cwd()).pipe(
                Effect.provideService(OpenCodeRuntime, openCodeRuntime),
              ),
            ),
          ),
        ),
        Effect.catchCause(() =>
          resolveOpenCodeInstanceSettings(
            DEFAULT_SERVER_SETTINGS as ServerSettings,
            input.instanceId,
          ).pipe(
            Effect.flatMap((openCodeSettings) => makePendingOpenCodeProvider(openCodeSettings)),
          ),
        ),
      ),
      refresh: serverSettings.getSettings.pipe(
        Effect.flatMap((settings) =>
          resolveOpenCodeInstanceSettings(settings, input.instanceId).pipe(
            Effect.flatMap((openCodeSettings) =>
              checkOpenCodeProviderStatus(openCodeSettings, process.cwd()).pipe(
                Effect.provideService(OpenCodeRuntime, openCodeRuntime),
              ),
            ),
          ),
        ),
        Effect.catchCause(() =>
          resolveOpenCodeInstanceSettings(
            DEFAULT_SERVER_SETTINGS as ServerSettings,
            input.instanceId,
          ).pipe(
            Effect.flatMap((openCodeSettings) => makePendingOpenCodeProvider(openCodeSettings)),
          ),
        ),
      ),
      streamChanges: Stream.empty,
    },
  });

  const buildCursorLiveInstance = (input: {
    readonly instanceId: ProviderInstanceId;
    readonly entry: ProviderInstanceConfig;
  }): ProviderInstanceRecord => ({
    provider: CURSOR_DRIVER,
    driverKind: CURSOR_DRIVER,
    instanceId: input.instanceId,
    ...(input.entry.displayName ? { displayName: input.entry.displayName } : {}),
    textGeneration: textGenerationForInstance(CURSOR_DRIVER, input.instanceId),
    snapshot: {
      getSnapshot: serverSettings.getSettings.pipe(
        Effect.flatMap((settings) =>
          resolveCursorInstanceSettings(settings, input.instanceId).pipe(
            Effect.flatMap((cursorSettings) =>
              checkCursorProviderStatus(cursorSettings, process.cwd()),
            ),
          ),
        ),
        Effect.catchCause(() =>
          resolveCursorInstanceSettings(
            DEFAULT_SERVER_SETTINGS as ServerSettings,
            input.instanceId,
          ).pipe(Effect.flatMap((cursorSettings) => makePendingCursorProvider(cursorSettings))),
        ),
      ),
      refresh: serverSettings.getSettings.pipe(
        Effect.flatMap((settings) =>
          resolveCursorInstanceSettings(settings, input.instanceId).pipe(
            Effect.flatMap((cursorSettings) =>
              checkCursorProviderStatus(cursorSettings, process.cwd()),
            ),
          ),
        ),
        Effect.catchCause(() =>
          resolveCursorInstanceSettings(
            DEFAULT_SERVER_SETTINGS as ServerSettings,
            input.instanceId,
          ).pipe(Effect.flatMap((cursorSettings) => makePendingCursorProvider(cursorSettings))),
        ),
      ),
      streamChanges: Stream.empty,
    },
  });

  const buildRegistryState = Effect.fn("buildProviderInstanceRegistryState")(
    (settings: ServerSettings) =>
      Effect.gen(function* () {
        const explicitInstances = toProviderInstanceConfigMap(settings);
        const liveEntries: ProviderInstanceRecord[] = [];
        const unavailableInputs: Array<Parameters<typeof buildUnavailableProviderSnapshot>[0]> = [];

        for (const driver of BUILT_IN_DRIVERS) {
          const instanceId = defaultInstanceIdForDriver(driver.driverKind);
          const explicitEntry = explicitInstances[instanceId];
          const entry = explicitEntry?.driver === driver.driverKind ? explicitEntry : undefined;
          liveEntries.push(
            yield* buildLiveInstance({
              driver,
              settings,
              instanceId,
              entry,
            }),
          );
        }

        for (const [rawInstanceId, explicitEntry] of Object.entries(explicitInstances)) {
          if (explicitEntry === undefined) {
            continue;
          }

          const instanceId = ProviderInstanceId.make(rawInstanceId);
          if (rawInstanceId === explicitEntry.driver && driverByKind.has(explicitEntry.driver)) {
            continue;
          }

          const driver = driverByKind.get(explicitEntry.driver);
          if (explicitEntry.driver === CURSOR_DRIVER) {
            liveEntries.push(
              buildCursorLiveInstance({
                instanceId,
                entry: explicitEntry,
              }),
            );
            continue;
          }
          if (explicitEntry.driver === OPENCODE_DRIVER) {
            liveEntries.push(
              buildOpenCodeLiveInstance({
                instanceId,
                entry: explicitEntry,
              }),
            );
            continue;
          }
          if (!driver) {
            unavailableInputs.push({
              driverKind: explicitEntry.driver,
              instanceId,
              checkedAt: new Date().toISOString(),
              reason: unavailableDriverReason(explicitEntry.driver),
              ...(explicitEntry.displayName ? { displayName: explicitEntry.displayName } : {}),
              ...(explicitEntry.accentColor ? { accentColor: explicitEntry.accentColor } : {}),
            });
            continue;
          }

          liveEntries.push(
            yield* buildLiveInstance({
              driver,
              settings,
              instanceId,
              entry: explicitEntry,
            }),
          );
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

const InternalCodexTextGenerationLayer = Layer.effect(
  CodexTextGen,
  Effect.gen(function* () {
    return yield* TextGeneration;
  }),
).pipe(Layer.provide(CodexTextGenerationLive));

const InternalClaudeTextGenerationLayer = Layer.effect(
  ClaudeTextGen,
  Effect.gen(function* () {
    return yield* TextGeneration;
  }),
).pipe(Layer.provide(ClaudeTextGenerationLive));

const InternalOpenCodeTextGenerationLayer = Layer.effect(
  OpenCodeTextGen,
  Effect.gen(function* () {
    return yield* TextGeneration;
  }),
).pipe(Layer.provide(OpenCodeTextGenerationLive));

export const ProviderInstanceRegistryLive = Layer.effect(
  ProviderInstanceRegistry,
  makeProviderInstanceRegistry,
).pipe(
  Layer.provideMerge(CodexProviderLive),
  Layer.provideMerge(ClaudeProviderLive),
  Layer.provideMerge(InternalCodexTextGenerationLayer),
  Layer.provideMerge(InternalClaudeTextGenerationLayer),
  Layer.provideMerge(InternalOpenCodeTextGenerationLayer),
  Layer.provideMerge(OpenCodeRuntimeLive),
);
