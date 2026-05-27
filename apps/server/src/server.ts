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
  trafficLensStorageIngestRouteLayer,
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
import { ReviewSessionRepositoryLive } from "./persistence/Layers/ReviewSessions";
import { ReviewIgnoreRuleRepositoryLive } from "./persistence/Layers/ReviewIgnoreRules";
import { ReviewAnnotationRepositoryLive } from "./persistence/Layers/ReviewAnnotations";
import { ReviewProgressRepositoryLive } from "./persistence/Layers/ReviewProgress";
import { ReviewAnalysisRepositoryLive } from "./persistence/Layers/ReviewAnalysis";
import { makeCodexAdapterLive } from "./provider/Layers/CodexAdapter";
import { makeClaudeAdapterLive } from "./provider/Layers/ClaudeAdapter";
import { makeCursorAdapterLive } from "./provider/Layers/CursorAdapter";
import { makeOpenCodeAdapterLive } from "./provider/Layers/OpenCodeAdapter";
import { ProviderAdapterRegistryLive } from "./provider/Layers/ProviderAdapterRegistry";
import { ProviderInstanceRegistryLive } from "./provider/Layers/ProviderInstanceRegistry";
import { makeProviderServiceLive } from "./provider/Layers/ProviderService";
import { ProviderSessionReaperLive } from "./provider/Layers/ProviderSessionReaper";
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
import { TrafficLensStorageServiceLive } from "./traffic-lens-storage/Layers/TrafficLensStorageService";
import { BrowserLabControlHttpLive } from "./browserLab/browserLabControlHttp";
import { BrowserLabControlServiceLive } from "./browserLab/Layers/BrowserLabControlService";
import { PlanRunnerLive } from "./plan-runner/Layers/PlanRunner";
import { GitManagerLive } from "./git/Layers/GitManager";
import { GitStatusBroadcasterLive } from "./git/Layers/GitStatusBroadcaster";
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
import { ProviderMaintenanceRunnerLive } from "./provider/providerMaintenanceRunner";
import { GlobalActionsLive } from "./globalActions";
import { ServerSettingsLive } from "./serverSettings";
import { SkillServiceLive } from "./skill/SkillService";
import { ProjectFaviconResolverLive } from "./project/Layers/ProjectFaviconResolver";
import { SourceControlModuleLive } from "./sourceControl/SourceControlModule";
import { ReviewDiffServiceLive } from "./review/Layers/ReviewDiffService";
import { ReviewAnalysisServiceLive } from "./review/Layers/ReviewAnalysisService";
import { ReviewMutationServiceLive } from "./review/Layers/ReviewMutationService";
import { ReviewSessionServiceLive } from "./review/Layers/ReviewSessionService";
import { ReviewWriteServiceLive } from "./review/Layers/ReviewWriteService";
import { ReviewRpcServiceLive } from "./review/Layers/ReviewRpcService";
import { ReviewGitHubPendingDraftRepositoryLive } from "./persistence/Layers/ReviewGitHubDrafts";
import { GitHubReviewProviderLive } from "./review/Layers/GitHubReviewProvider";
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

const ProviderRegistryLayerLive = ProviderRegistryLive.pipe(Layer.provideMerge(ServerSettingsLive));
const ProviderMaintenanceRunnerLayerLive = ProviderMaintenanceRunnerLive.pipe(
  Layer.provide(ProviderRegistryLayerLive),
);

const ProviderSessionDirectoryLayerLive = ProviderSessionDirectoryLive.pipe(
  Layer.provide(ProviderSessionRuntimeRepositoryLive),
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
    const codexAdapterLayer = makeCodexAdapterLive(
      nativeEventLogger ? { nativeEventLogger } : undefined,
    );
    const claudeAdapterLayer = makeClaudeAdapterLive(
      nativeEventLogger ? { nativeEventLogger } : undefined,
    );
    const cursorAdapterLayer = makeCursorAdapterLive(
      nativeEventLogger ? { nativeEventLogger } : undefined,
    );
    const openCodeAdapterLayer = makeOpenCodeAdapterLive(
      nativeEventLogger ? { nativeEventLogger } : undefined,
    );
    const adapterRegistryLayer = ProviderAdapterRegistryLive.pipe(
      Layer.provide(codexAdapterLayer),
      Layer.provide(claudeAdapterLayer),
      Layer.provide(cursorAdapterLayer),
      Layer.provide(openCodeAdapterLayer),
      Layer.provideMerge(ProviderSessionDirectoryLayerLive),
      Layer.provideMerge(ProviderInstanceRegistryLive),
    );
    return makeProviderServiceLive(
      canonicalEventLogger ? { canonicalEventLogger } : undefined,
    ).pipe(
      Layer.provide(adapterRegistryLayer),
      Layer.provideMerge(ProviderSessionDirectoryLayerLive),
    );
  }),
);

const ProviderRuntimeLifecycleLayerLive = ProviderSessionReaperLive.pipe(
  Layer.provideMerge(ProviderLayerLive.pipe(Layer.provideMerge(AnalyticsServiceLayerLive))),
  Layer.provideMerge(ProviderSessionDirectoryLayerLive),
  Layer.provideMerge(OrchestrationLayerLive),
);

