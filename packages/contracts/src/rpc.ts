import { Schema } from "effect";
import * as Rpc from "effect/unstable/rpc/Rpc";
import * as RpcGroup from "effect/unstable/rpc/RpcGroup";

import { OpenError, OpenInEditorInput } from "./editor";
import { AuthAccessStreamEvent } from "./auth";
import { FilesystemBrowseError, FilesystemBrowseInput, FilesystemBrowseResult } from "./filesystem";
import {
  GitActionProgressEvent,
  GitCommandError,
  GitManagerServiceError,
  GitPreparePullRequestThreadInput,
  GitPreparePullRequestThreadResult,
  GitPullRequestRefInput,
  GitResolvePullRequestResult,
  GitRunStackedActionInput,
  VcsCreateRefInput,
  VcsCreateRefResult,
  VcsCreateWorktreeInput,
  VcsCreateWorktreeResult,
  VcsInitInput,
  VcsListRefsInput,
  VcsListRefsResult,
  VcsPullInput,
  VcsPullResult,
  VcsRemoveWorktreeInput,
  VcsStatusInput,
  VcsStatusResult,
  VcsStatusStreamEvent,
  VcsSwitchRefInput,
  VcsSwitchRefResult,
} from "./git";
import { VcsError } from "./vcs";
import { KeybindingsConfigError } from "./keybindings";
import {
  ClientOrchestrationCommand,
  GlobalActionsRpcError,
  GlobalScript,
  ManagedProcess,
  ManagedProcessInstance,
  ManagedProcessRpcError,
  OrchestrationEvent,
  ORCHESTRATION_WS_METHODS,
  OrchestrationDispatchCommandError,
  OrchestrationGetFullThreadDiffError,
  OrchestrationGetFullThreadDiffInput,
  OrchestrationGetBootstrapSnapshotInput,
  OrchestrationGetSnapshotError,
  OrchestrationGetSnapshotInput,
  OrchestrationGetThreadSnapshotInput,
  OrchestrationGetTurnDiffError,
  OrchestrationGetTurnDiffInput,
  OrchestrationReplayEventsError,
  OrchestrationReplayEventsInput,
  OrchestrationRpcSchemas,
  ProjectScriptIcon,
} from "./orchestration";
import { ProjectId, TrimmedNonEmptyString } from "./baseSchemas";
import { ManagedProcessLogServerMessage } from "./managedProcessLog";
import {
  ProjectListEntriesError,
  ProjectListEntriesInput,
  ProjectListEntriesResult,
  ProjectSearchEntriesError,
  ProjectSearchEntriesInput,
  ProjectSearchEntriesResult,
  ProjectWriteFileError,
  ProjectWriteFileInput,
  ProjectWriteFileResult,
} from "./project";
import { ProviderInstanceId } from "./providerInstance";
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
  CreateRawTcpListenerInput,
  RawTcpEvent,
  RawTcpListenerError,
  RawTcpListenerSnapshot,
  RawTcpSessionCloseInput,
  RawTcpSessionError,
  RawTcpSessionSnapshot,
  RawTcpSessionUpgradePtyInput,
  RawTcpSessionWriteInput,
  StopRawTcpListenerInput,
} from "./rawTcpListener";
import {
  TrafficLensArchivedSessionStorageSummary,
  TrafficLensClearPersistedOriginInput,
  TrafficLensDeleteOverrideInput,
  TrafficLensDeleteProfileInput,
  TrafficLensDeleteRuleInput,
  TrafficLensDomStorageEntry,
  TrafficLensDomStorageSnapshot,
  TrafficLensError,
  TrafficLensEvent,
  TrafficLensDetail,
  TrafficLensEntry,
  TrafficLensFinding,
  TrafficLensGetApplicableCookiesInput,
  TrafficLensGetLocalStorageInput,
  TrafficLensGetSessionStorageSnapshotInput,
  TrafficLensGetStorageVersionsInput,
  TrafficLensListFindingsInput,
  TrafficLensListSessionStorageSnapshotsInput,
  TrafficLensListStorageOriginsInput,
  TrafficLensNotFoundError,
  TrafficLensOverride,
  TrafficLensQueryInput,
  TrafficLensReplayInput,
  TrafficLensReplayResponse,
  TrafficLensRule,
  TrafficLensProfile,
  TrafficLensStorageAreaVersion,
  TrafficLensStorageOriginSummary,
  TrafficLensCookieSnapshot,
  TrafficLensUpsertOverrideInput,
  TrafficLensUpsertProfileInput,
  TrafficLensUpsertRuleInput,
  TrafficLensUpdateSessionStorageSnapshotInput,
} from "./trafficLens";
import {
  PlanRunnerStartInput,
  PlanRunnerStartResult,
  PlanRunnerGetStatusInput,
  PlanRunSnapshot,
  PlanRunnerCancelInput,
  PlanRunnerStopInput,
  PlanRunnerResumeInput,
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
  PlanRunnerArchiveFeatureInput,
  PlanRunnerArchiveFeatureResult,
  PlanRunnerUnarchiveFeatureInput,
  PlanRunnerUnarchiveFeatureResult,
  PlanRunnerListArchivedFeaturesInput,
  PlanRunnerListArchivedFeaturesResult,
  PlanRunnerRenameFeatureInput,
  PlanRunnerRenameFeatureResult,
  PlanRunnerRerunFromFailureInput,
} from "./planRunner";
import {
  ServerConfigStreamEvent,
  ServerConfig,
  ServerProcessDiagnosticsResult,
  ServerProcessResourceHistoryInput,
  ServerProcessResourceHistoryResult,
  ServerProviderUpdateError,
  ServerProviderUpdateInput,
  ServerRemoveKeybindingInput,
  ServerRemoveKeybindingResult,
  ServerLifecycleStreamEvent,
  ServerProviderUpdatedPayload,
  ServerSignalProcessInput,
  ServerSignalProcessResult,
  ServerTraceDiagnosticsResult,
  ServerUpsertKeybindingInput,
  ServerUpsertKeybindingResult,
} from "./server";
import { ServerSettings, ServerSettingsError, ServerSettingsPatch } from "./settings";
import {
  SourceControlCloneRepositoryInput,
  SourceControlCloneRepositoryResult,
  SourceControlDiscoveryResult,
  SourceControlPublishRepositoryInput,
  SourceControlPublishRepositoryResult,
  SourceControlRepositoryError,
  SourceControlRepositoryInfo,
  SourceControlRepositoryLookupInput,
} from "./sourceControl";
import {
  CreateSkillInput,
  GetSkillDetailsInput,
  ResolveSkillConflictInput,
  ServerProviderSkill,
  ServerSkillDetails,
  SkillRpcError,
  UpdateSkillInput,
} from "./skill";
import {
  GitHubReviewSnapshot,
  ReviewAnalysisArtifact,
  ReviewActionBlockedError,
  ReviewApplyRawMutationInput,
  ReviewApplyRawMutationResult,
  ReviewCreateLocalAnnotationReplyInput,
  ReviewCreateLocalAnnotationThreadInput,
  ReviewDeleteLocalAnnotationReplyInput,
  ReviewDeleteLocalAnnotationThreadInput,
  ReviewDeleteOverviewNoteInput,
  ReviewDeleteGitHubDraftInput,
  ReviewGenerateAnalysisInput,
  ReviewGetChunkPayloadInput,
  ReviewChunkPayload,
  ReviewGetDiffSnapshotInput,
  ReviewGetFilePatchInput,
  ReviewGetGitHubSnapshotInput,
  ReviewGetOrCreateSessionInput,
  ReviewGetSessionInput,
  ReviewDiffFilePatch,
  ReviewDiffSnapshot,
  ReviewLocalAnnotationReply,
  ReviewLocalAnnotationThread,
  ReviewMutationConflictError,
  ReviewOverviewNote,
  ReviewRefreshProviderDataInput,
  ReviewReplyToGitHubThreadInput,
  ReviewRpcError,
  ReviewSessionSnapshot,
  ReviewSessionSummary,
  ReviewSetLocalThreadResolvedInput,
  ReviewSetModeInput,
  ReviewSetProgressInput,
  ReviewSetScopeInput,
  ReviewStreamEvent,
  ReviewSubmitGitHubDraftInput,
  ReviewUpdateLocalAnnotationReplyInput,
  ReviewUpdateLocalAnnotationThreadInput,
  ReviewUpsertGitHubDraftInput,
  ReviewUpsertOverviewNoteInput,
} from "./sourceControlReview";
export const WS_METHODS = {
  // Project registry methods
  projectsList: "projects.list",
  projectsAdd: "projects.add",
  projectsRemove: "projects.remove",
  projectsListEntries: "projects.listEntries",
  projectsSearchEntries: "projects.searchEntries",
  projectsWriteFile: "projects.writeFile",
  filesystemBrowse: "filesystem.browse",

  // Shell methods
  shellOpenInEditor: "shell.openInEditor",

  // Git methods
  vcsPull: "vcs.pull",
  vcsRefreshStatus: "vcs.refreshStatus",
  vcsListRefs: "vcs.listRefs",
  vcsCreateWorktree: "vcs.createWorktree",
  vcsRemoveWorktree: "vcs.removeWorktree",
  vcsCreateRef: "vcs.createRef",
  vcsSwitchRef: "vcs.switchRef",
  vcsInit: "vcs.init",
  gitRunStackedAction: "git.runStackedAction",
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
  serverUpdateProvider: "server.updateProvider",
  serverUpsertKeybinding: "server.upsertKeybinding",
  serverRemoveKeybinding: "server.removeKeybinding",
  serverGetTraceDiagnostics: "server.getTraceDiagnostics",
  serverGetProcessDiagnostics: "server.getProcessDiagnostics",
  serverGetProcessResourceHistory: "server.getProcessResourceHistory",
  serverSignalProcess: "server.signalProcess",
  serverGetSettings: "server.getSettings",
  serverUpdateSettings: "server.updateSettings",
  serverDiscoverSourceControl: "server.discoverSourceControl",
  serverGetGlobalActions: "server.getGlobalActions",
  serverCreateGlobalAction: "server.createGlobalAction",
  serverUpdateGlobalAction: "server.updateGlobalAction",
  serverDeleteGlobalAction: "server.deleteGlobalAction",

  // Streaming subscriptions
  subscribeVcsStatus: "subscribeVcsStatus",
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

  // Raw TCP Listener
  rawTcpCreateListener: "rawTcp.createListener",
  rawTcpStopListener: "rawTcp.stopListener",
  rawTcpListListeners: "rawTcp.listListeners",
  rawTcpListSessions: "rawTcp.listSessions",
  rawTcpSessionWrite: "rawTcp.sessionWrite",
  rawTcpSessionUpgradePty: "rawTcp.sessionUpgradePty",
  rawTcpSessionClose: "rawTcp.sessionClose",
  subscribeRawTcpEvents: "subscribeRawTcpEvents",

  // Traffic Lens
  trafficLensGetTraffic: "trafficLens.getTraffic",
  trafficLensGetTrafficDetail: "trafficLens.getTrafficDetail",
  trafficLensClearTraffic: "trafficLens.clearTraffic",
  trafficLensReplayRequest: "trafficLens.replayRequest",
  trafficLensListFindings: "trafficLens.listFindings",
  trafficLensListRules: "trafficLens.listRules",
  trafficLensUpsertRule: "trafficLens.upsertRule",
  trafficLensDeleteRule: "trafficLens.deleteRule",
  trafficLensListOverrides: "trafficLens.listOverrides",
  trafficLensUpsertOverride: "trafficLens.upsertOverride",
  trafficLensDeleteOverride: "trafficLens.deleteOverride",
  trafficLensListProfiles: "trafficLens.listProfiles",
  trafficLensUpsertProfile: "trafficLens.upsertProfile",
  trafficLensDeleteProfile: "trafficLens.deleteProfile",
  trafficLensListStorageOrigins: "trafficLens.listStorageOrigins",
  trafficLensGetCookieSnapshot: "trafficLens.getCookieSnapshot",
  trafficLensGetLocalStorageSnapshot: "trafficLens.getLocalStorageSnapshot",
  trafficLensListSessionStorageSnapshots: "trafficLens.listSessionStorageSnapshots",
  trafficLensGetSessionStorageSnapshot: "trafficLens.getSessionStorageSnapshot",
  trafficLensUpdateSessionStorageSnapshot: "trafficLens.updateSessionStorageSnapshot",
  trafficLensGetStorageVersions: "trafficLens.getStorageVersions",
  trafficLensClearPersistedOrigin: "trafficLens.clearPersistedOrigin",
  subscribeTrafficLensEvents: "subscribeTrafficLensEvents",

  // Plan Runner
  planRunnerStart: "planRunner.start",
  planRunnerGetStatus: "planRunner.getStatus",
  planRunnerCancel: "planRunner.cancel",
  planRunnerStop: "planRunner.stop",
  planRunnerResume: "planRunner.resume",
  subscribePlanRunnerEvents: "subscribePlanRunnerEvents",
  planRunnerListFeatures: "planRunner.listFeatures",
  planRunnerGetFeaturePlans: "planRunner.getFeaturePlans",
  planRunnerGetFeatureRun: "planRunner.getFeatureRun",
  planRunnerListRuns: "planRunner.listRuns",
  planRunnerGetStepLog: "planRunner.getStepLog",
  planRunnerArchiveFeature: "planRunner.archiveFeature",
  planRunnerUnarchiveFeature: "planRunner.unarchiveFeature",
  planRunnerListArchivedFeatures: "planRunner.listArchivedFeatures",
  planRunnerRenameFeature: "planRunner.renameFeature",
  planRunnerRerunFromFailure: "planRunner.rerunFromFailure",

  // Managed Process
  managedProcessList: "managedProcess.list",
  managedProcessStart: "managedProcess.start",
  managedProcessStop: "managedProcess.stop",
  managedProcessForceKill: "managedProcess.forceKill",
  managedProcessRestart: "managedProcess.restart",
  managedProcessWriteStdin: "managedProcess.writeStdin",
  managedProcessUpsertDefinition: "managedProcess.upsertDefinition",
  managedProcessDeleteDefinition: "managedProcess.deleteDefinition",
  managedProcessSubscribeLog: "managedProcess.subscribeLog",
  managedProcessProposedImports: "managedProcess.proposedImports",

  // Skills
  serverListSkills: "serverListSkills",
  serverGetSkillDetails: "serverGetSkillDetails",
  serverCreateSkill: "serverCreateSkill",
  serverUpdateSkill: "serverUpdateSkill",
  serverDeleteSkill: "serverDeleteSkill",
  serverResolveSkillConflict: "serverResolveSkillConflict",
  serverSetActiveSkillProject: "serverSetActiveSkillProject",

  // Review
  sourceControlLookupRepository: "sourceControl.lookupRepository",
  sourceControlCloneRepository: "sourceControl.cloneRepository",
  sourceControlPublishRepository: "sourceControl.publishRepository",

  // Review
  sourceControlReviewGetOrCreateSession: "sourceControl.review.getOrCreateSession",
  sourceControlReviewGetSessionSummary: "sourceControl.review.getSessionSummary",
  sourceControlReviewGetSessionSnapshot: "sourceControl.review.getSessionSnapshot",
  sourceControlReviewSetMode: "sourceControl.review.setMode",
  sourceControlReviewSetScope: "sourceControl.review.setScope",
  sourceControlReviewSetProgress: "sourceControl.review.setProgress",
  sourceControlReviewCreateLocalThread: "sourceControl.review.createLocalThread",
  sourceControlReviewUpdateLocalThread: "sourceControl.review.updateLocalThread",
  sourceControlReviewDeleteLocalThread: "sourceControl.review.deleteLocalThread",
  sourceControlReviewSetLocalThreadResolved: "sourceControl.review.setLocalThreadResolved",
  sourceControlReviewCreateLocalReply: "sourceControl.review.createLocalReply",
  sourceControlReviewUpdateLocalReply: "sourceControl.review.updateLocalReply",
  sourceControlReviewDeleteLocalReply: "sourceControl.review.deleteLocalReply",
  sourceControlReviewUpsertOverviewNote: "sourceControl.review.upsertOverviewNote",
  sourceControlReviewDeleteOverviewNote: "sourceControl.review.deleteOverviewNote",
  sourceControlReviewGetDiffSnapshot: "sourceControl.review.getDiffSnapshot",
  sourceControlReviewGetFilePatch: "sourceControl.review.getFilePatch",
  sourceControlReviewGetChunkPayload: "sourceControl.review.getChunkPayload",
  sourceControlReviewGetGitHubSnapshot: "sourceControl.review.getGitHubSnapshot",
  sourceControlReviewUpsertGitHubDraft: "sourceControl.review.upsertGitHubDraft",
  sourceControlReviewApplyRawMutation: "sourceControl.review.applyRawMutation",
  sourceControlReviewDeleteGitHubDraft: "sourceControl.review.deleteGitHubDraft",
  sourceControlReviewReplyToGitHubThread: "sourceControl.review.replyToGitHubThread",
  sourceControlReviewSubmitGitHubDraft: "sourceControl.review.submitGitHubDraft",
  sourceControlReviewRefreshProviderData: "sourceControl.review.refreshProviderData",
  sourceControlReviewGenerateAnalysis: "sourceControl.review.generateAnalysis",
  subscribeSourceControlReviewEvents: "subscribeSourceControlReviewEvents",
} as const;

