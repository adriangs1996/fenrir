import { Schema } from "effect";
import * as Rpc from "effect/unstable/rpc/Rpc";
import * as RpcGroup from "effect/unstable/rpc/RpcGroup";

import { OpenError, OpenInEditorInput } from "./editor";
import { AuthAccessStreamEvent } from "./auth";
import {
  GitActionProgressEvent,
  GitCheckoutInput,
  GitCheckoutResult,
  GitCommandError,
  GitCreateBranchInput,
  GitCreateBranchResult,
  GitCreateWorktreeInput,
  GitCreateWorktreeResult,
  GitInitInput,
  GitListBranchesInput,
  GitListBranchesResult,
  GitManagerServiceError,
  GitPreparePullRequestThreadInput,
  GitPreparePullRequestThreadResult,
  GitPullInput,
  GitPullRequestRefInput,
  GitPullResult,
  GitRemoveWorktreeInput,
  GitResolvePullRequestResult,
  GitRunStackedActionInput,
  GitStatusInput,
  GitStatusResult,
  GitStatusStreamEvent,
} from "./git";
import { KeybindingsConfigError } from "./keybindings";
import {
  ClientOrchestrationCommand,
  GlobalActionsRpcError,
  GlobalScript,
  OrchestrationEvent,
  ORCHESTRATION_WS_METHODS,
  OrchestrationDispatchCommandError,
  OrchestrationGetFullThreadDiffError,
  OrchestrationGetFullThreadDiffInput,
  OrchestrationGetSnapshotError,
  OrchestrationGetSnapshotInput,
  OrchestrationGetTurnDiffError,
  OrchestrationGetTurnDiffInput,
  OrchestrationReplayEventsError,
  OrchestrationReplayEventsInput,
  OrchestrationRpcSchemas,
  ProjectScriptIcon,
} from "./orchestration";
import { TrimmedNonEmptyString } from "./baseSchemas";
import {
  ProjectSearchEntriesError,
  ProjectSearchEntriesInput,
  ProjectSearchEntriesResult,
  ProjectWriteFileError,
  ProjectWriteFileInput,
  ProjectWriteFileResult,
} from "./project";
import {
  TerminalClearInput,
  TerminalCloseInput,
  TerminalError,
  TerminalEvent,
  TerminalOpenInput,
  TerminalResizeInput,
  TerminalRestartInput,
  TerminalSessionSnapshot,
  TerminalWriteInput,
  TmuxAttachInput,
  TmuxDetachInput,
  TmuxError,
  TmuxResizeInput,
  TmuxSessionSnapshot,
  TmuxWriteInput,
} from "./terminal";
import {
  CreateListenerInput,
  ListenerSnapshot,
  MetasploitConnectionError,
  MetasploitEvent,
  MetasploitListenerError,
  MetasploitListenerLookupError,
  MetasploitNotFoundError,
  MetasploitSessionError,
  MetasploitStatusSnapshot,
  MsfSessionSnapshot,
  SessionAttachInput,
  SessionAttachOutput,
  SessionCloseInput,
  SessionDetachInput,
  SessionResizeInput,
  SessionUpgradeInput,
  SessionWriteInput,
  StopListenerInput,
} from "./metasploit";
import {
  TrafficLensError,
  TrafficLensEvent,
  TrafficLensEntry,
  TrafficLensDetail,
  TrafficLensNotFoundError,
  TrafficLensQueryInput,
  TrafficLensReplayInput,
  TrafficLensReplayResponse,
} from "./trafficLens";
import {
  PlanRunnerStartInput,
  PlanRunnerStartResult,
  PlanRunnerGetStatusInput,
  PlanRunSnapshot,
  PlanRunnerCancelInput,
  PlanRunnerError,
  PlanRunnerNotFoundError,
  PlanRunnerEvent,
  PlanRunnerListFeaturesInput,
  PlanRunnerListFeaturesResult,
  PlanRunnerGetFeaturePlansInput,
  PlanRunnerGetFeaturePlansResult,
  PlanRunnerGetFeatureRunInput,
  PlanRunnerGetFeatureRunResult,
  PlanRunnerListRunsInput,
  PlanRunnerListRunsResult,
  PlanRunnerGetStepLogInput,
  PlanRunnerGetStepLogResult,
} from "./planRunner";
import {
  ServerConfigStreamEvent,
  ServerConfig,
  ServerLifecycleStreamEvent,
  ServerProviderUpdatedPayload,
  ServerUpsertKeybindingInput,
  ServerUpsertKeybindingResult,
} from "./server";
import { ServerSettings, ServerSettingsError, ServerSettingsPatch } from "./settings";
export const WS_METHODS = {
  // Project registry methods
  projectsList: "projects.list",
  projectsAdd: "projects.add",
  projectsRemove: "projects.remove",
  projectsSearchEntries: "projects.searchEntries",
  projectsWriteFile: "projects.writeFile",

  // Shell methods
  shellOpenInEditor: "shell.openInEditor",

  // Git methods
  gitPull: "git.pull",
  gitRefreshStatus: "git.refreshStatus",
  gitRunStackedAction: "git.runStackedAction",
  gitListBranches: "git.listBranches",
  gitCreateWorktree: "git.createWorktree",
  gitRemoveWorktree: "git.removeWorktree",
  gitCreateBranch: "git.createBranch",
  gitCheckout: "git.checkout",
  gitInit: "git.init",
  gitResolvePullRequest: "git.resolvePullRequest",
  gitPreparePullRequestThread: "git.preparePullRequestThread",

  // Terminal methods
  terminalOpen: "terminal.open",
  terminalWrite: "terminal.write",
  terminalResize: "terminal.resize",
  terminalClear: "terminal.clear",
  terminalRestart: "terminal.restart",
  terminalClose: "terminal.close",

  // Server meta
  serverGetConfig: "server.getConfig",
  serverRefreshProviders: "server.refreshProviders",
  serverUpsertKeybinding: "server.upsertKeybinding",
  serverGetSettings: "server.getSettings",
  serverUpdateSettings: "server.updateSettings",
  serverGetGlobalActions: "server.getGlobalActions",
  serverCreateGlobalAction: "server.createGlobalAction",
  serverUpdateGlobalAction: "server.updateGlobalAction",
  serverDeleteGlobalAction: "server.deleteGlobalAction",

  // Streaming subscriptions
  subscribeGitStatus: "subscribeGitStatus",
  subscribeOrchestrationDomainEvents: "subscribeOrchestrationDomainEvents",
  subscribeTerminalEvents: "subscribeTerminalEvents",
  subscribeServerConfig: "subscribeServerConfig",
  subscribeServerLifecycle: "subscribeServerLifecycle",
  subscribeAuthAccess: "subscribeAuthAccess",

  // Tmux manager
  terminalAttachTmux: "terminal.attachTmux",
  terminalDetachTmux: "terminal.detachTmux",
  terminalWriteTmux: "terminal.writeTmux",
  terminalResizeTmux: "terminal.resizeTmux",

  // Metasploit
  metasploitStatus: "metasploit.status",
  metasploitCreateListener: "metasploit.createListener",
  metasploitStopListener: "metasploit.stopListener",
  metasploitListListeners: "metasploit.listListeners",
  metasploitListSessions: "metasploit.listSessions",
  metasploitSessionWrite: "metasploit.sessionWrite",
  metasploitSessionResize: "metasploit.sessionResize",
  metasploitSessionUpgrade: "metasploit.sessionUpgrade",
  metasploitSessionClose: "metasploit.sessionClose",
  metasploitSessionAttach: "metasploit.sessionAttach",
  metasploitSessionDetach: "metasploit.sessionDetach",
  subscribeMetasploitEvents: "subscribeMetasploitEvents",

  // Traffic Lens
  trafficLensGetTraffic: "trafficLens.getTraffic",
  trafficLensGetTrafficDetail: "trafficLens.getTrafficDetail",
  trafficLensClearTraffic: "trafficLens.clearTraffic",
  trafficLensReplayRequest: "trafficLens.replayRequest",
  subscribeTrafficLensEvents: "subscribeTrafficLensEvents",

  // Plan Runner
  planRunnerStart: "planRunner.start",
  planRunnerGetStatus: "planRunner.getStatus",
  planRunnerCancel: "planRunner.cancel",
  subscribePlanRunnerEvents: "subscribePlanRunnerEvents",
  planRunnerListFeatures: "planRunner.listFeatures",
  planRunnerGetFeaturePlans: "planRunner.getFeaturePlans",
  planRunnerGetFeatureRun: "planRunner.getFeatureRun",
  planRunnerListRuns: "planRunner.listRuns",
  planRunnerGetStepLog: "planRunner.getStepLog",
} as const;

