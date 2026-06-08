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
import {
  CommentGitDiffChangeRequestLinesInput,
  CreateGitDiffIgnoreListInput,
  DeleteGitDiffIgnoreListInput,
  GitDiffActionResult,
  GitDiffChangeRequestReferenceInput,
  GitDiffMergeChangeRequestInput,
  LoadActiveChangeRequestStackedDiffFileIndexInput,
  LoadActiveChangeRequestStackedDiffFileIndexResult,
  LoadDiffFileInput,
  LoadDiffFileIndexInput,
  LoadDiffFileIndexResult,
  LoadDiffFileResult,
  LoadGitDiffChangeRequestChecksInput,
  LoadGitDiffChangeRequestChecksResult,
  LoadGitDiffIgnoreListsInput,
  LoadGitDiffIgnoreListsResult,
  LoadStackedDiffFileIndexInput,
  LoadStackedDiffFileIndexResult,
  RevertGitDiffChangeRequestLinesInput,
  RevertGitDiffChangeRequestLinesResult,
  StageGitDiffWorktreeChangesInput,
  StageGitDiffWorktreeChangesResult,
  UpdateGitDiffIgnoreListInput,
} from "./gitDiff";
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
  ProjectCopyEntryError,
  ProjectCopyEntryInput,
  ProjectCopyEntryResult,
  ProjectCreateDirectoryError,
  ProjectCreateDirectoryInput,
  ProjectCreateDirectoryResult,
  ProjectCreateFileError,
  ProjectCreateFileInput,
  ProjectCreateFileResult,
  ProjectListEntriesError,
  ProjectListEntriesInput,
  ProjectListEntriesResult,
  ProjectMoveEntryError,
  ProjectMoveEntryInput,
  ProjectMoveEntryResult,
  ProjectRemoveEntryError,
  ProjectRemoveEntryInput,
  ProjectRemoveEntryResult,
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
  CreateRemoteHostInput,
  DeleteRemoteHostInput,
  ListRemoteDirectoryInput,
  ListRemoteDirectoryResult,
  ListRemoteCommandRunsInput,
  RemoteCommandRunSnapshot,
  RemoteConnectionSnapshot,
  RemoteControllerEvent,
  RemoteControllerRpcError,
  RemoteHostSnapshot,
  SendRemoteCommandInput,
  SetRemoteConnectionPathInput,
  StartRemoteConnectionInput,
  StopRemoteConnectionInput,
  UpdateRemoteHostInput,
} from "./remoteController";
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
import { ServerListProviderSkillsInput, ServerListProviderSkillsResult } from "./skill";
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
  SourceControlStackAbortOperationInput,
  SourceControlStackContinueOperationInput,
  SourceControlStackCreateEntryInput,
  SourceControlStackDropEntryInput,
  SourceControlStackGetSnapshotInput,
  SourceControlStackMutationResult,
  SourceControlStackPublishInput,
  SourceControlStackRenameEntryInput,
  SourceControlStackReorderInput,
  SourceControlStackRestackInput,
  SourceControlStackRpcError,
  SourceControlStackSnapshot,
  SourceControlStackSplitEntryInput,
  SourceControlStackSquashEntryInput,
  SourceControlStackStreamEvent,
  SourceControlStackSwitchEntryInput,
  SourceControlStackSyncInput,
} from "./sourceControlStack";
export const WS_METHODS = {
  // Project registry methods
  projectsList: "projects.list",
  projectsAdd: "projects.add",
  projectsRemove: "projects.remove",
  projectsListEntries: "projects.listEntries",
  projectsSearchEntries: "projects.searchEntries",
  projectsWriteFile: "projects.writeFile",
  projectsCreateFile: "projects.createFile",
  projectsCreateDirectory: "projects.createDirectory",
  projectsRemoveEntry: "projects.removeEntry",
  projectsMoveEntry: "projects.moveEntry",
  projectsCopyEntry: "projects.copyEntry",
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
  gitDiffLoadFile: "gitDiff.loadFile",
  gitDiffLoadFileIndex: "gitDiff.loadFileIndex",
  gitDiffLoadActiveChangeRequestStackedFileIndex: "gitDiff.loadActiveChangeRequestStackedFileIndex",
  gitDiffLoadStackedFileIndex: "gitDiff.loadStackedFileIndex",
  gitDiffLoadIgnoreLists: "gitDiff.loadIgnoreLists",
  gitDiffCreateIgnoreList: "gitDiff.createIgnoreList",
  gitDiffUpdateIgnoreList: "gitDiff.updateIgnoreList",
  gitDiffDeleteIgnoreList: "gitDiff.deleteIgnoreList",
  gitDiffStageWorktreeChanges: "gitDiff.stageWorktreeChanges",
  gitDiffCloseChangeRequest: "gitDiff.closeChangeRequest",
  gitDiffMergeChangeRequest: "gitDiff.mergeChangeRequest",
  gitDiffLoadChangeRequestChecks: "gitDiff.loadChangeRequestChecks",
  gitDiffCommentChangeRequestLines: "gitDiff.commentChangeRequestLines",
  gitDiffRevertChangeRequestLines: "gitDiff.revertChangeRequestLines",

  // Terminal methods
  terminalOpen: "terminal.open",
  terminalWrite: "terminal.write",
  terminalResize: "terminal.resize",
  terminalClear: "terminal.clear",
  terminalRestart: "terminal.restart",
  terminalClose: "terminal.close",

  // Server meta
  serverGetConfig: "server.getConfig",
  serverListProviderSkills: "server.listProviderSkills",
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

  // Remote Controller
  remoteControllerListHosts: "remoteController.listHosts",
  remoteControllerCreateHost: "remoteController.createHost",
  remoteControllerUpdateHost: "remoteController.updateHost",
  remoteControllerDeleteHost: "remoteController.deleteHost",
  remoteControllerStartConnection: "remoteController.startConnection",
  remoteControllerStopConnection: "remoteController.stopConnection",
  remoteControllerSetConnectionPath: "remoteController.setConnectionPath",
  remoteControllerListConnections: "remoteController.listConnections",
  remoteControllerSendCommand: "remoteController.sendCommand",
  remoteControllerListCommandRuns: "remoteController.listCommandRuns",
  remoteControllerListDirectory: "remoteController.listDirectory",
  subscribeRemoteControllerEvents: "subscribeRemoteControllerEvents",

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

  // Source control
  sourceControlLookupRepository: "sourceControl.lookupRepository",
  sourceControlCloneRepository: "sourceControl.cloneRepository",
  sourceControlPublishRepository: "sourceControl.publishRepository",

  // Source-control stack
  sourceControlStackGetSnapshot: "sourceControl.stack.getSnapshot",
  sourceControlStackCreateEntry: "sourceControl.stack.createEntry",
  sourceControlStackSwitchEntry: "sourceControl.stack.switchEntry",
  sourceControlStackRenameEntry: "sourceControl.stack.renameEntry",
  sourceControlStackDropEntry: "sourceControl.stack.dropEntry",
  sourceControlStackReorderEntries: "sourceControl.stack.reorderEntries",
  sourceControlStackRestack: "sourceControl.stack.restack",
  sourceControlStackSync: "sourceControl.stack.sync",
  sourceControlStackSquashEntry: "sourceControl.stack.squashEntry",
  sourceControlStackSplitEntry: "sourceControl.stack.splitEntry",
  sourceControlStackPublish: "sourceControl.stack.publish",
  sourceControlStackContinueOperation: "sourceControl.stack.continueOperation",
  sourceControlStackAbortOperation: "sourceControl.stack.abortOperation",
  subscribeSourceControlStackEvents: "subscribeSourceControlStackEvents",
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

export const WsServerListProviderSkillsRpc = Rpc.make(WS_METHODS.serverListProviderSkills, {
  payload: ServerListProviderSkillsInput,
  success: ServerListProviderSkillsResult,
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

export const WsProjectsCreateFileRpc = Rpc.make(WS_METHODS.projectsCreateFile, {
  payload: ProjectCreateFileInput,
  success: ProjectCreateFileResult,
  error: ProjectCreateFileError,
});

export const WsProjectsCreateDirectoryRpc = Rpc.make(WS_METHODS.projectsCreateDirectory, {
  payload: ProjectCreateDirectoryInput,
  success: ProjectCreateDirectoryResult,
  error: ProjectCreateDirectoryError,
});

export const WsProjectsRemoveEntryRpc = Rpc.make(WS_METHODS.projectsRemoveEntry, {
  payload: ProjectRemoveEntryInput,
  success: ProjectRemoveEntryResult,
  error: ProjectRemoveEntryError,
});

export const WsProjectsMoveEntryRpc = Rpc.make(WS_METHODS.projectsMoveEntry, {
  payload: ProjectMoveEntryInput,
  success: ProjectMoveEntryResult,
  error: ProjectMoveEntryError,
});

export const WsProjectsCopyEntryRpc = Rpc.make(WS_METHODS.projectsCopyEntry, {
  payload: ProjectCopyEntryInput,
  success: ProjectCopyEntryResult,
  error: ProjectCopyEntryError,
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

export const WsGitDiffLoadFileIndexRpc = Rpc.make(WS_METHODS.gitDiffLoadFileIndex, {
  payload: LoadDiffFileIndexInput,
  success: LoadDiffFileIndexResult,
  error: GitCommandError,
});

export const WsGitDiffLoadFileRpc = Rpc.make(WS_METHODS.gitDiffLoadFile, {
  payload: LoadDiffFileInput,
  success: LoadDiffFileResult,
  error: GitCommandError,
});

export const WsGitDiffLoadStackedFileIndexRpc = Rpc.make(WS_METHODS.gitDiffLoadStackedFileIndex, {
  payload: LoadStackedDiffFileIndexInput,
  success: LoadStackedDiffFileIndexResult,
  error: GitCommandError,
});

export const WsGitDiffLoadActiveChangeRequestStackedFileIndexRpc = Rpc.make(
  WS_METHODS.gitDiffLoadActiveChangeRequestStackedFileIndex,
  {
    payload: LoadActiveChangeRequestStackedDiffFileIndexInput,
    success: LoadActiveChangeRequestStackedDiffFileIndexResult,
    error: GitCommandError,
  },
);

export const WsGitDiffLoadIgnoreListsRpc = Rpc.make(WS_METHODS.gitDiffLoadIgnoreLists, {
  payload: LoadGitDiffIgnoreListsInput,
  success: LoadGitDiffIgnoreListsResult,
  error: GitCommandError,
});

export const WsGitDiffCreateIgnoreListRpc = Rpc.make(WS_METHODS.gitDiffCreateIgnoreList, {
  payload: CreateGitDiffIgnoreListInput,
  success: LoadGitDiffIgnoreListsResult,
  error: GitCommandError,
});

export const WsGitDiffUpdateIgnoreListRpc = Rpc.make(WS_METHODS.gitDiffUpdateIgnoreList, {
  payload: UpdateGitDiffIgnoreListInput,
  success: LoadGitDiffIgnoreListsResult,
  error: GitCommandError,
});

export const WsGitDiffDeleteIgnoreListRpc = Rpc.make(WS_METHODS.gitDiffDeleteIgnoreList, {
  payload: DeleteGitDiffIgnoreListInput,
  success: LoadGitDiffIgnoreListsResult,
  error: GitCommandError,
});

export const WsGitDiffStageWorktreeChangesRpc = Rpc.make(WS_METHODS.gitDiffStageWorktreeChanges, {
  payload: StageGitDiffWorktreeChangesInput,
  success: StageGitDiffWorktreeChangesResult,
  error: GitCommandError,
});

export const WsGitDiffCloseChangeRequestRpc = Rpc.make(WS_METHODS.gitDiffCloseChangeRequest, {
  payload: GitDiffChangeRequestReferenceInput,
  success: GitDiffActionResult,
  error: GitCommandError,
});

export const WsGitDiffMergeChangeRequestRpc = Rpc.make(WS_METHODS.gitDiffMergeChangeRequest, {
  payload: GitDiffMergeChangeRequestInput,
  success: GitDiffActionResult,
  error: GitCommandError,
});

export const WsGitDiffLoadChangeRequestChecksRpc = Rpc.make(
  WS_METHODS.gitDiffLoadChangeRequestChecks,
  {
    payload: LoadGitDiffChangeRequestChecksInput,
    success: LoadGitDiffChangeRequestChecksResult,
    error: GitCommandError,
  },
);

export const WsGitDiffCommentChangeRequestLinesRpc = Rpc.make(
  WS_METHODS.gitDiffCommentChangeRequestLines,
  {
    payload: CommentGitDiffChangeRequestLinesInput,
    success: GitDiffActionResult,
    error: GitCommandError,
  },
);

export const WsGitDiffRevertChangeRequestLinesRpc = Rpc.make(
  WS_METHODS.gitDiffRevertChangeRequestLines,
  {
    payload: RevertGitDiffChangeRequestLinesInput,
    success: RevertGitDiffChangeRequestLinesResult,
    error: GitCommandError,
  },
);

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

// ─── Remote Controller RPCs ────────────────────────────────────────────────

export const WsRemoteControllerListHostsRpc = Rpc.make(WS_METHODS.remoteControllerListHosts, {
  payload: Schema.Struct({}),
  success: Schema.Array(RemoteHostSnapshot),
});

export const WsRemoteControllerCreateHostRpc = Rpc.make(WS_METHODS.remoteControllerCreateHost, {
  payload: CreateRemoteHostInput,
  success: RemoteHostSnapshot,
  error: RemoteControllerRpcError,
});

export const WsRemoteControllerUpdateHostRpc = Rpc.make(WS_METHODS.remoteControllerUpdateHost, {
  payload: UpdateRemoteHostInput,
  success: RemoteHostSnapshot,
  error: RemoteControllerRpcError,
});

export const WsRemoteControllerDeleteHostRpc = Rpc.make(WS_METHODS.remoteControllerDeleteHost, {
  payload: DeleteRemoteHostInput,
  error: RemoteControllerRpcError,
});

export const WsRemoteControllerStartConnectionRpc = Rpc.make(
  WS_METHODS.remoteControllerStartConnection,
  {
    payload: StartRemoteConnectionInput,
    success: RemoteConnectionSnapshot,
    error: RemoteControllerRpcError,
  },
);

export const WsRemoteControllerStopConnectionRpc = Rpc.make(
  WS_METHODS.remoteControllerStopConnection,
  {
    payload: StopRemoteConnectionInput,
    success: RemoteConnectionSnapshot,
    error: RemoteControllerRpcError,
  },
);

export const WsRemoteControllerSetConnectionPathRpc = Rpc.make(
  WS_METHODS.remoteControllerSetConnectionPath,
  {
    payload: SetRemoteConnectionPathInput,
    success: RemoteConnectionSnapshot,
    error: RemoteControllerRpcError,
  },
);

export const WsRemoteControllerListConnectionsRpc = Rpc.make(
  WS_METHODS.remoteControllerListConnections,
  {
    payload: Schema.Struct({}),
    success: Schema.Array(RemoteConnectionSnapshot),
  },
);

export const WsRemoteControllerSendCommandRpc = Rpc.make(WS_METHODS.remoteControllerSendCommand, {
  payload: SendRemoteCommandInput,
  success: RemoteCommandRunSnapshot,
  error: RemoteControllerRpcError,
});

export const WsRemoteControllerListCommandRunsRpc = Rpc.make(
  WS_METHODS.remoteControllerListCommandRuns,
  {
    payload: ListRemoteCommandRunsInput,
    success: Schema.Array(RemoteCommandRunSnapshot),
  },
);

export const WsRemoteControllerListDirectoryRpc = Rpc.make(
  WS_METHODS.remoteControllerListDirectory,
  {
    payload: ListRemoteDirectoryInput,
    success: ListRemoteDirectoryResult,
    error: RemoteControllerRpcError,
  },
);

export const WsSubscribeRemoteControllerEventsRpc = Rpc.make(
  WS_METHODS.subscribeRemoteControllerEvents,
  {
    payload: Schema.Struct({}),
    success: RemoteControllerEvent,
    stream: true,
  },
);

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

// ─── Source-Control Stack RPCs ─────────────────────────────────────────────

export const WsSourceControlStackGetSnapshotRpc = Rpc.make(
  WS_METHODS.sourceControlStackGetSnapshot,
  {
    payload: SourceControlStackGetSnapshotInput,
    success: SourceControlStackSnapshot,
    error: SourceControlStackRpcError,
  },
);

export const WsSourceControlStackCreateEntryRpc = Rpc.make(
  WS_METHODS.sourceControlStackCreateEntry,
  {
    payload: SourceControlStackCreateEntryInput,
    success: SourceControlStackMutationResult,
    error: SourceControlStackRpcError,
  },
);

export const WsSourceControlStackSwitchEntryRpc = Rpc.make(
  WS_METHODS.sourceControlStackSwitchEntry,
  {
    payload: SourceControlStackSwitchEntryInput,
    success: SourceControlStackMutationResult,
    error: SourceControlStackRpcError,
  },
);

export const WsSourceControlStackRenameEntryRpc = Rpc.make(
  WS_METHODS.sourceControlStackRenameEntry,
  {
    payload: SourceControlStackRenameEntryInput,
    success: SourceControlStackMutationResult,
    error: SourceControlStackRpcError,
  },
);

export const WsSourceControlStackDropEntryRpc = Rpc.make(WS_METHODS.sourceControlStackDropEntry, {
  payload: SourceControlStackDropEntryInput,
  success: SourceControlStackMutationResult,
  error: SourceControlStackRpcError,
});

export const WsSourceControlStackReorderEntriesRpc = Rpc.make(
  WS_METHODS.sourceControlStackReorderEntries,
  {
    payload: SourceControlStackReorderInput,
    success: SourceControlStackMutationResult,
    error: SourceControlStackRpcError,
  },
);

export const WsSourceControlStackRestackRpc = Rpc.make(WS_METHODS.sourceControlStackRestack, {
  payload: SourceControlStackRestackInput,
  success: SourceControlStackMutationResult,
  error: SourceControlStackRpcError,
});

export const WsSourceControlStackSyncRpc = Rpc.make(WS_METHODS.sourceControlStackSync, {
  payload: SourceControlStackSyncInput,
  success: SourceControlStackMutationResult,
  error: SourceControlStackRpcError,
});

export const WsSourceControlStackSquashEntryRpc = Rpc.make(
  WS_METHODS.sourceControlStackSquashEntry,
  {
    payload: SourceControlStackSquashEntryInput,
    success: SourceControlStackMutationResult,
    error: SourceControlStackRpcError,
  },
);

export const WsSourceControlStackSplitEntryRpc = Rpc.make(WS_METHODS.sourceControlStackSplitEntry, {
  payload: SourceControlStackSplitEntryInput,
  success: SourceControlStackMutationResult,
  error: SourceControlStackRpcError,
});

export const WsSourceControlStackPublishRpc = Rpc.make(WS_METHODS.sourceControlStackPublish, {
  payload: SourceControlStackPublishInput,
  success: SourceControlStackMutationResult,
  error: SourceControlStackRpcError,
});

export const WsSourceControlStackContinueOperationRpc = Rpc.make(
  WS_METHODS.sourceControlStackContinueOperation,
  {
    payload: SourceControlStackContinueOperationInput,
    success: SourceControlStackMutationResult,
    error: SourceControlStackRpcError,
  },
);

export const WsSourceControlStackAbortOperationRpc = Rpc.make(
  WS_METHODS.sourceControlStackAbortOperation,
  {
    payload: SourceControlStackAbortOperationInput,
    success: SourceControlStackMutationResult,
    error: SourceControlStackRpcError,
  },
);

export const WsSubscribeSourceControlStackEventsRpc = Rpc.make(
  WS_METHODS.subscribeSourceControlStackEvents,
  {
    payload: SourceControlStackGetSnapshotInput,
    success: SourceControlStackStreamEvent,
    error: SourceControlStackRpcError,
    stream: true,
  },
);

export const WsRpcGroup = RpcGroup.make(
  WsServerGetConfigRpc,
  WsServerListProviderSkillsRpc,
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
  WsProjectsCreateFileRpc,
  WsProjectsCreateDirectoryRpc,
  WsProjectsRemoveEntryRpc,
  WsProjectsMoveEntryRpc,
  WsProjectsCopyEntryRpc,
  WsShellOpenInEditorRpc,
  WsFilesystemBrowseRpc,
  WsSubscribeVcsStatusRpc,
  WsVcsPullRpc,
  WsVcsRefreshStatusRpc,
  WsGitRunStackedActionRpc,
  WsGitResolvePullRequestRpc,
  WsGitPreparePullRequestThreadRpc,
  WsGitDiffLoadFileIndexRpc,
  WsGitDiffLoadFileRpc,
  WsGitDiffLoadActiveChangeRequestStackedFileIndexRpc,
  WsGitDiffLoadStackedFileIndexRpc,
  WsGitDiffLoadIgnoreListsRpc,
  WsGitDiffCreateIgnoreListRpc,
  WsGitDiffUpdateIgnoreListRpc,
  WsGitDiffDeleteIgnoreListRpc,
  WsGitDiffStageWorktreeChangesRpc,
  WsGitDiffCloseChangeRequestRpc,
  WsGitDiffMergeChangeRequestRpc,
  WsGitDiffLoadChangeRequestChecksRpc,
  WsGitDiffCommentChangeRequestLinesRpc,
  WsGitDiffRevertChangeRequestLinesRpc,
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
  WsRemoteControllerListHostsRpc,
  WsRemoteControllerCreateHostRpc,
  WsRemoteControllerUpdateHostRpc,
  WsRemoteControllerDeleteHostRpc,
  WsRemoteControllerStartConnectionRpc,
  WsRemoteControllerStopConnectionRpc,
  WsRemoteControllerSetConnectionPathRpc,
  WsRemoteControllerListConnectionsRpc,
  WsRemoteControllerSendCommandRpc,
  WsRemoteControllerListCommandRunsRpc,
  WsRemoteControllerListDirectoryRpc,
  WsSubscribeRemoteControllerEventsRpc,
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
  WsSourceControlStackGetSnapshotRpc,
  WsSourceControlStackCreateEntryRpc,
  WsSourceControlStackSwitchEntryRpc,
  WsSourceControlStackRenameEntryRpc,
  WsSourceControlStackDropEntryRpc,
  WsSourceControlStackReorderEntriesRpc,
  WsSourceControlStackRestackRpc,
  WsSourceControlStackSyncRpc,
  WsSourceControlStackSquashEntryRpc,
  WsSourceControlStackSplitEntryRpc,
  WsSourceControlStackPublishRpc,
  WsSourceControlStackContinueOperationRpc,
  WsSourceControlStackAbortOperationRpc,
  WsSubscribeSourceControlStackEventsRpc,
);
