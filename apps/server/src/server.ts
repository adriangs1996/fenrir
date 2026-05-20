import { Effect, Layer } from "effect";
import { FetchHttpClient, HttpRouter, HttpServer } from "effect/unstable/http";

import { ServerConfig } from "./config";
import {
  attachmentsRouteLayer,
  otlpTracesProxyRouteLayer,
  projectFaviconRouteLayer,
  serverEnvironmentRouteLayer,
  fontsRouteLayer,
  staticAndDevRouteLayer,
  trafficLensApiCorsLayer,
  trafficLensIngestRouteLayer,
} from "./http";
import { fixPath } from "./os-jank";
import { websocketRpcRouteLayer } from "./ws";
import { OpenLive } from "./open";
import { layerConfig as SqlitePersistenceLayerLive } from "./persistence/Layers/Sqlite";
import { ServerLifecycleEventsLive } from "./serverLifecycleEvents";
import { AnalyticsServiceLayerLive } from "./telemetry/Layers/AnalyticsService";
import { makeEventNdjsonLogger } from "./provider/Layers/EventNdjsonLogger";
import { ProviderSessionDirectoryLive } from "./provider/Layers/ProviderSessionDirectory";
import { ProviderSessionRuntimeRepositoryLive } from "./persistence/Layers/ProviderSessionRuntime";
import { PlanRunnerRepositoryLive } from "./persistence/Layers/PlanRunnerRepository";
import { makeCodexAdapterLive } from "./provider/Layers/CodexAdapter";
import { makeClaudeAdapterLive } from "./provider/Layers/ClaudeAdapter";
import { makeOpenCodeAdapterLive } from "./provider/Layers/OpenCodeAdapter";
import { ProviderAdapterRegistryLive } from "./provider/Layers/ProviderAdapterRegistry";
import { ProviderInstanceRegistryLive } from "./provider/Layers/ProviderInstanceRegistry";
import { makeProviderServiceLive } from "./provider/Layers/ProviderService";
import { OrchestrationEngineLive } from "./orchestration/Layers/OrchestrationEngine";
import { OrchestrationProjectionPipelineLive } from "./orchestration/Layers/ProjectionPipeline";
import { OrchestrationEventStoreLive } from "./persistence/Layers/OrchestrationEventStore";
import { OrchestrationCommandReceiptRepositoryLive } from "./persistence/Layers/OrchestrationCommandReceipts";
import { CheckpointDiffQueryLive } from "./checkpointing/Layers/CheckpointDiffQuery";
import { OrchestrationProjectionSnapshotQueryLive } from "./orchestration/Layers/ProjectionSnapshotQuery";
import { CheckpointStoreLive } from "./checkpointing/Layers/CheckpointStore";
import { GitCoreLive } from "./git/Layers/GitCore";
import { GitHubCliLive } from "./git/Layers/GitHubCli";
import { RoutingTextGenerationLive } from "./git/Layers/RoutingTextGeneration";
import { TerminalManagerLive } from "./terminal/Layers/Manager";
import { TerminalHistoryManagerLive } from "./terminal/Layers/HistoryManager";
import { TerminalShellResolverLive } from "./terminal/Layers/ShellResolver";
import { TerminalProcessLifecycleLive } from "./terminal/Layers/ProcessLifecycle";
import { TmuxSessionManagerLive } from "./terminal/Layers/TmuxSessionManager";
import { RawTcpListenerServiceLive } from "./raw-tcp/Layers/RawTcpListenerService";
import { TrafficLensServiceLive } from "./traffic-lens/Layers/TrafficLensService";
import { PlanRunnerLive } from "./plan-runner/Layers/PlanRunner";
import { GitManagerLive } from "./git/Layers/GitManager";
import { KeybindingsLive } from "./keybindings";
import { ServerRuntimeStartup, ServerRuntimeStartupLive } from "./serverRuntimeStartup";
import { OrchestrationReactorLive } from "./orchestration/Layers/OrchestrationReactor";
import { RuntimeReceiptBusLive } from "./orchestration/Layers/RuntimeReceiptBus";
import { ProviderRuntimeIngestionLive } from "./orchestration/Layers/ProviderRuntimeIngestion";
import { ProviderCommandReactorLive } from "./orchestration/Layers/ProviderCommandReactor";
import { CheckpointReactorLive } from "./orchestration/Layers/CheckpointReactor";
import { ThreadDeletionReactorLive } from "./orchestration/Layers/ThreadDeletionReactor";
import { SkillProjectReactorLive } from "./orchestration/Layers/SkillProjectReactor";
import { ProviderRegistryLive } from "./provider/Layers/ProviderRegistry";
import { GlobalActionsLive } from "./globalActions";
import { ServerSettingsLive } from "./serverSettings";
import { SkillServiceLive } from "./skill/SkillService";
import { ProjectFaviconResolverLive } from "./project/Layers/ProjectFaviconResolver";
import { SourceControlQueryLive } from "./sourceControl/Layers/SourceControlQuery";
import { SourceControlLive } from "./sourceControl/Layers/SourceControl";
import { SourceControlStatusLive } from "./sourceControl/Layers/SourceControlStatus";
import { SourceControlWorkflowsLive } from "./sourceControl/Layers/SourceControlWorkflows";
import { WorkspaceEntriesLive } from "./workspace/Layers/WorkspaceEntries";
import { WorkspaceFileSystemLive } from "./workspace/Layers/WorkspaceFileSystem";
import { WorkspacePathsLive } from "./workspace/Layers/WorkspacePaths";
import { ProjectSetupScriptRunnerLive } from "./project/Layers/ProjectSetupScriptRunner";
import { ObservabilityLive } from "./observability/Layers/Observability";
import { ProcessDiagnosticsLive } from "./diagnostics/ProcessDiagnostics";
import { ProcessResourceMonitorLive } from "./diagnostics/ProcessResourceMonitor";
import { TraceDiagnosticsLive } from "./diagnostics/TraceDiagnostics";
import { ServerEnvironmentLive } from "./environment/Layers/ServerEnvironment";
import {
  authBearerBootstrapRouteLayer,
  authBootstrapRouteLayer,
  authClientsRevokeOthersRouteLayer,
  authClientsRevokeRouteLayer,
  authClientsRouteLayer,
  authPairingLinksRevokeRouteLayer,
  authPairingLinksRouteLayer,
  authPairingCredentialRouteLayer,
  authSessionRouteLayer,
  authWebSocketTokenRouteLayer,
} from "./auth/http";
import { ServerSecretStoreLive } from "./auth/Layers/ServerSecretStore";
import { ServerAuthLive } from "./auth/Layers/ServerAuth";
import { ImportResolverLive } from "./managedProcess/Layers/ImportResolver";
import { ManagedProcessManagerLive } from "./managedProcess/Layers/Manager";
import { DirectPtyExecutorLive } from "./managedProcess/Layers/DirectPtyExecutor";
import { TmuxExecutorLive } from "./managedProcess/Layers/TmuxExecutor";
import { InstanceStoreLive } from "./managedProcess/Layers/InstanceStore";
import { LogBufferLive } from "./managedProcess/Layers/LogBuffer";
import { ManagedProcessReactorLive } from "./orchestration/Layers/ManagedProcessReactor";
import { TmuxSessionManager } from "./terminal/Services/TmuxSessionManager";