const PersistenceLayerLive = Layer.empty.pipe(
  Layer.provideMerge(PlanRunnerRepositoryLive),
  Layer.provideMerge(ReviewSessionRepositoryLive),
  Layer.provideMerge(ReviewAnnotationRepositoryLive),
  Layer.provideMerge(ReviewProgressRepositoryLive),
  Layer.provideMerge(ReviewAnalysisRepositoryLive),
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

const SourceControlLayerLive = SourceControlModuleLive.pipe(
  Layer.provideMerge(GitManagerLayerLive),
  Layer.provideMerge(GitCoreLive),
);

const ReviewDiffDependenciesLive = Layer.mergeAll(
  ReviewIgnoreRuleRepositoryLive.pipe(Layer.provideMerge(PersistenceLayerLive)),
  GitStatusBroadcasterLive.pipe(Layer.provideMerge(GitManagerLayerLive)),
  GitCoreLive,
);

const ReviewGitHubDraftRepositoryLayerLive = ReviewGitHubPendingDraftRepositoryLive.pipe(
  Layer.provideMerge(PersistenceLayerLive),
);

const ReviewProviderLayerLive = GitHubReviewProviderLive.pipe(Layer.provideMerge(GitHubCliLive));

const ReviewDiffLayerLive = ReviewDiffServiceLive.pipe(Layer.provide(ReviewDiffDependenciesLive));

const ReviewSessionRepositoryLayerLive = ReviewSessionRepositoryLive.pipe(
  Layer.provideMerge(PersistenceLayerLive),
);

const ReviewIgnoreRuleRepositoryLayerLive = ReviewIgnoreRuleRepositoryLive.pipe(
  Layer.provideMerge(PersistenceLayerLive),
);

const ReviewMutationLayerLive = ReviewMutationServiceLive.pipe(
  Layer.provideMerge(ReviewSessionRepositoryLayerLive),
  Layer.provideMerge(ReviewIgnoreRuleRepositoryLayerLive),
  Layer.provideMerge(ReviewDiffLayerLive),
  Layer.provideMerge(SourceControlLayerLive),
  Layer.provideMerge(GitCoreLive),
);

const ReviewWriteLayerLive = ReviewWriteServiceLive.pipe(
  Layer.provideMerge(ReviewSessionRepositoryLayerLive),
  Layer.provideMerge(ReviewGitHubDraftRepositoryLayerLive),
  Layer.provideMerge(ReviewDiffLayerLive),
  Layer.provideMerge(ReviewMutationLayerLive),
  Layer.provideMerge(ReviewProviderLayerLive),
  Layer.provideMerge(GitHubCliLive),
);

const ReviewAnnotationRepositoryLayerLive = ReviewAnnotationRepositoryLive.pipe(
  Layer.provideMerge(PersistenceLayerLive),
);

const ReviewProgressRepositoryLayerLive = ReviewProgressRepositoryLive.pipe(
  Layer.provideMerge(PersistenceLayerLive),
);

const ReviewAnalysisRepositoryLayerLive = ReviewAnalysisRepositoryLive.pipe(
  Layer.provideMerge(PersistenceLayerLive),
);

const ReviewAnalysisLayerLive = ReviewAnalysisServiceLive.pipe(
  Layer.provideMerge(ReviewDiffLayerLive),
  Layer.provideMerge(ReviewProviderLayerLive),
  Layer.provideMerge(OrchestrationProjectionSnapshotQueryLive),
);

const ReviewSessionServiceLayerLive = ReviewSessionServiceLive.pipe(
  Layer.provideMerge(ReviewSessionRepositoryLayerLive),
  Layer.provideMerge(SourceControlLayerLive),
  Layer.provideMerge(GitManagerLayerLive),
  Layer.provideMerge(GitCoreLive),
  Layer.provideMerge(OrchestrationProjectionSnapshotQueryLive),
);

const ReviewRpcLayerLive = ReviewRpcServiceLive.pipe(
  Layer.provideMerge(ReviewSessionRepositoryLayerLive),
  Layer.provideMerge(ReviewAnnotationRepositoryLayerLive),
  Layer.provideMerge(ReviewProgressRepositoryLayerLive),
  Layer.provideMerge(ReviewAnalysisRepositoryLayerLive),
  Layer.provideMerge(ReviewDiffLayerLive),
  Layer.provideMerge(ReviewAnalysisLayerLive),
  Layer.provideMerge(ReviewSessionServiceLayerLive),
  Layer.provideMerge(ReviewWriteLayerLive),
  Layer.provideMerge(SourceControlLayerLive),
);

const ReviewLayerLive = Layer.mergeAll(ReviewWriteLayerLive, ReviewRpcLayerLive);

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
  Layer.provideMerge(TrafficLensStorageServiceLive),
  Layer.provideMerge(BrowserLabControlServiceLive),
  Layer.provideMerge(
    PlanRunnerLive.pipe(
      Layer.provideMerge(SourceControlLayerLive),
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
  Layer.provideMerge(ServerSettingsLive),
  Layer.provideMerge(ProviderRegistryLayerLive),
  Layer.provideMerge(ProviderMaintenanceRunnerLayerLive),
  Layer.provideMerge(GlobalActionsLive),
  Layer.provideMerge(SkillServiceLive),
  Layer.provideMerge(WorkspaceLayerLive),
  Layer.provideMerge(ProjectFaviconResolverLive),
  Layer.provideMerge(SourceControlLayerLive),
  Layer.provideMerge(ReviewLayerLive),
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

    const serverApplicationLayer = Layer.mergeAll(
      HttpRouter.serve(makeRoutesLayer, {
        disableLogger: !config.logWebSocketEvents,
      }),
      httpListeningLayer,
    );

    return serverApplicationLayer.pipe(
      Layer.provide(RuntimeServicesLive),
      Layer.provide(ObservabilityLive),
      Layer.provideMerge(FetchHttpClient.layer),
      Layer.provideMerge(PlatformServicesLive),
    );
  }),
);

export const makeServerLayer = makeServerApplicationLayer.pipe(Layer.provide(HttpServerLive));

// Important: Only `ServerConfig` should be provided by the CLI layer!!! Don't let other requirements leak into the launch layer.
export const runServer = Layer.launch(makeServerLayer) satisfies Effect.Effect<
  never,
  any,
  ServerConfig
>;