export const WsServerUpsertKeybindingRpc = Rpc.make(WS_METHODS.serverUpsertKeybinding, {
  payload: ServerUpsertKeybindingInput,
  success: ServerUpsertKeybindingResult,
  error: KeybindingsConfigError,
});

export const WsServerRemoveKeybindingRpc = Rpc.make(WS_METHODS.serverRemoveKeybinding, {
  payload: ServerRemoveKeybindingInput,
  success: ServerRemoveKeybindingResult,
  error: KeybindingsConfigError,
});

export const WsServerGetTraceDiagnosticsRpc = Rpc.make(WS_METHODS.serverGetTraceDiagnostics, {
  payload: Schema.Struct({}),
  success: ServerTraceDiagnosticsResult,
});

export const WsServerGetProcessDiagnosticsRpc = Rpc.make(WS_METHODS.serverGetProcessDiagnostics, {
  payload: Schema.Struct({}),
  success: ServerProcessDiagnosticsResult,
});

export const WsServerGetProcessResourceHistoryRpc = Rpc.make(
  WS_METHODS.serverGetProcessResourceHistory,
  {
    payload: ServerProcessResourceHistoryInput,
    success: ServerProcessResourceHistoryResult,
  },
);

export const WsServerSignalProcessRpc = Rpc.make(WS_METHODS.serverSignalProcess, {
  payload: ServerSignalProcessInput,
  success: ServerSignalProcessResult,
});