const PtyAdapterLive = Layer.unwrap(
  Effect.gen(function* () {
    if (typeof Bun !== "undefined") {
      const BunPTY = yield* Effect.promise(() => import("./terminal/Layers/BunPTY"));
      return BunPTY.layer;
    } else {
      const NodePTY = yield* Effect.promise(() => import("./terminal/Layers/NodePTY"));
      return NodePTY.layer;
    }
  }),
);

const HttpServerLive = Layer.unwrap(
  Effect.gen(function* () {
    const config = yield* ServerConfig;
    if (typeof Bun !== "undefined") {
      const BunHttpServer = yield* Effect.promise(
        () => import("@effect/platform-bun/BunHttpServer"),
      );
      return BunHttpServer.layer({
        port: config.port,
        ...(config.host ? { hostname: config.host } : {}),
      });
    } else {
      const [NodeHttpServer, NodeHttp] = yield* Effect.all([
        Effect.promise(() => import("@effect/platform-node/NodeHttpServer")),
        Effect.promise(() => import("node:http")),
      ]);
      return NodeHttpServer.layer(NodeHttp.createServer, {
        host: config.host,
        port: config.port,
      });
    }
  }),
);

const PlatformServicesLive = Layer.unwrap(
  Effect.gen(function* () {
    if (typeof Bun !== "undefined") {
      const { layer } = yield* Effect.promise(() => import("@effect/platform-bun/BunServices"));
      return layer;
    } else {
      const { layer } = yield* Effect.promise(() => import("@effect/platform-node/NodeServices"));
      return layer;
    }
  }),
);