export const WsServerUpsertKeybindingRpc = Rpc.make(WS_METHODS.serverUpsertKeybinding, {
  payload: ServerUpsertKeybindingInput,
  success: ServerUpsertKeybindingResult,
  error: KeybindingsConfigError,
});

export const WsServerGetConfigRpc = Rpc.make(WS_METHODS.serverGetConfig, {
  payload: Schema.Struct({}),
  success: ServerConfig,
  error: Schema.Union([KeybindingsConfigError, ServerSettingsError]),
});

export const WsServerRefreshProvidersRpc = Rpc.make(WS_METHODS.serverRefreshProviders, {
  payload: Schema.Struct({}),
  success: ServerProviderUpdatedPayload,
});

export const WsServerGetSettingsRpc = Rpc.make(WS_METHODS.serverGetSettings, {
  payload: Schema.Struct({}),
  success: ServerSettings,
  error: ServerSettingsError,
});

export const WsServerUpdateSettingsRpc = Rpc.make(WS_METHODS.serverUpdateSettings, {
  payload: Schema.Struct({ patch: ServerSettingsPatch }),
  success: ServerSettings,
  error: ServerSettingsError,
});

export const WsServerGetGlobalActionsRpc = Rpc.make(WS_METHODS.serverGetGlobalActions, {
  payload: Schema.Struct({}),
  success: Schema.Array(GlobalScript),
  error: GlobalActionsRpcError,
});

