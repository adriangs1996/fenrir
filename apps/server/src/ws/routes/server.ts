import { Effect, Stream } from "effect";
import { homedir } from "node:os";

import { GlobalActionsRpcError, ServerClearLogsError, WS_METHODS } from "@fenrir/contracts";

import { ServerConfig } from "../../config";
import { ProcessDiagnostics } from "../../diagnostics/ProcessDiagnostics";
import { ProcessResourceMonitor } from "../../diagnostics/ProcessResourceMonitor";
import { TraceDiagnostics } from "../../diagnostics/TraceDiagnostics";
import { GlobalActionsService } from "../../globalActions";
import { Keybindings } from "../../keybindings";
import { LogMaintenance } from "../../logMaintenance";
import { resolveAvailableEditors } from "../../open";
import { ProviderRegistry } from "../../provider/Services/ProviderRegistry";
import { ProviderMaintenanceRunner } from "../../provider/providerMaintenanceRunner";
import { listProviderSkills } from "../../provider/providerSkills";
import { ServerAuth } from "../../auth/Services/ServerAuth";
import { ServerEnvironment } from "../../environment/Services/ServerEnvironment";
import { ServerLifecycleEvents } from "../../serverLifecycleEvents";
import { ServerSettingsService } from "../../serverSettings";
import { makeRpcDomain } from "../handlers";