export const WsServerGetConfigRpc = Rpc.make(WS_METHODS.serverGetConfig, {
  payload: Schema.Struct({}),
  success: ServerConfig,
  error: Schema.Union([KeybindingsConfigError, ServerSettingsError]),
});

export const WsServerRefreshProvidersRpc = Rpc.make(WS_METHODS.serverRefreshProviders, {
  payload: Schema.Struct({
    instanceId: Schema.optional(ProviderInstanceId),
  }),
  success: ServerProviderUpdatedPayload,
});

export const WsServerUpdateProviderRpc = Rpc.make(WS_METHODS.serverUpdateProvider, {
  payload: ServerProviderUpdateInput,
  success: ServerProviderUpdatedPayload,
  error: ServerProviderUpdateError,
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

export const WsServerDiscoverSourceControlRpc = Rpc.make(WS_METHODS.serverDiscoverSourceControl, {
  payload: Schema.Struct({}),
  success: SourceControlDiscoveryResult,
});

export const WsSourceControlLookupRepositoryRpc = Rpc.make(
  WS_METHODS.sourceControlLookupRepository,
  {
    payload: SourceControlRepositoryLookupInput,
    success: SourceControlRepositoryInfo,
    error: SourceControlRepositoryError,
  },
);

export const WsSourceControlCloneRepositoryRpc = Rpc.make(WS_METHODS.sourceControlCloneRepository, {
  payload: SourceControlCloneRepositoryInput,
  success: SourceControlCloneRepositoryResult,
  error: SourceControlRepositoryError,
});

export const WsSourceControlPublishRepositoryRpc = Rpc.make(
  WS_METHODS.sourceControlPublishRepository,
  {
    payload: SourceControlPublishRepositoryInput,
    success: SourceControlPublishRepositoryResult,
    error: SourceControlRepositoryError,
  },
);

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

export const WsProjectsListEntriesRpc = Rpc.make(WS_METHODS.projectsListEntries, {
  payload: ProjectListEntriesInput,
  success: ProjectListEntriesResult,
  error: ProjectListEntriesError,
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

export const WsFilesystemBrowseRpc = Rpc.make(WS_METHODS.filesystemBrowse, {
  payload: FilesystemBrowseInput,
  success: FilesystemBrowseResult,
  error: FilesystemBrowseError,
});

export const WsSubscribeVcsStatusRpc = Rpc.make(WS_METHODS.subscribeVcsStatus, {
  payload: VcsStatusInput,
  success: VcsStatusStreamEvent,
  error: GitManagerServiceError,
  stream: true,
});

export const WsVcsPullRpc = Rpc.make(WS_METHODS.vcsPull, {
  payload: VcsPullInput,
  success: VcsPullResult,
  error: GitCommandError,
});

export const WsVcsRefreshStatusRpc = Rpc.make(WS_METHODS.vcsRefreshStatus, {
  payload: VcsStatusInput,
  success: VcsStatusResult,
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

export const WsVcsListRefsRpc = Rpc.make(WS_METHODS.vcsListRefs, {
  payload: VcsListRefsInput,
  success: VcsListRefsResult,
  error: GitCommandError,
});

export const WsVcsCreateWorktreeRpc = Rpc.make(WS_METHODS.vcsCreateWorktree, {
  payload: VcsCreateWorktreeInput,
  success: VcsCreateWorktreeResult,
  error: GitCommandError,
});

export const WsVcsRemoveWorktreeRpc = Rpc.make(WS_METHODS.vcsRemoveWorktree, {
  payload: VcsRemoveWorktreeInput,
  error: GitCommandError,
});

export const WsVcsCreateRefRpc = Rpc.make(WS_METHODS.vcsCreateRef, {
  payload: VcsCreateRefInput,
  success: VcsCreateRefResult,
  error: GitCommandError,
});

export const WsVcsSwitchRefRpc = Rpc.make(WS_METHODS.vcsSwitchRef, {
  payload: VcsSwitchRefInput,
  success: VcsSwitchRefResult,
  error: GitCommandError,
});

export const WsVcsInitRpc = Rpc.make(WS_METHODS.vcsInit, {
  payload: VcsInitInput,
  error: VcsError,
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

export const WsOrchestrationGetBootstrapSnapshotRpc = Rpc.make(
  ORCHESTRATION_WS_METHODS.getBootstrapSnapshot,
  {
    payload: OrchestrationGetBootstrapSnapshotInput,
    success: OrchestrationRpcSchemas.getBootstrapSnapshot.output,
    error: OrchestrationGetSnapshotError,
  },
);

export const WsOrchestrationGetArchivedShellSnapshotRpc = Rpc.make(
  ORCHESTRATION_WS_METHODS.getArchivedShellSnapshot,
  {
    payload: OrchestrationRpcSchemas.getArchivedShellSnapshot.input,
    success: OrchestrationRpcSchemas.getArchivedShellSnapshot.output,
    error: OrchestrationGetSnapshotError,
  },
);

export const WsOrchestrationSubscribeShellRpc = Rpc.make(ORCHESTRATION_WS_METHODS.subscribeShell, {
  payload: OrchestrationRpcSchemas.subscribeShell.input,
  success: OrchestrationRpcSchemas.subscribeShell.output,
  error: OrchestrationGetSnapshotError,
  stream: true,
});

export const WsOrchestrationSubscribeManagedProcessesRpc = Rpc.make(
  ORCHESTRATION_WS_METHODS.subscribeManagedProcesses,
  {
    payload: OrchestrationRpcSchemas.subscribeManagedProcesses.input,
    success: OrchestrationRpcSchemas.subscribeManagedProcesses.output,
    error: OrchestrationGetSnapshotError,
    stream: true,
  },
);

export const WsOrchestrationGetSnapshotRpc = Rpc.make(ORCHESTRATION_WS_METHODS.getSnapshot, {
  payload: OrchestrationGetSnapshotInput,
  success: OrchestrationRpcSchemas.getSnapshot.output,
  error: OrchestrationGetSnapshotError,
});

export const WsOrchestrationGetThreadSnapshotRpc = Rpc.make(
  ORCHESTRATION_WS_METHODS.getThreadSnapshot,
  {
    payload: OrchestrationGetThreadSnapshotInput,
    success: OrchestrationRpcSchemas.getThreadSnapshot.output,
    error: OrchestrationGetSnapshotError,
  },
);

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

// ─── Raw TCP Listener RPCs ─────────────────────────────────────────────────

export const WsRawTcpCreateListenerRpc = Rpc.make(WS_METHODS.rawTcpCreateListener, {
  payload: CreateRawTcpListenerInput,
  success: RawTcpListenerSnapshot,
  error: RawTcpListenerError,
});

export const WsRawTcpStopListenerRpc = Rpc.make(WS_METHODS.rawTcpStopListener, {
  payload: StopRawTcpListenerInput,
  error: RawTcpListenerError,
});

export const WsRawTcpListListenersRpc = Rpc.make(WS_METHODS.rawTcpListListeners, {
  payload: Schema.Struct({}),
  success: Schema.Array(RawTcpListenerSnapshot),
});

export const WsRawTcpListSessionsRpc = Rpc.make(WS_METHODS.rawTcpListSessions, {
  payload: Schema.Struct({}),
  success: Schema.Array(RawTcpSessionSnapshot),
});

export const WsRawTcpSessionWriteRpc = Rpc.make(WS_METHODS.rawTcpSessionWrite, {
  payload: RawTcpSessionWriteInput,
  error: RawTcpSessionError,
});

export const WsRawTcpSessionUpgradePtyRpc = Rpc.make(WS_METHODS.rawTcpSessionUpgradePty, {
  payload: RawTcpSessionUpgradePtyInput,
  success: RawTcpSessionSnapshot,
  error: RawTcpSessionError,
});

export const WsRawTcpSessionCloseRpc = Rpc.make(WS_METHODS.rawTcpSessionClose, {
  payload: RawTcpSessionCloseInput,
  error: RawTcpSessionError,
});

export const WsSubscribeRawTcpEventsRpc = Rpc.make(WS_METHODS.subscribeRawTcpEvents, {
  payload: Schema.Struct({}),
  success: RawTcpEvent,
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

export const WsTrafficLensListFindingsRpc = Rpc.make(WS_METHODS.trafficLensListFindings, {
  payload: TrafficLensListFindingsInput,
  success: Schema.Array(TrafficLensFinding),
  error: TrafficLensError,
});

export const WsTrafficLensListRulesRpc = Rpc.make(WS_METHODS.trafficLensListRules, {
  payload: Schema.Struct({}),
  success: Schema.Array(TrafficLensRule),
  error: TrafficLensError,
});

export const WsTrafficLensUpsertRuleRpc = Rpc.make(WS_METHODS.trafficLensUpsertRule, {
  payload: TrafficLensUpsertRuleInput,
  success: TrafficLensRule,
  error: TrafficLensError,
});

export const WsTrafficLensDeleteRuleRpc = Rpc.make(WS_METHODS.trafficLensDeleteRule, {
  payload: TrafficLensDeleteRuleInput,
  error: TrafficLensError,
});

export const WsTrafficLensListOverridesRpc = Rpc.make(WS_METHODS.trafficLensListOverrides, {
  payload: Schema.Struct({}),
  success: Schema.Array(TrafficLensOverride),
  error: TrafficLensError,
});

export const WsTrafficLensUpsertOverrideRpc = Rpc.make(WS_METHODS.trafficLensUpsertOverride, {
  payload: TrafficLensUpsertOverrideInput,
  success: TrafficLensOverride,
  error: TrafficLensError,
});

export const WsTrafficLensDeleteOverrideRpc = Rpc.make(WS_METHODS.trafficLensDeleteOverride, {
  payload: TrafficLensDeleteOverrideInput,
  error: TrafficLensError,
});

export const WsTrafficLensListProfilesRpc = Rpc.make(WS_METHODS.trafficLensListProfiles, {
  payload: Schema.Struct({}),
  success: Schema.Array(TrafficLensProfile),
  error: TrafficLensError,
});

export const WsTrafficLensUpsertProfileRpc = Rpc.make(WS_METHODS.trafficLensUpsertProfile, {
  payload: TrafficLensUpsertProfileInput,
  success: TrafficLensProfile,
  error: TrafficLensError,
});

export const WsTrafficLensDeleteProfileRpc = Rpc.make(WS_METHODS.trafficLensDeleteProfile, {
  payload: TrafficLensDeleteProfileInput,
  error: TrafficLensError,
});

export const WsTrafficLensListStorageOriginsRpc = Rpc.make(
  WS_METHODS.trafficLensListStorageOrigins,
  {
    payload: TrafficLensListStorageOriginsInput,
    success: Schema.Array(TrafficLensStorageOriginSummary),
    error: TrafficLensError,
  },
);

export const WsTrafficLensGetCookieSnapshotRpc = Rpc.make(WS_METHODS.trafficLensGetCookieSnapshot, {
  payload: TrafficLensGetApplicableCookiesInput,
  success: Schema.NullOr(TrafficLensCookieSnapshot),
  error: TrafficLensError,
});

export const WsTrafficLensGetLocalStorageSnapshotRpc = Rpc.make(
  WS_METHODS.trafficLensGetLocalStorageSnapshot,
  {
    payload: TrafficLensGetLocalStorageInput,
    success: Schema.NullOr(TrafficLensDomStorageSnapshot),
    error: TrafficLensError,
  },
);

export const WsTrafficLensListSessionStorageSnapshotsRpc = Rpc.make(
  WS_METHODS.trafficLensListSessionStorageSnapshots,
  {
    payload: TrafficLensListSessionStorageSnapshotsInput,
    success: Schema.Array(TrafficLensArchivedSessionStorageSummary),
    error: TrafficLensError,
  },
);

export const WsTrafficLensGetSessionStorageSnapshotRpc = Rpc.make(
  WS_METHODS.trafficLensGetSessionStorageSnapshot,
  {
    payload: TrafficLensGetSessionStorageSnapshotInput,
    success: Schema.Array(TrafficLensDomStorageEntry),
    error: TrafficLensError,
  },
);

export const WsTrafficLensUpdateSessionStorageSnapshotRpc = Rpc.make(
  WS_METHODS.trafficLensUpdateSessionStorageSnapshot,
  {
    payload: TrafficLensUpdateSessionStorageSnapshotInput,
    error: TrafficLensError,
  },
);

export const WsTrafficLensGetStorageVersionsRpc = Rpc.make(
  WS_METHODS.trafficLensGetStorageVersions,
  {
    payload: TrafficLensGetStorageVersionsInput,
    success: Schema.Array(TrafficLensStorageAreaVersion),
    error: TrafficLensError,
  },
);

export const WsTrafficLensClearPersistedOriginRpc = Rpc.make(
  WS_METHODS.trafficLensClearPersistedOrigin,
  {
    payload: TrafficLensClearPersistedOriginInput,
    error: TrafficLensError,
  },
);

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

export const WsPlanRunnerStopRpc = Rpc.make(WS_METHODS.planRunnerStop, {
  payload: PlanRunnerStopInput,
  error: Schema.Union([PlanRunnerError, PlanRunnerNotFoundError]),
});

export const WsPlanRunnerResumeRpc = Rpc.make(WS_METHODS.planRunnerResume, {
  payload: PlanRunnerResumeInput,
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

export const WsPlanRunnerArchiveFeatureRpc = Rpc.make(WS_METHODS.planRunnerArchiveFeature, {
  payload: PlanRunnerArchiveFeatureInput,
  success: PlanRunnerArchiveFeatureResult,
  error: PlanRunnerError,
});

export const WsPlanRunnerUnarchiveFeatureRpc = Rpc.make(WS_METHODS.planRunnerUnarchiveFeature, {
  payload: PlanRunnerUnarchiveFeatureInput,
  success: PlanRunnerUnarchiveFeatureResult,
  error: PlanRunnerError,
});

export const WsPlanRunnerListArchivedFeaturesRpc = Rpc.make(
  WS_METHODS.planRunnerListArchivedFeatures,
  {
    payload: PlanRunnerListArchivedFeaturesInput,
    success: PlanRunnerListArchivedFeaturesResult,
    error: PlanRunnerError,
  },
);

export const WsPlanRunnerRenameFeatureRpc = Rpc.make(WS_METHODS.planRunnerRenameFeature, {
  payload: PlanRunnerRenameFeatureInput,
  success: PlanRunnerRenameFeatureResult,
  error: PlanRunnerError,
});

export const WsPlanRunnerRerunFromFailureRpc = Rpc.make(WS_METHODS.planRunnerRerunFromFailure, {
  payload: PlanRunnerRerunFromFailureInput,
  success: PlanRunnerStartResult,
  error: Schema.Union([PlanRunnerError, PlanRunnerNotFoundError]),
});
// ─── Managed Process RPCs ──────────────────────────────────────────────────

export const WsManagedProcessListRpc = Rpc.make(WS_METHODS.managedProcessList, {
  payload: Schema.Struct({ projectId: ProjectId }),
  success: Schema.Array(ManagedProcessInstance),
  error: ManagedProcessRpcError,
});

export const WsManagedProcessStartRpc = Rpc.make(WS_METHODS.managedProcessStart, {
  payload: Schema.Struct({
    projectId: ProjectId,
    processDefId: TrimmedNonEmptyString,
    worktreePath: Schema.NullOr(TrimmedNonEmptyString),
  }),
  success: ManagedProcessInstance,
  error: ManagedProcessRpcError,
});

export const WsManagedProcessStopRpc = Rpc.make(WS_METHODS.managedProcessStop, {
  payload: Schema.Struct({ instanceId: TrimmedNonEmptyString }),
  success: ManagedProcessInstance,
  error: ManagedProcessRpcError,
});

export const WsManagedProcessForceKillRpc = Rpc.make(WS_METHODS.managedProcessForceKill, {
  payload: Schema.Struct({ instanceId: TrimmedNonEmptyString }),
  success: ManagedProcessInstance,
  error: ManagedProcessRpcError,
});

export const WsManagedProcessRestartRpc = Rpc.make(WS_METHODS.managedProcessRestart, {
  payload: Schema.Struct({ instanceId: TrimmedNonEmptyString }),
  success: ManagedProcessInstance,
  error: ManagedProcessRpcError,
});

export const WsManagedProcessWriteStdinRpc = Rpc.make(WS_METHODS.managedProcessWriteStdin, {
  payload: Schema.Struct({
    instanceId: TrimmedNonEmptyString,
    data: Schema.String.check(Schema.isMaxLength(64 * 1024)),
  }),
  error: ManagedProcessRpcError,
});

export const WsManagedProcessUpsertDefinitionRpc = Rpc.make(
  WS_METHODS.managedProcessUpsertDefinition,
  {
    payload: Schema.Struct({
      projectId: ProjectId,
      definition: ManagedProcess,
    }),
    error: ManagedProcessRpcError,
  },
);

export const WsManagedProcessDeleteDefinitionRpc = Rpc.make(
  WS_METHODS.managedProcessDeleteDefinition,
  {
    payload: Schema.Struct({
      projectId: ProjectId,
      processDefId: TrimmedNonEmptyString,
    }),
    error: ManagedProcessRpcError,
  },
);

export const WsManagedProcessSubscribeLogRpc = Rpc.make(WS_METHODS.managedProcessSubscribeLog, {
  payload: Schema.Struct({ instanceId: TrimmedNonEmptyString }),
  success: ManagedProcessLogServerMessage,
  error: ManagedProcessRpcError,
  stream: true,
});

export const ManagedProcessImportProposal = Schema.Struct({
  suggestedDefinition: ManagedProcess,
  sourceLabel: Schema.String,
  conflictsWithDefId: Schema.NullOr(Schema.String),
});
export type ManagedProcessImportProposal = typeof ManagedProcessImportProposal.Type;

export const WsManagedProcessProposedImportsRpc = Rpc.make(
  WS_METHODS.managedProcessProposedImports,
  {
    payload: Schema.Struct({ projectId: ProjectId }),
    success: Schema.Array(ManagedProcessImportProposal),
    error: ManagedProcessRpcError,
  },
);

// ─── Skill RPCs ────────────────────────────────────────────────────────────

export const WsServerListSkillsRpc = Rpc.make(WS_METHODS.serverListSkills, {
  payload: Schema.Struct({}),
  success: Schema.Array(ServerProviderSkill),
  error: SkillRpcError,
});

export const WsServerGetSkillDetailsRpc = Rpc.make(WS_METHODS.serverGetSkillDetails, {
  payload: GetSkillDetailsInput,
  success: ServerSkillDetails,
  error: SkillRpcError,
});

export const WsServerCreateSkillRpc = Rpc.make(WS_METHODS.serverCreateSkill, {
  payload: CreateSkillInput,
  success: ServerProviderSkill,
  error: SkillRpcError,
});

export const WsServerUpdateSkillRpc = Rpc.make(WS_METHODS.serverUpdateSkill, {
  payload: UpdateSkillInput,
  success: ServerProviderSkill,
  error: SkillRpcError,
});

export const WsServerDeleteSkillRpc = Rpc.make(WS_METHODS.serverDeleteSkill, {
  payload: Schema.Struct({ name: Schema.String }),
  error: SkillRpcError,
});

export const WsServerResolveSkillConflictRpc = Rpc.make(WS_METHODS.serverResolveSkillConflict, {
  payload: ResolveSkillConflictInput,
  success: ServerProviderSkill,
  error: SkillRpcError,
});

export const WsServerSetActiveSkillProjectRpc = Rpc.make(WS_METHODS.serverSetActiveSkillProject, {
  payload: Schema.Struct({ cwd: Schema.String }),
  error: SkillRpcError,
});

// ─── Review RPCs ───────────────────────────────────────────────────────────

export const WsReviewGetOrCreateSessionRpc = Rpc.make(
  WS_METHODS.sourceControlReviewGetOrCreateSession,
  {
    payload: ReviewGetOrCreateSessionInput,
    success: ReviewSessionSummary,
    error: ReviewRpcError,
  },
);

export const WsReviewGetSessionSummaryRpc = Rpc.make(
  WS_METHODS.sourceControlReviewGetSessionSummary,
  {
    payload: ReviewGetSessionInput,
    success: ReviewSessionSummary,
    error: ReviewRpcError,
  },
);

export const WsReviewGetSessionSnapshotRpc = Rpc.make(
  WS_METHODS.sourceControlReviewGetSessionSnapshot,
  {
    payload: ReviewGetSessionInput,
    success: ReviewSessionSnapshot,
    error: ReviewRpcError,
  },
);

export const WsReviewSetModeRpc = Rpc.make(WS_METHODS.sourceControlReviewSetMode, {
  payload: ReviewSetModeInput,
  success: ReviewSessionSummary,
  error: Schema.Union([ReviewRpcError, ReviewActionBlockedError]),
});

export const WsReviewSetScopeRpc = Rpc.make(WS_METHODS.sourceControlReviewSetScope, {
  payload: ReviewSetScopeInput,
  success: ReviewSessionSummary,
  error: Schema.Union([ReviewRpcError, ReviewActionBlockedError]),
});

export const WsReviewSetProgressRpc = Rpc.make(WS_METHODS.sourceControlReviewSetProgress, {
  payload: ReviewSetProgressInput,
  success: ReviewSessionSummary,
  error: Schema.Union([ReviewRpcError, ReviewActionBlockedError]),
});

export const WsReviewCreateLocalThreadRpc = Rpc.make(
  WS_METHODS.sourceControlReviewCreateLocalThread,
  {
    payload: ReviewCreateLocalAnnotationThreadInput,
    success: ReviewLocalAnnotationThread,
    error: Schema.Union([ReviewRpcError, ReviewActionBlockedError]),
  },
);

export const WsReviewUpdateLocalThreadRpc = Rpc.make(
  WS_METHODS.sourceControlReviewUpdateLocalThread,
  {
    payload: ReviewUpdateLocalAnnotationThreadInput,
    success: ReviewLocalAnnotationThread,
    error: Schema.Union([ReviewRpcError, ReviewActionBlockedError]),
  },
);

export const WsReviewDeleteLocalThreadRpc = Rpc.make(
  WS_METHODS.sourceControlReviewDeleteLocalThread,
  {
    payload: ReviewDeleteLocalAnnotationThreadInput,
    success: Schema.Void,
    error: Schema.Union([ReviewRpcError, ReviewActionBlockedError]),
  },
);

export const WsReviewSetLocalThreadResolvedRpc = Rpc.make(
  WS_METHODS.sourceControlReviewSetLocalThreadResolved,
  {
    payload: ReviewSetLocalThreadResolvedInput,
    success: ReviewLocalAnnotationThread,
    error: Schema.Union([ReviewRpcError, ReviewActionBlockedError]),
  },
);

export const WsReviewCreateLocalReplyRpc = Rpc.make(
  WS_METHODS.sourceControlReviewCreateLocalReply,
  {
    payload: ReviewCreateLocalAnnotationReplyInput,
    success: ReviewLocalAnnotationReply,
    error: Schema.Union([ReviewRpcError, ReviewActionBlockedError]),
  },
);

export const WsReviewUpdateLocalReplyRpc = Rpc.make(
  WS_METHODS.sourceControlReviewUpdateLocalReply,
  {
    payload: ReviewUpdateLocalAnnotationReplyInput,
    success: ReviewLocalAnnotationReply,
    error: Schema.Union([ReviewRpcError, ReviewActionBlockedError]),
  },
);

export const WsReviewDeleteLocalReplyRpc = Rpc.make(
  WS_METHODS.sourceControlReviewDeleteLocalReply,
  {
    payload: ReviewDeleteLocalAnnotationReplyInput,
    success: Schema.Void,
    error: Schema.Union([ReviewRpcError, ReviewActionBlockedError]),
  },
);

export const WsReviewUpsertOverviewNoteRpc = Rpc.make(
  WS_METHODS.sourceControlReviewUpsertOverviewNote,
  {
    payload: ReviewUpsertOverviewNoteInput,
    success: ReviewOverviewNote,
    error: Schema.Union([ReviewRpcError, ReviewActionBlockedError]),
  },
);

export const WsReviewDeleteOverviewNoteRpc = Rpc.make(
  WS_METHODS.sourceControlReviewDeleteOverviewNote,
  {
    payload: ReviewDeleteOverviewNoteInput,
    success: Schema.Void,
    error: Schema.Union([ReviewRpcError, ReviewActionBlockedError]),
  },
);

export const WsReviewGetDiffSnapshotRpc = Rpc.make(WS_METHODS.sourceControlReviewGetDiffSnapshot, {
  payload: ReviewGetDiffSnapshotInput,
  success: ReviewDiffSnapshot,
  error: ReviewRpcError,
});

export const WsReviewGetFilePatchRpc = Rpc.make(WS_METHODS.sourceControlReviewGetFilePatch, {
  payload: ReviewGetFilePatchInput,
  success: Schema.NullOr(ReviewDiffFilePatch),
  error: ReviewRpcError,
});

export const WsReviewGetChunkPayloadRpc = Rpc.make(WS_METHODS.sourceControlReviewGetChunkPayload, {
  payload: ReviewGetChunkPayloadInput,
  success: Schema.NullOr(ReviewChunkPayload),
  error: ReviewRpcError,
});

export const WsReviewGetGitHubSnapshotRpc = Rpc.make(
  WS_METHODS.sourceControlReviewGetGitHubSnapshot,
  {
    payload: ReviewGetGitHubSnapshotInput,
    success: Schema.NullOr(GitHubReviewSnapshot),
    error: ReviewRpcError,
  },
);

export const WsReviewUpsertGitHubDraftRpc = Rpc.make(
  WS_METHODS.sourceControlReviewUpsertGitHubDraft,
  {
    payload: ReviewUpsertGitHubDraftInput,
    success: GitHubReviewSnapshot,
    error: Schema.Union([ReviewRpcError, ReviewActionBlockedError]),
  },
);

export const WsReviewApplyRawMutationRpc = Rpc.make(
  WS_METHODS.sourceControlReviewApplyRawMutation,
  {
    payload: ReviewApplyRawMutationInput,
    success: ReviewApplyRawMutationResult,
    error: Schema.Union([ReviewRpcError, ReviewMutationConflictError]),
  },
);

export const WsReviewDeleteGitHubDraftRpc = Rpc.make(
  WS_METHODS.sourceControlReviewDeleteGitHubDraft,
  {
    payload: ReviewDeleteGitHubDraftInput,
    success: GitHubReviewSnapshot,
    error: Schema.Union([ReviewRpcError, ReviewActionBlockedError]),
  },
);

export const WsReviewReplyToGitHubThreadRpc = Rpc.make(
  WS_METHODS.sourceControlReviewReplyToGitHubThread,
  {
    payload: ReviewReplyToGitHubThreadInput,
    success: GitHubReviewSnapshot,
    error: Schema.Union([ReviewRpcError, ReviewActionBlockedError]),
  },
);

export const WsReviewSubmitGitHubDraftRpc = Rpc.make(
  WS_METHODS.sourceControlReviewSubmitGitHubDraft,
  {
    payload: ReviewSubmitGitHubDraftInput,
    success: GitHubReviewSnapshot,
    error: Schema.Union([ReviewRpcError, ReviewActionBlockedError]),
  },
);

export const WsReviewRefreshProviderDataRpc = Rpc.make(
  WS_METHODS.sourceControlReviewRefreshProviderData,
  {
    payload: ReviewRefreshProviderDataInput,
    success: ReviewSessionSnapshot,
    error: ReviewRpcError,
  },
);

export const WsReviewGenerateAnalysisRpc = Rpc.make(
  WS_METHODS.sourceControlReviewGenerateAnalysis,
  {
    payload: ReviewGenerateAnalysisInput,
    success: ReviewAnalysisArtifact,
    error: Schema.Union([ReviewRpcError, ReviewActionBlockedError]),
  },
);

export const WsSubscribeReviewEventsRpc = Rpc.make(WS_METHODS.subscribeSourceControlReviewEvents, {
  payload: ReviewGetSessionInput,
  success: ReviewStreamEvent,
  error: ReviewRpcError,
  stream: true,
});

export const WsRpcGroup = RpcGroup.make(
  WsServerGetConfigRpc,
  WsServerRefreshProvidersRpc,
  WsServerUpsertKeybindingRpc,
  WsServerRemoveKeybindingRpc,
  WsServerGetTraceDiagnosticsRpc,
  WsServerGetProcessDiagnosticsRpc,
  WsServerGetProcessResourceHistoryRpc,
  WsServerSignalProcessRpc,
  WsServerGetSettingsRpc,
  WsServerUpdateSettingsRpc,
  WsServerDiscoverSourceControlRpc,
  WsSourceControlLookupRepositoryRpc,
  WsSourceControlCloneRepositoryRpc,
  WsSourceControlPublishRepositoryRpc,
  WsServerGetGlobalActionsRpc,
  WsServerCreateGlobalActionRpc,
  WsServerUpdateGlobalActionRpc,
  WsServerDeleteGlobalActionRpc,
  WsProjectsListEntriesRpc,
  WsProjectsSearchEntriesRpc,
  WsProjectsWriteFileRpc,
  WsShellOpenInEditorRpc,
  WsFilesystemBrowseRpc,
  WsSubscribeVcsStatusRpc,
  WsVcsPullRpc,
  WsVcsRefreshStatusRpc,
  WsGitRunStackedActionRpc,
  WsGitResolvePullRequestRpc,
  WsGitPreparePullRequestThreadRpc,
  WsVcsListRefsRpc,
  WsVcsCreateWorktreeRpc,
  WsVcsRemoveWorktreeRpc,
  WsVcsCreateRefRpc,
  WsVcsSwitchRefRpc,
  WsVcsInitRpc,
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
  WsOrchestrationGetBootstrapSnapshotRpc,
  WsServerUpdateProviderRpc,
  WsOrchestrationGetArchivedShellSnapshotRpc,
  WsOrchestrationSubscribeShellRpc,
  WsOrchestrationSubscribeManagedProcessesRpc,
  WsOrchestrationGetSnapshotRpc,
  WsOrchestrationGetThreadSnapshotRpc,
  WsOrchestrationDispatchCommandRpc,
  WsOrchestrationGetTurnDiffRpc,
  WsOrchestrationGetFullThreadDiffRpc,
  WsOrchestrationReplayEventsRpc,
  WsTerminalAttachTmuxRpc,
  WsTerminalDetachTmuxRpc,
  WsTerminalWriteTmuxRpc,
  WsTerminalResizeTmuxRpc,
  WsRawTcpCreateListenerRpc,
  WsRawTcpStopListenerRpc,
  WsRawTcpListListenersRpc,
  WsRawTcpListSessionsRpc,
  WsRawTcpSessionWriteRpc,
  WsRawTcpSessionUpgradePtyRpc,
  WsRawTcpSessionCloseRpc,
  WsSubscribeRawTcpEventsRpc,
  WsTrafficLensGetTrafficRpc,
  WsTrafficLensGetTrafficDetailRpc,
  WsTrafficLensClearTrafficRpc,
  WsSubscribeTrafficLensEventsRpc,
  WsTrafficLensReplayRequestRpc,
  WsTrafficLensListFindingsRpc,
  WsTrafficLensListRulesRpc,
  WsTrafficLensUpsertRuleRpc,
  WsTrafficLensDeleteRuleRpc,
  WsTrafficLensListOverridesRpc,
  WsTrafficLensUpsertOverrideRpc,
  WsTrafficLensDeleteOverrideRpc,
  WsTrafficLensListProfilesRpc,
  WsTrafficLensUpsertProfileRpc,
  WsTrafficLensDeleteProfileRpc,
  WsTrafficLensListStorageOriginsRpc,
  WsTrafficLensGetCookieSnapshotRpc,
  WsTrafficLensGetLocalStorageSnapshotRpc,
  WsTrafficLensListSessionStorageSnapshotsRpc,
  WsTrafficLensGetSessionStorageSnapshotRpc,
  WsTrafficLensUpdateSessionStorageSnapshotRpc,
  WsTrafficLensGetStorageVersionsRpc,
  WsTrafficLensClearPersistedOriginRpc,
  WsPlanRunnerStartRpc,
  WsPlanRunnerGetStatusRpc,
  WsPlanRunnerCancelRpc,
  WsPlanRunnerStopRpc,
  WsPlanRunnerResumeRpc,
  WsSubscribePlanRunnerEventsRpc,
  WsPlanRunnerListFeaturesRpc,
  WsPlanRunnerGetFeaturePlansRpc,
  WsPlanRunnerGetFeatureRunRpc,
  WsPlanRunnerListRunsRpc,
  WsPlanRunnerGetStepLogRpc,
  WsPlanRunnerArchiveFeatureRpc,
  WsPlanRunnerUnarchiveFeatureRpc,
  WsPlanRunnerListArchivedFeaturesRpc,
  WsPlanRunnerRenameFeatureRpc,
  WsPlanRunnerRerunFromFailureRpc,
  WsManagedProcessListRpc,
  WsManagedProcessStartRpc,
  WsManagedProcessStopRpc,
  WsManagedProcessForceKillRpc,
  WsManagedProcessRestartRpc,
  WsManagedProcessWriteStdinRpc,
  WsManagedProcessUpsertDefinitionRpc,
  WsManagedProcessDeleteDefinitionRpc,
  WsManagedProcessSubscribeLogRpc,
  WsManagedProcessProposedImportsRpc,
  WsOrchestrationSubscribeShellRpc,
  WsServerListSkillsRpc,
  WsServerGetSkillDetailsRpc,
  WsServerCreateSkillRpc,
  WsServerUpdateSkillRpc,
  WsServerDeleteSkillRpc,
  WsServerResolveSkillConflictRpc,
  WsServerSetActiveSkillProjectRpc,
  WsReviewGetOrCreateSessionRpc,
  WsReviewGetSessionSummaryRpc,
  WsReviewGetSessionSnapshotRpc,
  WsReviewSetModeRpc,
  WsReviewSetScopeRpc,
  WsReviewSetProgressRpc,
  WsReviewCreateLocalThreadRpc,
  WsReviewUpdateLocalThreadRpc,
  WsReviewDeleteLocalThreadRpc,
  WsReviewSetLocalThreadResolvedRpc,
  WsReviewCreateLocalReplyRpc,
  WsReviewUpdateLocalReplyRpc,
  WsReviewDeleteLocalReplyRpc,
  WsReviewUpsertOverviewNoteRpc,
  WsReviewDeleteOverviewNoteRpc,
  WsReviewGetDiffSnapshotRpc,
  WsReviewGetFilePatchRpc,
  WsReviewGetChunkPayloadRpc,
  WsReviewGetGitHubSnapshotRpc,
  WsReviewUpsertGitHubDraftRpc,
  WsReviewApplyRawMutationRpc,
  WsReviewDeleteGitHubDraftRpc,
  WsReviewReplyToGitHubThreadRpc,
  WsReviewSubmitGitHubDraftRpc,
  WsReviewRefreshProviderDataRpc,
  WsReviewGenerateAnalysisRpc,
  WsSubscribeReviewEventsRpc,
);
