import { Effect, Layer } from "effect";
import { FetchHttpClient, HttpRouter, HttpServer } from "effect/unstable/http";

import { ServerConfig, type ServerConfigShape } from "./config";
import {
  attachmentsRouteLayer,
  otlpTracesProxyRouteLayer,
  projectFaviconRouteLayer,
  serverEnvironmentRouteLayer,
  fontsRouteLayer,
  staticAndDevRouteLayer,
  trafficLensApiCorsLayer,
  trafficLensIngestRouteLayer,
  trafficLensStorageIngestRouteLayer,
} from "./http";
import { fixPath } from "./os-jank";
import { nativeUnaryRpcRouteLayer } from "./nativeUnaryRpc";
import { websocketRpcRouteLayer } from "./ws";
import { OpenLive } from "./open";
import { layerConfig as SqlitePersistenceLayerLive } from "./persistence/Layers/Sqlite";
import { ServerLifecycleEventsLive } from "./serverLifecycleEvents";
import { AnalyticsServiceLayerLive } from "./telemetry/Layers/AnalyticsService";
import { PlanRunnerRepositoryLive } from "./persistence/Layers/PlanRunnerRepository";
import { WorkflowRepositoryLive } from "./persistence/Layers/WorkflowRepository";
import {
  ProviderRuntimeLifecycleLive,
  ProviderRuntimeServiceLive,
} from "./provider/ProviderRuntimeModule";
import { OrchestrationEngineLive } from "./orchestration/Layers/OrchestrationEngine";
import { OrchestrationEventRetentionLive } from "./orchestration/Layers/EventRetention";
import { ProjectionStateRepositoryLive } from "./persistence/Layers/ProjectionState";
import { OrchestrationProjectionPipelineLive } from "./orchestration/Layers/ProjectionPipeline";
import { OrchestrationEventStoreLive } from "./persistence/Layers/OrchestrationEventStore";
import { OrchestrationCommandReceiptRepositoryLive } from "./persistence/Layers/OrchestrationCommandReceipts";
import { CheckpointDiffQueryLive } from "./checkpointing/Layers/CheckpointDiffQuery";
import { OrchestrationProjectionSnapshotQueryLive } from "./orchestration/Layers/ProjectionSnapshotQuery";
import { CheckpointStoreLive } from "./checkpointing/Layers/CheckpointStore";
import { GitCoreLive } from "./git/Layers/GitCore";
import { GitDiffCoreLive } from "./git/Layers/GitDiffCore";
import { GitHubCliLive } from "./git/Layers/GitHubCli";
import { RoutingTextGenerationLive } from "./git/Layers/RoutingTextGeneration";
import { TerminalBackendLive } from "./terminal/Layers/Backend";
import { TerminalManagerLive } from "./terminal/Layers/Manager";
import { TerminalHistoryManagerLive } from "./terminal/Layers/HistoryManager";
import { TerminalShellResolverLive } from "./terminal/Layers/ShellResolver";
import { TerminalProcessLifecycleLive } from "./terminal/Layers/ProcessLifecycle";
import { TmuxSessionManagerLive } from "./terminal/Layers/TmuxSessionManager";
import { TmuxControlModeAdapterLive } from "./terminal/Layers/TmuxControlMode";
import { TmuxPaneStreamServiceLive } from "./terminal/Layers/TmuxPaneStreamService";
import { TmuxWorkspaceServiceLive } from "./terminal/Layers/TmuxWorkspaceService";
import { RawTcpListenerServiceLive } from "./raw-tcp/Layers/RawTcpListenerService";
import { RemoteController } from "./puppeteer/Layers/RemoteController";
import { RemoteConnectionManagerLive } from "./puppeteer/Layers/RemoteConnectionManager";
import { TrafficLensServiceLive } from "./traffic-lens/Layers/TrafficLensService";
import { TrafficLensStorageServiceLive } from "./traffic-lens-storage/Layers/TrafficLensStorageService";
import { LocalServerDiscoveryLive } from "./localServers/Layers/LocalServerDiscovery";
import { BrowserLabControlHttpLive } from "./browserLab/browserLabControlHttp";
import { BrowserLabControlServiceLive } from "./browserLab/Layers/BrowserLabControlService";
import { RemoteHostMcpHttpLive } from "./mcp/remoteHostMcpHttp";
import { WorkflowMcpHttpLive } from "./mcp/workflowMcpHttp";
import { PlanRunnerLive } from "./plan-runner/Layers/PlanRunner";
import { WorkflowLive } from "./workflows/Layers/Workflow";
import { GitWorkflowServiceLive } from "./git/Layers/GitWorkflowService";
import { GitManagerLive } from "./git/Layers/GitManager";
import { VcsDriverRegistryLive } from "./vcs/VcsDriverRegistry";
import { layer as VcsProvisioningServiceLive } from "./vcs/VcsProvisioningService";
import { layer as VcsStatusBroadcasterLive } from "./vcs/VcsStatusBroadcaster";
import { KeybindingsLive } from "./keybindings";
import { ServerRuntimeStartup, ServerRuntimeStartupLive } from "./serverRuntimeStartup";
import { OrchestrationReactorLive } from "./orchestration/Layers/OrchestrationReactor";
import { RuntimeReceiptBusLive } from "./orchestration/Layers/RuntimeReceiptBus";
import { ProviderRuntimeIngestionLive } from "./orchestration/Layers/ProviderRuntimeIngestion";
import { ProviderCommandReactorLive } from "./orchestration/Layers/ProviderCommandReactor";
import { CheckpointReactorLive } from "./orchestration/Layers/CheckpointReactor";
import { ThreadDeletionReactorLive } from "./orchestration/Layers/ThreadDeletionReactor";
import { ProviderInstanceRegistryLive } from "./provider/Layers/ProviderInstanceRegistry";
import { ProviderRegistryLive } from "./provider/Layers/ProviderRegistry";
import { ProviderMaintenanceRunnerLive } from "./provider/providerMaintenanceRunner";
import { GlobalActionsLive } from "./globalActions";
import { LogMaintenanceLive } from "./logMaintenance";
import { ServerSettingsLive } from "./serverSettings";
import { ProjectFaviconResolverLive } from "./project/Layers/ProjectFaviconResolver";
import {
  SourceControlModuleLive,
  SourceControlProviderRegistryLive,
} from "./sourceControl/SourceControlModule";
import { SourceControlStackServiceLive } from "./sourceControl/stack/Layers/SourceControlStackService";
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
import { PortlessWrapperLive } from "./managedProcess/Layers/PortlessWrapper";
import { ReadinessProbeLayerLive } from "./managedProcess/Layers/ReadinessProbe";
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