export const WsServerCreateGlobalActionRpc = Rpc.make(WS_METHODS.serverCreateGlobalAction, {
  payload: Schema.Struct({
    name: Schema.String,
    command: Schema.String,
    icon: ProjectScriptIcon,
  }),
  success: GlobalScript,
  error: GlobalActionsRpcError,
});

export const WsServerUpdateGlobalActionRpc = Rpc.make(WS_METHODS.serverUpdateGlobalAction, {
  payload: Schema.Struct({
    id: TrimmedNonEmptyString,
    name: Schema.String,
    command: Schema.String,
    icon: ProjectScriptIcon,
  }),
  success: GlobalScript,
  error: GlobalActionsRpcError,
});

export const WsServerDeleteGlobalActionRpc = Rpc.make(WS_METHODS.serverDeleteGlobalAction, {
  payload: Schema.Struct({ id: TrimmedNonEmptyString }),
  error: GlobalActionsRpcError,
});

export const WsProjectsSearchEntriesRpc = Rpc.make(WS_METHODS.projectsSearchEntries, {
  payload: ProjectSearchEntriesInput,
  success: ProjectSearchEntriesResult,
  error: ProjectSearchEntriesError,
});

export const WsProjectsWriteFileRpc = Rpc.make(WS_METHODS.projectsWriteFile, {
  payload: ProjectWriteFileInput,
  success: ProjectWriteFileResult,
  error: ProjectWriteFileError,
});

export const WsShellOpenInEditorRpc = Rpc.make(WS_METHODS.shellOpenInEditor, {
  payload: OpenInEditorInput,
  error: OpenError,
});

export const WsSubscribeGitStatusRpc = Rpc.make(WS_METHODS.subscribeGitStatus, {
  payload: GitStatusInput,
  success: GitStatusStreamEvent,
  error: GitManagerServiceError,
  stream: true,
});

export const WsGitPullRpc = Rpc.make(WS_METHODS.gitPull, {
  payload: GitPullInput,
  success: GitPullResult,
  error: GitCommandError,
});

export const WsGitRefreshStatusRpc = Rpc.make(WS_METHODS.gitRefreshStatus, {
  payload: GitStatusInput,
  success: GitStatusResult,
  error: GitManagerServiceError,
});