export const makeServerRoutes = Effect.gen(function* () {
  const keybindings = yield* Keybindings;
  const providerRegistry = yield* ProviderRegistry;
  const config = yield* ServerConfig;
  const lifecycleEvents = yield* ServerLifecycleEvents;
  const serverSettings = yield* ServerSettingsService;
  const globalActions = yield* GlobalActionsService;
  const serverEnvironment = yield* ServerEnvironment;
  const serverAuth = yield* ServerAuth;
  const processDiagnostics = yield* ProcessDiagnostics;
  const processResourceMonitor = yield* ProcessResourceMonitor;
  const traceDiagnostics = yield* TraceDiagnostics;
  const logMaintenance = yield* LogMaintenance;

  const loadServerConfig = Effect.gen(function* () {
    const keybindingsConfig = yield* keybindings.loadConfigState;
    const providers = yield* providerRegistry.getProviders;
    const settings = yield* serverSettings.getSettings;
    const globalActionsList = yield* globalActions.getAll.pipe(
      Effect.orElseSucceed(() => [] as const),
    );
    const environment = yield* serverEnvironment.getDescriptor;
    const auth = yield* serverAuth.getDescriptor();

    const homeDirectoryPath = homedir().trim();

    return {
      environment,
      auth,
      cwd: config.cwd,
      ...(homeDirectoryPath.length > 0 ? { homeDirectoryPath } : {}),
      keybindingsConfigPath: config.keybindingsConfigPath,
      keybindings: keybindingsConfig.keybindings,
      issues: keybindingsConfig.issues,
      providers,
      availableEditors: resolveAvailableEditors(),
      observability: {
        diagnosticsDirectoryPath: config.logsDir,
        logsDirectoryPath: config.logsDir,
        localTracingEnabled: true,
        ...(config.otlpTracesUrl !== undefined ? { otlpTracesUrl: config.otlpTracesUrl } : {}),
        otlpTracesEnabled: config.otlpTracesUrl !== undefined,
        ...(config.otlpMetricsUrl !== undefined ? { otlpMetricsUrl: config.otlpMetricsUrl } : {}),
        otlpMetricsEnabled: config.otlpMetricsUrl !== undefined,
      },
      settings,
      globalActions: globalActionsList,
    };
  });

  const server = makeRpcDomain("server");

  return {
    [WS_METHODS.serverGetConfig]: server.effect(
      WS_METHODS.serverGetConfig,
      (_input) => loadServerConfig,
    ),
    [WS_METHODS.serverListProviderSkills]: server.effect(
      WS_METHODS.serverListProviderSkills,
      (input) => listProviderSkills(input),
    ),
    [WS_METHODS.serverRefreshProviders]: server.effect(WS_METHODS.serverRefreshProviders, (input) =>
      (input.instanceId
        ? providerRegistry.refreshInstance(input.instanceId)
        : providerRegistry.refresh()
      ).pipe(Effect.map((providers) => ({ providers }))),
    ),
    [WS_METHODS.serverUpdateProvider]: server.effect(WS_METHODS.serverUpdateProvider, (input) =>
      Effect.gen(function* () {
        const providerMaintenanceRunner = yield* ProviderMaintenanceRunner;
        return yield* providerMaintenanceRunner.updateProvider(input);
      }),
    ),
    [WS_METHODS.serverUpsertKeybinding]: server.effect(WS_METHODS.serverUpsertKeybinding, (rule) =>
      Effect.gen(function* () {
        const keybindingsConfig = yield* keybindings.upsertKeybindingRule(rule);
        return { keybindings: keybindingsConfig, issues: [] };
      }),
    ),
    [WS_METHODS.serverRemoveKeybinding]: server.effect(WS_METHODS.serverRemoveKeybinding, (rule) =>
      Effect.gen(function* () {
        const keybindingsConfig = yield* keybindings.removeKeybindingRule(rule);
        return { keybindings: keybindingsConfig, issues: [] };
      }),
    ),
    [WS_METHODS.serverGetTraceDiagnostics]: server.effect(
      WS_METHODS.serverGetTraceDiagnostics,
      (_input) =>
        traceDiagnostics.read({
          traceFilePath: config.serverTracePath,
          maxFiles: config.traceMaxFiles,
        }),
    ),
    [WS_METHODS.serverGetProcessDiagnostics]: server.effect(
      WS_METHODS.serverGetProcessDiagnostics,
      (_input) => processDiagnostics.read,
    ),
    [WS_METHODS.serverGetProcessResourceHistory]: server.effect(
      WS_METHODS.serverGetProcessResourceHistory,
      (input) => processResourceMonitor.readHistory(input),
    ),
    [WS_METHODS.serverSignalProcess]: server.effect(WS_METHODS.serverSignalProcess, (input) =>
      processDiagnostics.signal(input),
    ),
    [WS_METHODS.serverClearLogs]: server.effect(WS_METHODS.serverClearLogs, (_input) =>
      logMaintenance.clearAllLogs.pipe(
        Effect.mapError(
          (e) =>
            new ServerClearLogsError({
              message: e.message.trim() || "Failed to clear application logs.",
              cause: e,
            }),
        ),
      ),
    ),
    [WS_METHODS.serverGetSettings]: server.effect(
      WS_METHODS.serverGetSettings,
      (_input) => serverSettings.getSettings,
    ),
    [WS_METHODS.serverUpdateSettings]: server.effect(WS_METHODS.serverUpdateSettings, ({ patch }) =>
      serverSettings.updateSettings(patch),
    ),
    [WS_METHODS.serverGetGlobalActions]: server.effect(
      WS_METHODS.serverGetGlobalActions,
      (_input) =>
        globalActions.getAll.pipe(
          Effect.mapError((e) => new GlobalActionsRpcError({ message: e.message, cause: e.cause })),
        ),
    ),
    [WS_METHODS.serverCreateGlobalAction]: server.effect(
      WS_METHODS.serverCreateGlobalAction,
      (input) =>
        globalActions
          .create(input)
          .pipe(
            Effect.mapError(
              (e) => new GlobalActionsRpcError({ message: e.message, cause: e.cause }),
            ),
          ),
    ),
    [WS_METHODS.serverUpdateGlobalAction]: server.effect(
      WS_METHODS.serverUpdateGlobalAction,
      ({ id, ...input }) =>
        globalActions
          .update(id, input)
          .pipe(
            Effect.mapError(
              (e) => new GlobalActionsRpcError({ message: e.message, cause: e.cause }),
            ),
          ),
    ),
    [WS_METHODS.serverDeleteGlobalAction]: server.effect(
      WS_METHODS.serverDeleteGlobalAction,
      ({ id }) =>
        globalActions
          .delete(id)
          .pipe(
            Effect.mapError(
              (e) => new GlobalActionsRpcError({ message: e.message, cause: e.cause }),
            ),
          ),
    ),
    [WS_METHODS.subscribeServerConfig]: server.streamEffect(
      WS_METHODS.subscribeServerConfig,
      (_input) =>
        Effect.gen(function* () {
          const keybindingsUpdates = keybindings.streamChanges.pipe(
            Stream.map((event) => ({
              version: 1 as const,
              type: "keybindingsUpdated" as const,
              payload: {
                keybindings: event.keybindings,
                issues: event.issues,
              },
            })),
          );
          const providerStatuses = providerRegistry.streamChanges.pipe(
            Stream.map((providers) => ({
              version: 1 as const,
              type: "providerStatuses" as const,
              payload: { providers },
            })),
          );
          const settingsUpdates = serverSettings.streamChanges.pipe(
            Stream.map((settings) => ({
              version: 1 as const,
              type: "settingsUpdated" as const,
              payload: { settings },
            })),
          );
          const globalActionsUpdates = globalActions.streamChanges.pipe(
            Stream.map((globalActionsList) => ({
              version: 1 as const,
              type: "globalActionsUpdated" as const,
              payload: { globalActions: globalActionsList },
            })),
          );

          return Stream.concat(
            Stream.make({
              version: 1 as const,
              type: "snapshot" as const,
              config: yield* loadServerConfig,
            }),
            Stream.merge(
              keybindingsUpdates,
              Stream.merge(providerStatuses, Stream.merge(settingsUpdates, globalActionsUpdates)),
            ),
          );
        }),
    ),
    [WS_METHODS.subscribeServerLifecycle]: server.streamEffect(
      WS_METHODS.subscribeServerLifecycle,
      (_input) =>
        Effect.gen(function* () {
          const snapshot = yield* lifecycleEvents.snapshot;
          const snapshotEvents = Array.from(snapshot.events).toSorted(
            (left, right) => left.sequence - right.sequence,
          );
          const liveEvents = lifecycleEvents.stream.pipe(
            Stream.filter((event) => event.sequence > snapshot.sequence),
          );
          return Stream.concat(Stream.fromIterable(snapshotEvents), liveEvents);
        }),
    ),
  };
});