export const makeBunHttpServerOptions = (config: Pick<ServerConfigShape, "host" | "port">) => ({
  port: config.port,
  idleTimeout: 0,
  ...(config.host ? { hostname: config.host } : {}),
});

const HttpServerLive = Layer.unwrap(
  Effect.gen(function* () {
    const config = yield* ServerConfig;
    if (typeof Bun !== "undefined") {
      const BunHttpServer = yield* Effect.promise(
        () => import("@effect/platform-bun/BunHttpServer"),
      );
      return BunHttpServer.layer(makeBunHttpServerOptions(config));
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

const ProviderRegistryLayerLive = ProviderRegistryLive.pipe(Layer.provideMerge(ServerSettingsLive));
const ProviderMaintenanceRunnerLayerLive = ProviderMaintenanceRunnerLive.pipe(
  Layer.provide(ProviderRegistryLayerLive),
);

const ProviderRuntimeLifecycleLayerLive = ProviderRuntimeLifecycleLive.pipe(
  Layer.provideMerge(OrchestrationLayerLive),
);

const TextGenerationLayerLive = RoutingTextGenerationLive.pipe(
  Layer.provideMerge(ProviderInstanceRegistryLive),
);

const PersistenceLayerLive = Layer.empty.pipe(
  Layer.provideMerge(PlanRunnerRepositoryLive),
  Layer.provideMerge(WorkflowRepositoryLive),
  Layer.provideMerge(SqlitePersistenceLayerLive),
);

const GitManagerLayerLive = GitManagerLive.pipe(
  Layer.provideMerge(ProjectSetupScriptRunnerLive),
  Layer.provideMerge(GitCoreLive),
  Layer.provideMerge(GitHubCliLive),
  Layer.provideMerge(TextGenerationLayerLive),
  Layer.provideMerge(SourceControlProviderRegistryLive),
);

const SourceControlLayerLive = SourceControlModuleLive.pipe(
  Layer.provideMerge(GitManagerLayerLive),
  Layer.provideMerge(GitCoreLive),
);

const GitDiffLayerLive = GitDiffCoreLive.pipe(
  Layer.provideMerge(GitCoreLive),
  Layer.provideMerge(SourceControlLayerLive),
);

const GitLayerLive = Layer.empty.pipe(
  Layer.provideMerge(GitManagerLayerLive),
  Layer.provideMerge(GitCoreLive),
  Layer.provideMerge(GitDiffLayerLive),
);

const GitWorkflowLayerLive = GitWorkflowServiceLive.pipe(
  Layer.provideMerge(VcsDriverRegistryLive),
  Layer.provideMerge(GitLayerLive),
);

const VcsLayerLive = Layer.empty.pipe(
  Layer.provideMerge(VcsDriverRegistryLive),
  Layer.provideMerge(VcsProvisioningServiceLive),
  Layer.provideMerge(GitWorkflowLayerLive),
  Layer.provideMerge(VcsStatusBroadcasterLive.pipe(Layer.provide(GitWorkflowLayerLive))),
);

const SourceControlStackLayerLive = SourceControlStackServiceLive.pipe(
  Layer.provideMerge(SourceControlLayerLive),
  Layer.provideMerge(GitWorkflowLayerLive),
  Layer.provideMerge(GitCoreLive),
  Layer.provideMerge(OrchestrationProjectionSnapshotQueryLive),
);

const TerminalRuntimeLayerLive = Layer.mergeAll(
  TerminalManagerLive.pipe(
    Layer.provide(TerminalHistoryManagerLive),
    Layer.provide(TerminalShellResolverLive),
    Layer.provide(TerminalProcessLifecycleLive),
  ),
  TmuxSessionManagerLive,
  TmuxControlModeAdapterLive,
  TmuxPaneStreamServiceLive,
  TmuxWorkspaceServiceLive.pipe(
    Layer.provide(Layer.mergeAll(TmuxControlModeAdapterLive, TmuxPaneStreamServiceLive)),
  ),
).pipe(Layer.provide(PtyAdapterLive));

const TerminalLayerLive = TerminalBackendLive.pipe(Layer.provideMerge(TerminalRuntimeLayerLive));

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
  Layer.provide(PortlessWrapperLive),
  Layer.provide(ReadinessProbeLayerLive),
);

const CoreInfrastructureLive = ReactorLayerLive.pipe(
  Layer.provideMerge(ManagedProcessLayerLive),
  Layer.provideMerge(CheckpointingLayerLive),
  Layer.provideMerge(GitLayerLive),
  Layer.provideMerge(OrchestrationLayerLive),
  Layer.provideMerge(ProviderRuntimeServiceLive),
  Layer.provideMerge(TerminalLayerLive),
  Layer.provideMerge(RawTcpListenerServiceLive),
  Layer.provideMerge(RemoteController.pipe(Layer.provide(RemoteConnectionManagerLive))),
  Layer.provideMerge(TrafficLensServiceLive),
  Layer.provideMerge(TrafficLensStorageServiceLive),
  Layer.provideMerge(LocalServerDiscoveryLive),
  Layer.provideMerge(BrowserLabControlServiceLive),
  Layer.provideMerge(
    PlanRunnerLive.pipe(
      Layer.provideMerge(SourceControlLayerLive),
      Layer.provide(OrchestrationLayerLive),
      Layer.provide(ServerSettingsLive),
      Layer.provide(TextGenerationLayerLive),
      Layer.provide(PersistenceLayerLive),
    ),
  ),
  Layer.provideMerge(
    WorkflowLive.pipe(Layer.provide(OrchestrationLayerLive), Layer.provide(PersistenceLayerLive)),
  ),
  Layer.provideMerge(PersistenceLayerLive),
  Layer.provideMerge(KeybindingsLive),
);

const CoreDependenciesLive = CoreInfrastructureLive.pipe(
  Layer.provideMerge(ServerSettingsLive),
  Layer.provideMerge(ProviderRegistryLayerLive),
  Layer.provideMerge(ProviderMaintenanceRunnerLayerLive),
  Layer.provideMerge(GlobalActionsLive),
  Layer.provideMerge(WorkspaceLayerLive),
  Layer.provideMerge(ProjectFaviconResolverLive),
  Layer.provideMerge(VcsLayerLive),
  Layer.provideMerge(SourceControlLayerLive),
  Layer.provideMerge(SourceControlStackLayerLive),
  Layer.provideMerge(ServerEnvironmentLive),
  Layer.provideMerge(AuthLayerLive),
);

const RuntimeDependenciesLive = CoreDependenciesLive.pipe(
  Layer.provideMerge(AnalyticsServiceLayerLive),
  Layer.provideMerge(ProcessDiagnosticsLive),
  Layer.provideMerge(ProcessResourceMonitorLive),
  Layer.provideMerge(LogMaintenanceLive),
  Layer.provideMerge(OpenLive),
  Layer.provideMerge(ServerLifecycleEventsLive),
  Layer.provideMerge(TraceDiagnosticsLive),
);

const RuntimeServicesLive = ServerRuntimeStartupLive.pipe(
  Layer.provideMerge(RuntimeDependenciesLive),
  Layer.provideMerge(OrchestrationLayerLive),
  Layer.provideMerge(ProviderRuntimeLifecycleLayerLive),
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
  trafficLensStorageIngestRouteLayer,
  BrowserLabControlHttpLive,
  RemoteHostMcpHttpLive,
  WorkflowMcpHttpLive,
  nativeUnaryRpcRouteLayer,
  staticAndDevRouteLayer,
  websocketRpcRouteLayer,
).pipe(Layer.provide(trafficLensApiCorsLayer));

export const makeServerApplicationLayer = Layer.unwrap(
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

    const eventRetentionLayer = OrchestrationEventRetentionLive.pipe(
      Layer.provide(Layer.mergeAll(OrchestrationEventStoreLive, ProjectionStateRepositoryLive)),
    );

    // Bind the HTTP port only after the runtime graph (migrations, projection
    // bootstrap, read-model hydration) has finished building. Hydration runs
    // synchronous SQLite work that blocks the event loop; a port bound before
    // that accepts connections it cannot answer, so clients hang on pending
    // requests instead of getting a clean connection-refused they retry.
    const gatedHttpServerLive = Layer.unwrap(
      Effect.gen(function* () {
        yield* ServerRuntimeStartup;
        return HttpServerLive;
      }),
    );

    const serverApplicationLayer = Layer.mergeAll(
      HttpRouter.serve(makeRoutesLayer, {
        disableLogger: !config.logWebSocketEvents,
      }),
      httpListeningLayer,
      eventRetentionLayer,
    ).pipe(Layer.provide(gatedHttpServerLive));

    return serverApplicationLayer.pipe(
      Layer.provide(RuntimeServicesLive),
      Layer.provide(ObservabilityLive),
      Layer.provideMerge(FetchHttpClient.layer),
      Layer.provideMerge(PlatformServicesLive),
    );
  }),
);

export const makeServerLayer = makeServerApplicationLayer;

// Important: Only `ServerConfig` should be provided by the CLI layer!!! Don't let other requirements leak into the launch layer.
export const runServer = Layer.launch(makeServerLayer) satisfies Effect.Effect<
  never,
  any,
  ServerConfig
>;