export const WsGitRunStackedActionRpc = Rpc.make(WS_METHODS.gitRunStackedAction, {
  payload: GitRunStackedActionInput,
  success: GitActionProgressEvent,
  error: GitManagerServiceError,
  stream: true,
});

export const WsGitResolvePullRequestRpc = Rpc.make(WS_METHODS.gitResolvePullRequest, {
  payload: GitPullRequestRefInput,
  success: GitResolvePullRequestResult,
  error: GitManagerServiceError,
});

export const WsGitPreparePullRequestThreadRpc = Rpc.make(WS_METHODS.gitPreparePullRequestThread, {
  payload: GitPreparePullRequestThreadInput,
  success: GitPreparePullRequestThreadResult,
  error: GitManagerServiceError,
});

export const WsGitListBranchesRpc = Rpc.make(WS_METHODS.gitListBranches, {
  payload: GitListBranchesInput,
  success: GitListBranchesResult,
  error: GitCommandError,
});

export const WsGitCreateWorktreeRpc = Rpc.make(WS_METHODS.gitCreateWorktree, {
  payload: GitCreateWorktreeInput,
  success: GitCreateWorktreeResult,
  error: GitCommandError,
});

export const WsGitRemoveWorktreeRpc = Rpc.make(WS_METHODS.gitRemoveWorktree, {
  payload: GitRemoveWorktreeInput,
  error: GitCommandError,
});

export const WsGitCreateBranchRpc = Rpc.make(WS_METHODS.gitCreateBranch, {
  payload: GitCreateBranchInput,
  success: GitCreateBranchResult,
  error: GitCommandError,
});

export const WsGitCheckoutRpc = Rpc.make(WS_METHODS.gitCheckout, {
  payload: GitCheckoutInput,
  success: GitCheckoutResult,
  error: GitCommandError,
});

export const WsGitInitRpc = Rpc.make(WS_METHODS.gitInit, {
  payload: GitInitInput,
  error: GitCommandError,
});

export const WsTerminalOpenRpc = Rpc.make(WS_METHODS.terminalOpen, {
  payload: TerminalOpenInput,
  success: TerminalSessionSnapshot,
  error: TerminalError,
});

export const WsTerminalWriteRpc = Rpc.make(WS_METHODS.terminalWrite, {
  payload: TerminalWriteInput,
  error: TerminalError,
});

export const WsTerminalResizeRpc = Rpc.make(WS_METHODS.terminalResize, {
  payload: TerminalResizeInput,
  error: TerminalError,
});

export const WsTerminalClearRpc = Rpc.make(WS_METHODS.terminalClear, {
  payload: TerminalClearInput,
  error: TerminalError,
});

export const WsTerminalRestartRpc = Rpc.make(WS_METHODS.terminalRestart, {
  payload: TerminalRestartInput,
  success: TerminalSessionSnapshot,
  error: TerminalError,
});

export const WsTerminalCloseRpc = Rpc.make(WS_METHODS.terminalClose, {
  payload: TerminalCloseInput,
  error: TerminalError,
});

export const WsOrchestrationGetSnapshotRpc = Rpc.make(ORCHESTRATION_WS_METHODS.getSnapshot, {
  payload: OrchestrationGetSnapshotInput,
  success: OrchestrationRpcSchemas.getSnapshot.output,
  error: OrchestrationGetSnapshotError,
});

export const WsOrchestrationDispatchCommandRpc = Rpc.make(
  ORCHESTRATION_WS_METHODS.dispatchCommand,
  {
    payload: ClientOrchestrationCommand,
    success: OrchestrationRpcSchemas.dispatchCommand.output,
    error: OrchestrationDispatchCommandError,
  },
);

export const WsOrchestrationGetTurnDiffRpc = Rpc.make(ORCHESTRATION_WS_METHODS.getTurnDiff, {
  payload: OrchestrationGetTurnDiffInput,
  success: OrchestrationRpcSchemas.getTurnDiff.output,
  error: OrchestrationGetTurnDiffError,
});

export const WsOrchestrationGetFullThreadDiffRpc = Rpc.make(
  ORCHESTRATION_WS_METHODS.getFullThreadDiff,
  {
    payload: OrchestrationGetFullThreadDiffInput,
    success: OrchestrationRpcSchemas.getFullThreadDiff.output,
    error: OrchestrationGetFullThreadDiffError,
  },
);