const ReactorLayerLive = Layer.empty.pipe(
  Layer.provideMerge(OrchestrationReactorLive),
  Layer.provideMerge(ProviderRuntimeIngestionLive),
  Layer.provideMerge(ProviderCommandReactorLive),
  Layer.provideMerge(CheckpointReactorLive),
  Layer.provideMerge(ThreadDeletionReactorLive),
  Layer.provideMerge(SkillProjectReactorLive),
  Layer.provideMerge(ManagedProcessReactorLive),
  Layer.provideMerge(RuntimeReceiptBusLive),
);

const OrchestrationEventInfrastructureLayerLive = Layer.mergeAll(
  OrchestrationEventStoreLive,
  OrchestrationCommandReceiptRepositoryLive,
);

const OrchestrationProjectionPipelineLayerLive = OrchestrationProjectionPipelineLive.pipe(
  Layer.provide(OrchestrationEventStoreLive),
);

const OrchestrationInfrastructureLayerLive = Layer.mergeAll(
  OrchestrationProjectionSnapshotQueryLive,
  OrchestrationEventInfrastructureLayerLive,
  OrchestrationProjectionPipelineLayerLive,
);

const OrchestrationLayerLive = Layer.mergeAll(
  OrchestrationInfrastructureLayerLive,
  OrchestrationEngineLive.pipe(Layer.provide(OrchestrationInfrastructureLayerLive)),
);

const CheckpointingLayerLive = Layer.empty.pipe(
  Layer.provideMerge(CheckpointDiffQueryLive),
  Layer.provideMerge(CheckpointStoreLive),
);

const ProviderLayerLive = Layer.unwrap(
  Effect.gen(function* () {
    const { providerEventLogPath } = yield* ServerConfig;
    const nativeEventLogger = yield* makeEventNdjsonLogger(providerEventLogPath, {
      stream: "native",
    });
    const canonicalEventLogger = yield* makeEventNdjsonLogger(providerEventLogPath, {
      stream: "canonical",
    });
    const providerSessionDirectoryLayer = ProviderSessionDirectoryLive.pipe(
      Layer.provide(ProviderSessionRuntimeRepositoryLive),
    );
    const codexAdapterLayer = makeCodexAdapterLive(
      nativeEventLogger ? { nativeEventLogger } : undefined,
    );
    const claudeAdapterLayer = makeClaudeAdapterLive(
      nativeEventLogger ? { nativeEventLogger } : undefined,
    );
    const openCodeAdapterLayer = makeOpenCodeAdapterLive(
      nativeEventLogger ? { nativeEventLogger } : undefined,
    );
    const adapterRegistryLayer = ProviderAdapterRegistryLive.pipe(
      Layer.provide(codexAdapterLayer),
      Layer.provide(claudeAdapterLayer),
      Layer.provide(openCodeAdapterLayer),
      Layer.provideMerge(providerSessionDirectoryLayer),
      Layer.provideMerge(ProviderInstanceRegistryLive),
    );
    return makeProviderServiceLive(
      canonicalEventLogger ? { canonicalEventLogger } : undefined,
    ).pipe(Layer.provide(adapterRegistryLayer), Layer.provide(providerSessionDirectoryLayer));
  }),
);