export const WsOrchestrationReplayEventsRpc = Rpc.make(ORCHESTRATION_WS_METHODS.replayEvents, {
  payload: OrchestrationReplayEventsInput,
  success: OrchestrationRpcSchemas.replayEvents.output,
  error: OrchestrationReplayEventsError,
});

export const WsSubscribeOrchestrationDomainEventsRpc = Rpc.make(
  WS_METHODS.subscribeOrchestrationDomainEvents,
  {
    payload: Schema.Struct({}),
    success: OrchestrationEvent,
    stream: true,
  },
);

export const WsSubscribeTerminalEventsRpc = Rpc.make(WS_METHODS.subscribeTerminalEvents, {
  payload: Schema.Struct({}),
  success: TerminalEvent,
  stream: true,
});

export const WsSubscribeServerConfigRpc = Rpc.make(WS_METHODS.subscribeServerConfig, {
  payload: Schema.Struct({}),
  success: ServerConfigStreamEvent,
  error: Schema.Union([KeybindingsConfigError, ServerSettingsError]),
  stream: true,
});

export const WsSubscribeServerLifecycleRpc = Rpc.make(WS_METHODS.subscribeServerLifecycle, {
  payload: Schema.Struct({}),
  success: ServerLifecycleStreamEvent,
  stream: true,
});

export const WsSubscribeAuthAccessRpc = Rpc.make(WS_METHODS.subscribeAuthAccess, {
  payload: Schema.Struct({}),
  success: AuthAccessStreamEvent,
  stream: true,
});

export const WsTerminalAttachTmuxRpc = Rpc.make(WS_METHODS.terminalAttachTmux, {
  payload: TmuxAttachInput,
  success: TmuxSessionSnapshot,
  error: TmuxError,
});

export const WsTerminalDetachTmuxRpc = Rpc.make(WS_METHODS.terminalDetachTmux, {
  payload: TmuxDetachInput,
  error: TmuxError,
});

export const WsTerminalWriteTmuxRpc = Rpc.make(WS_METHODS.terminalWriteTmux, {
  payload: TmuxWriteInput,
  error: TmuxError,
});

export const WsTerminalResizeTmuxRpc = Rpc.make(WS_METHODS.terminalResizeTmux, {
  payload: TmuxResizeInput,
  error: TmuxError,
});

// ─── Metasploit RPCs ────────────────────────────────────────────────────────

export const WsMetasploitStatusRpc = Rpc.make(WS_METHODS.metasploitStatus, {
  payload: Schema.Struct({}),
  success: MetasploitStatusSnapshot,
  error: MetasploitConnectionError,
});

export const WsMetasploitCreateListenerRpc = Rpc.make(WS_METHODS.metasploitCreateListener, {
  payload: CreateListenerInput,
  success: ListenerSnapshot,
  error: Schema.Union([
    MetasploitListenerError,
    MetasploitConnectionError,
    MetasploitNotFoundError,
  ]),
});

export const WsMetasploitStopListenerRpc = Rpc.make(WS_METHODS.metasploitStopListener, {
  payload: StopListenerInput,
  error: MetasploitListenerError,
});

export const WsMetasploitListListenersRpc = Rpc.make(WS_METHODS.metasploitListListeners, {
  payload: Schema.Struct({}),
  success: Schema.Array(ListenerSnapshot),
  error: MetasploitConnectionError,
});

export const WsMetasploitListSessionsRpc = Rpc.make(WS_METHODS.metasploitListSessions, {
  payload: Schema.Struct({}),
  success: Schema.Array(MsfSessionSnapshot),
  error: MetasploitConnectionError,
});

export const WsMetasploitSessionWriteRpc = Rpc.make(WS_METHODS.metasploitSessionWrite, {
  payload: SessionWriteInput,
  error: MetasploitSessionError,
});

export const WsMetasploitSessionResizeRpc = Rpc.make(WS_METHODS.metasploitSessionResize, {
  payload: SessionResizeInput,
  error: MetasploitSessionError,
});