const PersistenceLayerLive = Layer.empty.pipe(
  Layer.provideMerge(PlanRunnerRepositoryLive),
  Layer.provideMerge(SqlitePersistenceLayerLive),
);

const GitManagerLayerLive = GitManagerLive.pipe(
  Layer.provideMerge(ProjectSetupScriptRunnerLive),
  Layer.provideMerge(GitCoreLive),
  Layer.provideMerge(GitHubCliLive),
  Layer.provideMerge(RoutingTextGenerationLive),
);

const GitLayerLive = Layer.empty.pipe(
  Layer.provideMerge(GitManagerLayerLive),
  Layer.provideMerge(GitCoreLive),
);

const SourceControlStatusLayerLive = SourceControlStatusLive.pipe(
  Layer.provide(GitManagerLayerLive),
);

const SourceControlQueryLayerLive = SourceControlQueryLive.pipe(Layer.provideMerge(GitCoreLive));

const SourceControlWorkflowsLayerLive = SourceControlWorkflowsLive.pipe(
  Layer.provideMerge(GitManagerLayerLive),
  Layer.provideMerge(GitCoreLive),
);

const TerminalLayerLive = Layer.mergeAll(
  TerminalManagerLive.pipe(
    Layer.provide(TerminalHistoryManagerLive),
    Layer.provide(TerminalShellResolverLive),
    Layer.provide(TerminalProcessLifecycleLive),
  ),
  TmuxSessionManagerLive,
).pipe(Layer.provide(PtyAdapterLive));

const WorkspaceLayerLive = Layer.mergeAll(
  WorkspacePathsLive,
  WorkspaceEntriesLive.pipe(Layer.provide(WorkspacePathsLive)),
  WorkspaceFileSystemLive.pipe(
    Layer.provide(WorkspacePathsLive),
    Layer.provide(WorkspaceEntriesLive.pipe(Layer.provide(WorkspacePathsLive))),
  ),
);

const AuthLayerLive = ServerAuthLive.pipe(
  Layer.provideMerge(PersistenceLayerLive),
  Layer.provide(ServerSecretStoreLive),
);

/**
 * ManagedProcessLayerLive — selects executor (direct vs tmux) at boot,
 * composes InstanceStore + LogBuffer + Manager + the reactor that bridges
 * lifecycle events into the orchestration domain.
 */
const ManagedProcessExecutorLive = Layer.unwrap(
  Effect.gen(function* () {
    const tmuxSessionManager = yield* TmuxSessionManager;
    const tmuxAvailable = yield* tmuxSessionManager.isTmuxAvailable;
    if (tmuxAvailable) {
      return TmuxExecutorLive;
    }
    return DirectPtyExecutorLive.pipe(
      Layer.provide(PtyAdapterLive),
      Layer.provide(TerminalShellResolverLive),
    ) as Layer.Layer<import("./managedProcess/Services/Executor").Executor>;
  }),
);

const ManagedProcessLayerLive = ManagedProcessManagerLive.pipe(
  Layer.provideMerge(ImportResolverLive),
  Layer.provide(ManagedProcessExecutorLive),
  Layer.provide(InstanceStoreLive),
  Layer.provide(LogBufferLive),
);

const CoreInfrastructureLive = ReactorLayerLive.pipe(
  Layer.provideMerge(ManagedProcessLayerLive),
  Layer.provideMerge(CheckpointingLayerLive),
  Layer.provideMerge(GitLayerLive),
  Layer.provideMerge(OrchestrationLayerLive),
  Layer.provideMerge(ProviderLayerLive),
  Layer.provideMerge(TerminalLayerLive),
  Layer.provideMerge(RawTcpListenerServiceLive),
  Layer.provideMerge(TrafficLensServiceLive),
  Layer.provideMerge(
    PlanRunnerLive.pipe(
      Layer.provideMerge(SourceControlQueryLayerLive),
      Layer.provideMerge(SourceControlWorkflowsLayerLive),
      Layer.provide(OrchestrationLayerLive),
      Layer.provide(ServerSettingsLive),
      Layer.provide(RoutingTextGenerationLive),
      Layer.provide(PersistenceLayerLive),
    ),
  ),
  Layer.provideMerge(PersistenceLayerLive),
  Layer.provideMerge(KeybindingsLive),
);

const CoreDependenciesLive = CoreInfrastructureLive.pipe(
  Layer.provideMerge(ProviderRegistryLive),
  Layer.provideMerge(ServerSettingsLive),
  Layer.provideMerge(GlobalActionsLive),
  Layer.provideMerge(SkillServiceLive),
  Layer.provideMerge(WorkspaceLayerLive),
  Layer.provideMerge(ProjectFaviconResolverLive),
  Layer.provideMerge(SourceControlLive),
  Layer.provideMerge(SourceControlQueryLayerLive),
  Layer.provideMerge(SourceControlStatusLayerLive),
  Layer.provideMerge(SourceControlWorkflowsLayerLive),
  Layer.provideMerge(ServerEnvironmentLive),
  Layer.provideMerge(AuthLayerLive),
);

const RuntimeDependenciesLive = CoreDependenciesLive.pipe(
  Layer.provideMerge(AnalyticsServiceLayerLive),
  Layer.provideMerge(ProcessDiagnosticsLive),
  Layer.provideMerge(ProcessResourceMonitorLive),
  Layer.provideMerge(OpenLive),
  Layer.provideMerge(ServerLifecycleEventsLive),
  Layer.provideMerge(TraceDiagnosticsLive),
);

const RuntimeServicesLive = ServerRuntimeStartupLive.pipe(
  Layer.provideMerge(RuntimeDependenciesLive),
  Layer.provideMerge(OrchestrationLayerLive),
  Layer.provideMerge(ServerSettingsLive),
  Layer.provideMerge(TerminalLayerLive),
  Layer.provideMerge(PersistenceLayerLive),
);

export const makeRoutesLayer = Layer.mergeAll(
  authBearerBootstrapRouteLayer,
  authBootstrapRouteLayer,
  authClientsRevokeOthersRouteLayer,
  authClientsRevokeRouteLayer,
  authClientsRouteLayer,
  authPairingLinksRevokeRouteLayer,
  authPairingLinksRouteLayer,
  authPairingCredentialRouteLayer,
  authSessionRouteLayer,
  authWebSocketTokenRouteLayer,
  attachmentsRouteLayer,
  otlpTracesProxyRouteLayer,
  projectFaviconRouteLayer,
  serverEnvironmentRouteLayer,
  fontsRouteLayer,
  trafficLensIngestRouteLayer,
  staticAndDevRouteLayer,
  websocketRpcRouteLayer,
).pipe(Layer.provide(trafficLensApiCorsLayer));

export const makeServerLayer = Layer.unwrap(
  Effect.gen(function* () {
    const config = yield* ServerConfig;

    fixPath();

    const httpListeningLayer = Layer.effectDiscard(
      Effect.gen(function* () {
        yield* HttpServer.HttpServer;
        const startup = yield* ServerRuntimeStartup;
        yield* startup.markHttpListening;
      }),
    );

    const serverApplicationLayer = Layer.mergeAll(
      HttpRouter.serve(makeRoutesLayer, {
        disableLogger: !config.logWebSocketEvents,
      }),
      httpListeningLayer,
    );

    return serverApplicationLayer.pipe(
      Layer.provide(RuntimeServicesLive),
      Layer.provide(HttpServerLive),
      Layer.provide(ObservabilityLive),
      Layer.provideMerge(FetchHttpClient.layer),
      Layer.provideMerge(PlatformServicesLive),
    );
  }),
);

// Important: Only `ServerConfig` should be provided by the CLI layer!!! Don't let other requirements leak into the launch layer.
export const runServer = Layer.launch(makeServerLayer) satisfies Effect.Effect<
  never,
  any,
  ServerConfig
>;