export const WsMetasploitSessionUpgradeRpc = Rpc.make(WS_METHODS.metasploitSessionUpgrade, {
  payload: SessionUpgradeInput,
  success: MsfSessionSnapshot,
  error: Schema.Union([MetasploitSessionError, MetasploitListenerLookupError]),
});

export const WsMetasploitSessionCloseRpc = Rpc.make(WS_METHODS.metasploitSessionClose, {
  payload: SessionCloseInput,
  error: MetasploitSessionError,
});

export const WsMetasploitSessionAttachRpc = Rpc.make(WS_METHODS.metasploitSessionAttach, {
  payload: SessionAttachInput,
  success: SessionAttachOutput,
  error: Schema.Union([MetasploitSessionError, MetasploitConnectionError]),
});

export const WsMetasploitSessionDetachRpc = Rpc.make(WS_METHODS.metasploitSessionDetach, {
  payload: SessionDetachInput,
  error: MetasploitSessionError,
});

export const WsSubscribeMetasploitEventsRpc = Rpc.make(WS_METHODS.subscribeMetasploitEvents, {
  payload: Schema.Struct({}),
  success: MetasploitEvent,
  stream: true,
});

// ─── Traffic Lens RPCs ─────────────────────────────────────────────────────

export const WsTrafficLensGetTrafficRpc = Rpc.make(WS_METHODS.trafficLensGetTraffic, {
  payload: TrafficLensQueryInput,
  success: Schema.Array(TrafficLensEntry),
  error: TrafficLensError,
});

export const WsTrafficLensGetTrafficDetailRpc = Rpc.make(WS_METHODS.trafficLensGetTrafficDetail, {
  payload: Schema.Struct({ id: Schema.Number }),
  success: TrafficLensDetail,
  error: Schema.Union([TrafficLensError, TrafficLensNotFoundError]),
});

export const WsTrafficLensClearTrafficRpc = Rpc.make(WS_METHODS.trafficLensClearTraffic, {
  payload: Schema.Struct({ tabId: Schema.optional(Schema.String) }),
  error: TrafficLensError,
});

export const WsSubscribeTrafficLensEventsRpc = Rpc.make(WS_METHODS.subscribeTrafficLensEvents, {
  payload: Schema.Struct({}),
  success: TrafficLensEvent,
  stream: true,
});

export const WsTrafficLensReplayRequestRpc = Rpc.make(WS_METHODS.trafficLensReplayRequest, {
  payload: TrafficLensReplayInput,
  success: TrafficLensReplayResponse,
  error: TrafficLensError,
});

// ─── Plan Runner RPCs ──────────────────────────────────────────────────────

export const WsPlanRunnerStartRpc = Rpc.make(WS_METHODS.planRunnerStart, {
  payload: PlanRunnerStartInput,
  success: PlanRunnerStartResult,
  error: PlanRunnerError,
});

export const WsPlanRunnerGetStatusRpc = Rpc.make(WS_METHODS.planRunnerGetStatus, {
  payload: PlanRunnerGetStatusInput,
  success: PlanRunSnapshot,
  error: Schema.Union([PlanRunnerError, PlanRunnerNotFoundError]),
});

export const WsPlanRunnerCancelRpc = Rpc.make(WS_METHODS.planRunnerCancel, {
  payload: PlanRunnerCancelInput,
  error: Schema.Union([PlanRunnerError, PlanRunnerNotFoundError]),
});

export const WsSubscribePlanRunnerEventsRpc = Rpc.make(WS_METHODS.subscribePlanRunnerEvents, {
  payload: Schema.Struct({}),
  success: PlanRunnerEvent,
  stream: true,
});

export const WsPlanRunnerListFeaturesRpc = Rpc.make(WS_METHODS.planRunnerListFeatures, {
  payload: PlanRunnerListFeaturesInput,
  success: PlanRunnerListFeaturesResult,
  error: PlanRunnerError,
});

export const WsPlanRunnerGetFeaturePlansRpc = Rpc.make(WS_METHODS.planRunnerGetFeaturePlans, {
  payload: PlanRunnerGetFeaturePlansInput,
  success: PlanRunnerGetFeaturePlansResult,
  error: PlanRunnerError,
});

export const WsPlanRunnerGetFeatureRunRpc = Rpc.make(WS_METHODS.planRunnerGetFeatureRun, {
  payload: PlanRunnerGetFeatureRunInput,
  success: PlanRunnerGetFeatureRunResult,
  error: PlanRunnerError,
});

export const WsPlanRunnerListRunsRpc = Rpc.make(WS_METHODS.planRunnerListRuns, {
  payload: PlanRunnerListRunsInput,
  success: PlanRunnerListRunsResult,
  error: PlanRunnerError,
});

export const WsPlanRunnerGetStepLogRpc = Rpc.make(WS_METHODS.planRunnerGetStepLog, {
  payload: PlanRunnerGetStepLogInput,
  success: PlanRunnerGetStepLogResult,
  error: Schema.Union([PlanRunnerError, PlanRunnerNotFoundError]),
});

export const WsRpcGroup = RpcGroup.make(
  WsServerGetConfigRpc,
  WsServerRefreshProvidersRpc,
  WsServerUpsertKeybindingRpc,
  WsServerGetSettingsRpc,
  WsServerUpdateSettingsRpc,
  WsServerGetGlobalActionsRpc,
  WsServerCreateGlobalActionRpc,
  WsServerUpdateGlobalActionRpc,
  WsServerDeleteGlobalActionRpc,
  WsProjectsSearchEntriesRpc,
  WsProjectsWriteFileRpc,
  WsShellOpenInEditorRpc,
  WsSubscribeGitStatusRpc,
  WsGitPullRpc,
  WsGitRefreshStatusRpc,
  WsGitRunStackedActionRpc,
  WsGitResolvePullRequestRpc,
  WsGitPreparePullRequestThreadRpc,
  WsGitListBranchesRpc,
  WsGitCreateWorktreeRpc,
  WsGitRemoveWorktreeRpc,
  WsGitCreateBranchRpc,
  WsGitCheckoutRpc,
  WsGitInitRpc,
  WsTerminalOpenRpc,
  WsTerminalWriteRpc,
  WsTerminalResizeRpc,
  WsTerminalClearRpc,
  WsTerminalRestartRpc,
  WsTerminalCloseRpc,
  WsSubscribeOrchestrationDomainEventsRpc,
  WsSubscribeTerminalEventsRpc,
  WsSubscribeServerConfigRpc,
  WsSubscribeServerLifecycleRpc,
  WsSubscribeAuthAccessRpc,
  WsOrchestrationGetSnapshotRpc,
  WsOrchestrationDispatchCommandRpc,
  WsOrchestrationGetTurnDiffRpc,
  WsOrchestrationGetFullThreadDiffRpc,
  WsOrchestrationReplayEventsRpc,
  WsTerminalAttachTmuxRpc,
  WsTerminalDetachTmuxRpc,
  WsTerminalWriteTmuxRpc,
  WsTerminalResizeTmuxRpc,
  WsMetasploitStatusRpc,
  WsMetasploitCreateListenerRpc,
  WsMetasploitStopListenerRpc,
  WsMetasploitListListenersRpc,
  WsMetasploitListSessionsRpc,
  WsMetasploitSessionWriteRpc,
  WsMetasploitSessionResizeRpc,
  WsMetasploitSessionUpgradeRpc,
  WsMetasploitSessionCloseRpc,
  WsMetasploitSessionAttachRpc,
  WsMetasploitSessionDetachRpc,
  WsSubscribeMetasploitEventsRpc,
  WsTrafficLensGetTrafficRpc,
  WsTrafficLensGetTrafficDetailRpc,
  WsTrafficLensClearTrafficRpc,
  WsSubscribeTrafficLensEventsRpc,
  WsTrafficLensReplayRequestRpc,
  WsPlanRunnerStartRpc,
  WsPlanRunnerGetStatusRpc,
  WsPlanRunnerCancelRpc,
  WsSubscribePlanRunnerEventsRpc,
  WsPlanRunnerListFeaturesRpc,
  WsPlanRunnerGetFeaturePlansRpc,
  WsPlanRunnerGetFeatureRunRpc,
  WsPlanRunnerListRunsRpc,
  WsPlanRunnerGetStepLogRpc,
);
