import {
  type GitActionProgressEvent,
  type GitRunStackedActionInput,
  type GitRunStackedActionResult,
  type LocalApi,
  type VcsStatusResult,
  type VcsStatusStreamEvent,
  ORCHESTRATION_WS_METHODS,
  type CreateGlobalActionInput,
  type UpdateGlobalActionInput,
  type ServerSettingsPatch,
  WS_METHODS,
} from "@fenrir/contracts";
import { Effect, Stream } from "effect";

import { type WsRpcProtocolClient } from "./protocol";
import { resetWsReconnectBackoff } from "./wsConnectionState";
import { WsTransport } from "./wsTransport";

type RpcTag = keyof WsRpcProtocolClient & string;
type RpcMethod<TTag extends RpcTag> = WsRpcProtocolClient[TTag];
type RpcInput<TTag extends RpcTag> = Parameters<RpcMethod<TTag>>[0];

interface StreamSubscriptionOptions {
  readonly onResubscribe?: () => void;
}

type RpcUnaryMethod<TTag extends RpcTag> =
  RpcMethod<TTag> extends (input: any, options?: any) => Effect.Effect<infer TSuccess, any, any>
    ? (input: RpcInput<TTag>) => Promise<TSuccess>
    : never;

type RpcUnaryNoArgMethod<TTag extends RpcTag> =
  RpcMethod<TTag> extends (input: any, options?: any) => Effect.Effect<infer TSuccess, any, any>
    ? () => Promise<TSuccess>
    : never;

type RpcStreamMethod<TTag extends RpcTag> =
  RpcMethod<TTag> extends (input: any, options?: any) => Stream.Stream<infer TEvent, any, any>
    ? (listener: (event: TEvent) => void, options?: StreamSubscriptionOptions) => () => void
    : never;

type RpcStreamMethodWithInput<TTag extends RpcTag> =
  RpcMethod<TTag> extends (
    input: infer TInput,
    options?: any,
  ) => Stream.Stream<infer TEvent, any, any>
    ? (
        input: TInput,
        listener: (event: TEvent) => void,
        options?: StreamSubscriptionOptions,
      ) => () => void
    : never;

interface GitRunStackedActionOptions {
  readonly onProgress?: (event: GitActionProgressEvent) => void;
}

interface StackRpcClient {
  readonly getSnapshot: (input: unknown) => Promise<unknown>;
  readonly createEntry: (input: unknown) => Promise<unknown>;
  readonly switchEntry: (input: unknown) => Promise<unknown>;
  readonly renameEntry: (input: unknown) => Promise<unknown>;
  readonly dropEntry: (input: unknown) => Promise<unknown>;
  readonly reorderEntries: (input: unknown) => Promise<unknown>;
  readonly restack: (input: unknown) => Promise<unknown>;
  readonly sync: (input: unknown) => Promise<unknown>;
  readonly squashEntry: (input: unknown) => Promise<unknown>;
  readonly splitEntry: (input: unknown) => Promise<unknown>;
  readonly publish: (input: unknown) => Promise<unknown>;
  readonly continueOperation: (input: unknown) => Promise<unknown>;
  readonly abortOperation: (input: unknown) => Promise<unknown>;
  readonly onEvent: (
    input: unknown,
    listener: (event: unknown) => void,
    options?: StreamSubscriptionOptions,
  ) => () => void;
}

function applyVcsStatusStreamEvent(
  current: VcsStatusResult | null,
  event: VcsStatusStreamEvent,
): VcsStatusResult | null {
  switch (event._tag) {
    case "snapshot":
      return {
        ...event.local,
        ...(event.remote ?? {
          hasUpstream: false,
          aheadCount: 0,
          behindCount: 0,
          pr: null,
        }),
      };
    case "localUpdated":
      if (!current) {
        return null;
      }
      return {
        ...event.local,
        hasUpstream: current.hasUpstream,
        aheadCount: current.aheadCount,
        behindCount: current.behindCount,
        ...(current.aheadOfDefaultCount !== undefined
          ? { aheadOfDefaultCount: current.aheadOfDefaultCount }
          : {}),
        pr: current.pr,
      };
    case "remoteUpdated":
      if (!current) {
        return null;
      }
      return {
        ...current,
        ...(event.remote ?? {
          hasUpstream: false,
          aheadCount: 0,
          behindCount: 0,
          pr: null,
        }),
      };
  }
}

const STACK_WS_METHODS = {
  getSnapshot: "sourceControl.stack.getSnapshot",
  createEntry: "sourceControl.stack.createEntry",
  switchEntry: "sourceControl.stack.switchEntry",
  renameEntry: "sourceControl.stack.renameEntry",
  dropEntry: "sourceControl.stack.dropEntry",
  reorderEntries: "sourceControl.stack.reorderEntries",
  restack: "sourceControl.stack.restack",
  sync: "sourceControl.stack.sync",
  squashEntry: "sourceControl.stack.squashEntry",
  splitEntry: "sourceControl.stack.splitEntry",
  publish: "sourceControl.stack.publish",
  continueOperation: "sourceControl.stack.continueOperation",
  abortOperation: "sourceControl.stack.abortOperation",
  subscribeEvents: "subscribeSourceControlStackEvents",
} as const;

export interface WsRpcClient {
  readonly dispose: () => Promise<void>;
  readonly reconnect: () => Promise<void>;
  readonly isHeartbeatFresh: () => boolean;
  readonly terminal: {
    readonly open: RpcUnaryMethod<typeof WS_METHODS.terminalOpen>;
    readonly write: RpcUnaryMethod<typeof WS_METHODS.terminalWrite>;
    readonly resize: RpcUnaryMethod<typeof WS_METHODS.terminalResize>;
    readonly clear: RpcUnaryMethod<typeof WS_METHODS.terminalClear>;
    readonly restart: RpcUnaryMethod<typeof WS_METHODS.terminalRestart>;
    readonly close: RpcUnaryMethod<typeof WS_METHODS.terminalClose>;
    readonly onEvent: RpcStreamMethod<typeof WS_METHODS.subscribeTerminalEvents>;
    readonly attachTmux: RpcUnaryMethod<typeof WS_METHODS.terminalAttachTmux>;
    readonly detachTmux: RpcUnaryMethod<typeof WS_METHODS.terminalDetachTmux>;
    readonly writeTmux: RpcUnaryMethod<typeof WS_METHODS.terminalWriteTmux>;
    readonly resizeTmux: RpcUnaryMethod<typeof WS_METHODS.terminalResizeTmux>;
  };
  readonly rawTcp: {
    readonly createListener: RpcUnaryMethod<typeof WS_METHODS.rawTcpCreateListener>;
    readonly stopListener: RpcUnaryMethod<typeof WS_METHODS.rawTcpStopListener>;
    readonly listListeners: RpcUnaryNoArgMethod<typeof WS_METHODS.rawTcpListListeners>;
    readonly listSessions: RpcUnaryNoArgMethod<typeof WS_METHODS.rawTcpListSessions>;
    readonly sessionWrite: RpcUnaryMethod<typeof WS_METHODS.rawTcpSessionWrite>;
    readonly sessionUpgradePty: RpcUnaryMethod<typeof WS_METHODS.rawTcpSessionUpgradePty>;
    readonly sessionClose: RpcUnaryMethod<typeof WS_METHODS.rawTcpSessionClose>;
    readonly onEvent: RpcStreamMethod<typeof WS_METHODS.subscribeRawTcpEvents>;
  };
  readonly remoteController: {
    readonly listHosts: RpcUnaryNoArgMethod<typeof WS_METHODS.remoteControllerListHosts>;
    readonly createHost: RpcUnaryMethod<typeof WS_METHODS.remoteControllerCreateHost>;
    readonly updateHost: RpcUnaryMethod<typeof WS_METHODS.remoteControllerUpdateHost>;
    readonly deleteHost: RpcUnaryMethod<typeof WS_METHODS.remoteControllerDeleteHost>;
    readonly startConnection: RpcUnaryMethod<typeof WS_METHODS.remoteControllerStartConnection>;
    readonly stopConnection: RpcUnaryMethod<typeof WS_METHODS.remoteControllerStopConnection>;
    readonly setConnectionPath: RpcUnaryMethod<typeof WS_METHODS.remoteControllerSetConnectionPath>;
    readonly listConnections: RpcUnaryNoArgMethod<
      typeof WS_METHODS.remoteControllerListConnections
    >;
    readonly sendCommand: RpcUnaryMethod<typeof WS_METHODS.remoteControllerSendCommand>;
    readonly listCommandRuns: RpcUnaryMethod<typeof WS_METHODS.remoteControllerListCommandRuns>;
    readonly listDirectory: RpcUnaryMethod<typeof WS_METHODS.remoteControllerListDirectory>;
    readonly onEvent: RpcStreamMethod<typeof WS_METHODS.subscribeRemoteControllerEvents>;
  };
  readonly projects: {
    readonly listEntries: RpcUnaryMethod<typeof WS_METHODS.projectsListEntries>;
    readonly searchEntries: RpcUnaryMethod<typeof WS_METHODS.projectsSearchEntries>;
    readonly readFile: RpcUnaryMethod<typeof WS_METHODS.projectsReadFile>;
    readonly writeFile: RpcUnaryMethod<typeof WS_METHODS.projectsWriteFile>;
    readonly createFile: RpcUnaryMethod<typeof WS_METHODS.projectsCreateFile>;
    readonly createDirectory: RpcUnaryMethod<typeof WS_METHODS.projectsCreateDirectory>;
    readonly removeEntry: RpcUnaryMethod<typeof WS_METHODS.projectsRemoveEntry>;
    readonly moveEntry: RpcUnaryMethod<typeof WS_METHODS.projectsMoveEntry>;
    readonly copyEntry: RpcUnaryMethod<typeof WS_METHODS.projectsCopyEntry>;
  };
  readonly filesystem: {
    readonly browse: RpcUnaryMethod<typeof WS_METHODS.filesystemBrowse>;
  };
  readonly shell: {
    readonly openInEditor: (input: {
      readonly cwd: Parameters<LocalApi["shell"]["openInEditor"]>[0];
      readonly editor: Parameters<LocalApi["shell"]["openInEditor"]>[1];
    }) => ReturnType<LocalApi["shell"]["openInEditor"]>;
  };
  readonly git: {
    readonly runStackedAction: (
      input: GitRunStackedActionInput,
      options?: GitRunStackedActionOptions,
    ) => Promise<GitRunStackedActionResult>;
    readonly resolvePullRequest: RpcUnaryMethod<typeof WS_METHODS.gitResolvePullRequest>;
    readonly preparePullRequestThread: RpcUnaryMethod<
      typeof WS_METHODS.gitPreparePullRequestThread
    >;
  };
  readonly gitDiff: {
    readonly listRepositories: RpcUnaryMethod<typeof WS_METHODS.gitDiffListRepositories>;
    readonly loadChangeSignature: RpcUnaryMethod<typeof WS_METHODS.gitDiffLoadChangeSignature>;
    readonly loadFile: RpcUnaryMethod<typeof WS_METHODS.gitDiffLoadFile>;
    readonly loadFileIndex: RpcUnaryMethod<typeof WS_METHODS.gitDiffLoadFileIndex>;
    readonly loadActiveChangeRequestStackedFileIndex: RpcUnaryMethod<
      typeof WS_METHODS.gitDiffLoadActiveChangeRequestStackedFileIndex
    >;
    readonly loadStackedFileIndex: RpcUnaryMethod<typeof WS_METHODS.gitDiffLoadStackedFileIndex>;
    readonly loadHistory: RpcUnaryMethod<typeof WS_METHODS.gitDiffLoadHistory>;
    readonly loadIgnoreLists: RpcUnaryMethod<typeof WS_METHODS.gitDiffLoadIgnoreLists>;
    readonly createIgnoreList: RpcUnaryMethod<typeof WS_METHODS.gitDiffCreateIgnoreList>;
    readonly updateIgnoreList: RpcUnaryMethod<typeof WS_METHODS.gitDiffUpdateIgnoreList>;
    readonly deleteIgnoreList: RpcUnaryMethod<typeof WS_METHODS.gitDiffDeleteIgnoreList>;
    readonly loadReviewNotes: RpcUnaryMethod<typeof WS_METHODS.gitDiffLoadReviewNotes>;
    readonly createReviewNote: RpcUnaryMethod<typeof WS_METHODS.gitDiffCreateReviewNote>;
    readonly deleteReviewNote: RpcUnaryMethod<typeof WS_METHODS.gitDiffDeleteReviewNote>;
    readonly updateReviewSession: RpcUnaryMethod<typeof WS_METHODS.gitDiffUpdateReviewSession>;
    readonly loadReviewSession: RpcUnaryMethod<typeof WS_METHODS.gitDiffLoadReviewSession>;
    readonly requestReviewNavigation: RpcUnaryMethod<
      typeof WS_METHODS.gitDiffRequestReviewNavigation
    >;
    readonly stageWorktreeChanges: RpcUnaryMethod<typeof WS_METHODS.gitDiffStageWorktreeChanges>;
    readonly unstageStagedChanges: RpcUnaryMethod<typeof WS_METHODS.gitDiffUnstageStagedChanges>;
    readonly discardWorktreeChanges: RpcUnaryMethod<
      typeof WS_METHODS.gitDiffDiscardWorktreeChanges
    >;
    readonly discardWorktreeHunk: RpcUnaryMethod<typeof WS_METHODS.gitDiffDiscardWorktreeHunk>;
    readonly amendStagedChanges: RpcUnaryMethod<typeof WS_METHODS.gitDiffAmendStagedChanges>;
    readonly revertCommit: RpcUnaryMethod<typeof WS_METHODS.gitDiffRevertCommit>;
    readonly cherryPickCommit: RpcUnaryMethod<typeof WS_METHODS.gitDiffCherryPickCommit>;
    readonly loadOperation: RpcUnaryMethod<typeof WS_METHODS.gitDiffLoadOperation>;
    readonly continueOperation: RpcUnaryMethod<typeof WS_METHODS.gitDiffContinueOperation>;
    readonly abortOperation: RpcUnaryMethod<typeof WS_METHODS.gitDiffAbortOperation>;
    readonly loadStashes: RpcUnaryMethod<typeof WS_METHODS.gitDiffLoadStashes>;
    readonly createStash: RpcUnaryMethod<typeof WS_METHODS.gitDiffCreateStash>;
    readonly applyStash: RpcUnaryMethod<typeof WS_METHODS.gitDiffApplyStash>;
    readonly popStash: RpcUnaryMethod<typeof WS_METHODS.gitDiffPopStash>;
    readonly dropStash: RpcUnaryMethod<typeof WS_METHODS.gitDiffDropStash>;
    readonly closeChangeRequest: RpcUnaryMethod<typeof WS_METHODS.gitDiffCloseChangeRequest>;
    readonly mergeChangeRequest: RpcUnaryMethod<typeof WS_METHODS.gitDiffMergeChangeRequest>;
    readonly loadChangeRequestChecks: RpcUnaryMethod<
      typeof WS_METHODS.gitDiffLoadChangeRequestChecks
    >;
    readonly loadChangeRequestReviewThreads: RpcUnaryMethod<
      typeof WS_METHODS.gitDiffLoadChangeRequestReviewThreads
    >;
    readonly commentChangeRequestLines: RpcUnaryMethod<
      typeof WS_METHODS.gitDiffCommentChangeRequestLines
    >;
    readonly revertChangeRequestLines: RpcUnaryMethod<
      typeof WS_METHODS.gitDiffRevertChangeRequestLines
    >;
  };
  readonly vcs: {
    readonly pull: RpcUnaryMethod<typeof WS_METHODS.vcsPull>;
    readonly refreshStatus: RpcUnaryMethod<typeof WS_METHODS.vcsRefreshStatus>;
    readonly onStatus: (
      input: RpcInput<typeof WS_METHODS.subscribeVcsStatus>,
      listener: (status: VcsStatusResult) => void,
      options?: StreamSubscriptionOptions,
    ) => () => void;
    readonly listRefs: RpcUnaryMethod<typeof WS_METHODS.vcsListRefs>;
    readonly createWorktree: RpcUnaryMethod<typeof WS_METHODS.vcsCreateWorktree>;
    readonly removeWorktree: RpcUnaryMethod<typeof WS_METHODS.vcsRemoveWorktree>;
    readonly createRef: RpcUnaryMethod<typeof WS_METHODS.vcsCreateRef>;
    readonly switchRef: RpcUnaryMethod<typeof WS_METHODS.vcsSwitchRef>;
    readonly init: RpcUnaryMethod<typeof WS_METHODS.vcsInit>;
  };
  readonly server: {
    readonly getConfig: RpcUnaryNoArgMethod<typeof WS_METHODS.serverGetConfig>;
    readonly listProviderSkills: RpcUnaryMethod<typeof WS_METHODS.serverListProviderSkills>;
    readonly refreshProviders: (
      input?: RpcInput<typeof WS_METHODS.serverRefreshProviders>,
    ) => ReturnType<RpcUnaryMethod<typeof WS_METHODS.serverRefreshProviders>>;
    readonly updateProvider: (
      input: Parameters<LocalApi["server"]["updateProvider"]>[0],
    ) => ReturnType<LocalApi["server"]["updateProvider"]>;
    readonly upsertKeybinding: RpcUnaryMethod<typeof WS_METHODS.serverUpsertKeybinding>;
    readonly removeKeybinding: RpcUnaryMethod<typeof WS_METHODS.serverRemoveKeybinding>;
    readonly getTraceDiagnostics: RpcUnaryNoArgMethod<typeof WS_METHODS.serverGetTraceDiagnostics>;
    readonly getProcessDiagnostics: RpcUnaryNoArgMethod<
      typeof WS_METHODS.serverGetProcessDiagnostics
    >;
    readonly getProcessResourceHistory: RpcUnaryMethod<
      typeof WS_METHODS.serverGetProcessResourceHistory
    >;
    readonly signalProcess: RpcUnaryMethod<typeof WS_METHODS.serverSignalProcess>;
    readonly getSettings: RpcUnaryNoArgMethod<typeof WS_METHODS.serverGetSettings>;
    readonly updateSettings: (
      patch: ServerSettingsPatch,
    ) => ReturnType<RpcUnaryMethod<typeof WS_METHODS.serverUpdateSettings>>;
    readonly discoverSourceControl: RpcUnaryNoArgMethod<
      typeof WS_METHODS.serverDiscoverSourceControl
    >;
    readonly getGlobalActions: RpcUnaryNoArgMethod<typeof WS_METHODS.serverGetGlobalActions>;
    readonly createGlobalAction: (
      input: CreateGlobalActionInput,
    ) => ReturnType<RpcUnaryMethod<typeof WS_METHODS.serverCreateGlobalAction>>;
    readonly updateGlobalAction: (
      id: string,
      input: UpdateGlobalActionInput,
    ) => ReturnType<RpcUnaryMethod<typeof WS_METHODS.serverUpdateGlobalAction>>;
    readonly deleteGlobalAction: (
      id: string,
    ) => ReturnType<RpcUnaryMethod<typeof WS_METHODS.serverDeleteGlobalAction>>;
    readonly subscribeConfig: RpcStreamMethod<typeof WS_METHODS.subscribeServerConfig>;
    readonly subscribeLifecycle: RpcStreamMethod<typeof WS_METHODS.subscribeServerLifecycle>;
    readonly subscribeAuthAccess: RpcStreamMethod<typeof WS_METHODS.subscribeAuthAccess>;
  };
  readonly trafficLens: {
    readonly getTraffic: RpcUnaryMethod<typeof WS_METHODS.trafficLensGetTraffic>;
    readonly getTrafficDetail: RpcUnaryMethod<typeof WS_METHODS.trafficLensGetTrafficDetail>;
    readonly clearTraffic: RpcUnaryMethod<typeof WS_METHODS.trafficLensClearTraffic>;
    readonly replayRequest: RpcUnaryMethod<typeof WS_METHODS.trafficLensReplayRequest>;
    readonly listFindings: RpcUnaryMethod<typeof WS_METHODS.trafficLensListFindings>;
    readonly listRules: RpcUnaryNoArgMethod<typeof WS_METHODS.trafficLensListRules>;
    readonly upsertRule: RpcUnaryMethod<typeof WS_METHODS.trafficLensUpsertRule>;
    readonly deleteRule: RpcUnaryMethod<typeof WS_METHODS.trafficLensDeleteRule>;
    readonly listOverrides: RpcUnaryNoArgMethod<typeof WS_METHODS.trafficLensListOverrides>;
    readonly upsertOverride: RpcUnaryMethod<typeof WS_METHODS.trafficLensUpsertOverride>;
    readonly deleteOverride: RpcUnaryMethod<typeof WS_METHODS.trafficLensDeleteOverride>;
    readonly listProfiles: RpcUnaryNoArgMethod<typeof WS_METHODS.trafficLensListProfiles>;
    readonly upsertProfile: RpcUnaryMethod<typeof WS_METHODS.trafficLensUpsertProfile>;
    readonly deleteProfile: RpcUnaryMethod<typeof WS_METHODS.trafficLensDeleteProfile>;
    readonly listStorageOrigins: RpcUnaryMethod<typeof WS_METHODS.trafficLensListStorageOrigins>;
    readonly getCookieSnapshot: RpcUnaryMethod<typeof WS_METHODS.trafficLensGetCookieSnapshot>;
    readonly getLocalStorageSnapshot: RpcUnaryMethod<
      typeof WS_METHODS.trafficLensGetLocalStorageSnapshot
    >;
    readonly listSessionStorageSnapshots: RpcUnaryMethod<
      typeof WS_METHODS.trafficLensListSessionStorageSnapshots
    >;
    readonly getSessionStorageSnapshot: RpcUnaryMethod<
      typeof WS_METHODS.trafficLensGetSessionStorageSnapshot
    >;
    readonly updateSessionStorageSnapshot: RpcUnaryMethod<
      typeof WS_METHODS.trafficLensUpdateSessionStorageSnapshot
    >;
    readonly getStorageVersions: RpcUnaryMethod<typeof WS_METHODS.trafficLensGetStorageVersions>;
    readonly clearPersistedOrigin: RpcUnaryMethod<
      typeof WS_METHODS.trafficLensClearPersistedOrigin
    >;
    readonly onEvent: RpcStreamMethod<typeof WS_METHODS.subscribeTrafficLensEvents>;
  };
  readonly localServers: {
    readonly subscribe: RpcStreamMethod<typeof WS_METHODS.subscribeLocalServers>;
  };
  readonly planRunner: {
    readonly listFeatures: RpcUnaryMethod<typeof WS_METHODS.planRunnerListFeatures>;
    readonly getFeaturePlans: RpcUnaryMethod<typeof WS_METHODS.planRunnerGetFeaturePlans>;
    readonly getFeatureRun: RpcUnaryMethod<typeof WS_METHODS.planRunnerGetFeatureRun>;
    readonly listRuns: RpcUnaryMethod<typeof WS_METHODS.planRunnerListRuns>;
    readonly start: RpcUnaryMethod<typeof WS_METHODS.planRunnerStart>;
    readonly rerunFromFailure: RpcUnaryMethod<typeof WS_METHODS.planRunnerRerunFromFailure>;
    readonly getStatus: RpcUnaryMethod<typeof WS_METHODS.planRunnerGetStatus>;
    readonly cancel: RpcUnaryMethod<typeof WS_METHODS.planRunnerCancel>;
    readonly stop: RpcUnaryMethod<typeof WS_METHODS.planRunnerStop>;
    readonly resume: RpcUnaryMethod<typeof WS_METHODS.planRunnerResume>;
    readonly getStepLog: RpcUnaryMethod<typeof WS_METHODS.planRunnerGetStepLog>;
    readonly archiveFeature: RpcUnaryMethod<typeof WS_METHODS.planRunnerArchiveFeature>;
    readonly unarchiveFeature: RpcUnaryMethod<typeof WS_METHODS.planRunnerUnarchiveFeature>;
    readonly listArchivedFeatures: RpcUnaryMethod<typeof WS_METHODS.planRunnerListArchivedFeatures>;
    readonly renameFeature: RpcUnaryMethod<typeof WS_METHODS.planRunnerRenameFeature>;
    readonly onEvent: RpcStreamMethod<typeof WS_METHODS.subscribePlanRunnerEvents>;
  };
  readonly workflows: {
    readonly createDraft: RpcUnaryMethod<typeof WS_METHODS.workflowsCreateDraft>;
    readonly listThread: RpcUnaryMethod<typeof WS_METHODS.workflowsListThread>;
    readonly openSource: RpcUnaryMethod<typeof WS_METHODS.workflowsOpenSource>;
    readonly syncSource: RpcUnaryMethod<typeof WS_METHODS.workflowsSyncSource>;
    readonly validate: RpcUnaryMethod<typeof WS_METHODS.workflowsValidate>;
    readonly archive: RpcUnaryMethod<typeof WS_METHODS.workflowsArchive>;
    readonly run: RpcUnaryMethod<typeof WS_METHODS.workflowsRun>;
    readonly stop: RpcUnaryMethod<typeof WS_METHODS.workflowsStop>;
    readonly respondToInput: RpcUnaryMethod<typeof WS_METHODS.workflowsRespondToInput>;
    readonly getRun: RpcUnaryMethod<typeof WS_METHODS.workflowsGetRun>;
    readonly getTimeline: RpcUnaryMethod<typeof WS_METHODS.workflowsGetTimeline>;
    readonly onEvent: RpcStreamMethod<typeof WS_METHODS.subscribeWorkflowEvents>;
  };
  readonly managedProcess: {
    readonly list: RpcUnaryMethod<typeof WS_METHODS.managedProcessList>;
    readonly start: RpcUnaryMethod<typeof WS_METHODS.managedProcessStart>;
    readonly stop: RpcUnaryMethod<typeof WS_METHODS.managedProcessStop>;
    readonly forceKill: RpcUnaryMethod<typeof WS_METHODS.managedProcessForceKill>;
    readonly restart: RpcUnaryMethod<typeof WS_METHODS.managedProcessRestart>;
    readonly writeStdin: RpcUnaryMethod<typeof WS_METHODS.managedProcessWriteStdin>;
    readonly upsertDefinition: RpcUnaryMethod<typeof WS_METHODS.managedProcessUpsertDefinition>;
    readonly deleteDefinition: RpcUnaryMethod<typeof WS_METHODS.managedProcessDeleteDefinition>;
    readonly proposedImports: RpcUnaryMethod<typeof WS_METHODS.managedProcessProposedImports>;
    readonly subscribeLog: RpcStreamMethodWithInput<typeof WS_METHODS.managedProcessSubscribeLog>;
  };
  readonly orchestration: {
    readonly getBootstrapSnapshot: RpcUnaryNoArgMethod<
      typeof ORCHESTRATION_WS_METHODS.getBootstrapSnapshot
    >;
    readonly getArchivedShellSnapshot: RpcUnaryNoArgMethod<
      typeof ORCHESTRATION_WS_METHODS.getArchivedShellSnapshot
    >;
    readonly subscribeShell: RpcStreamMethod<typeof ORCHESTRATION_WS_METHODS.subscribeShell>;
    readonly subscribeManagedProcesses: RpcStreamMethod<
      typeof ORCHESTRATION_WS_METHODS.subscribeManagedProcesses
    >;
    readonly getSnapshot: RpcUnaryNoArgMethod<typeof ORCHESTRATION_WS_METHODS.getSnapshot>;
    readonly getThreadSnapshot: RpcUnaryMethod<typeof ORCHESTRATION_WS_METHODS.getThreadSnapshot>;
    readonly dispatchCommand: RpcUnaryMethod<typeof ORCHESTRATION_WS_METHODS.dispatchCommand>;
    readonly getTurnDiff: RpcUnaryMethod<typeof ORCHESTRATION_WS_METHODS.getTurnDiff>;
    readonly getFullThreadDiff: RpcUnaryMethod<typeof ORCHESTRATION_WS_METHODS.getFullThreadDiff>;
    readonly replayEvents: RpcUnaryMethod<typeof ORCHESTRATION_WS_METHODS.replayEvents>;
    readonly onDomainEvent: RpcStreamMethod<typeof WS_METHODS.subscribeOrchestrationDomainEvents>;
  };
  readonly sourceControl: {
    readonly lookupRepository: RpcUnaryMethod<typeof WS_METHODS.sourceControlLookupRepository>;
    readonly cloneRepository: RpcUnaryMethod<typeof WS_METHODS.sourceControlCloneRepository>;
    readonly publishRepository: RpcUnaryMethod<typeof WS_METHODS.sourceControlPublishRepository>;
    readonly stack: StackRpcClient;
  };
}

export function createWsRpcClient(transport: WsTransport): WsRpcClient {
  const sourceControlRequest = (method: string, input: unknown) =>
    transport.request(
      (client) =>
        (
          client as unknown as Record<
            string,
            ((value: unknown) => Effect.Effect<unknown, Error, never>) | undefined
          >
        )[method]?.(input) as Effect.Effect<unknown, Error, never>,
    );
  const sourceControlSubscribe = (
    method: string,
    input: unknown,
    listener: (event: unknown) => void,
    options?: StreamSubscriptionOptions,
  ) =>
    transport.subscribe(
      (client) =>
        (
          client as unknown as Record<
            string,
            ((value: unknown) => Stream.Stream<unknown, Error, never>) | undefined
          >
        )[method]?.(input) as Stream.Stream<unknown, Error, never>,
      listener,
      options,
    );
  const stackRequest = (method: string, input: unknown) => sourceControlRequest(method, input);
  const stackSubscribe = (
    method: string,
    input: unknown,
    listener: (event: unknown) => void,
    options?: StreamSubscriptionOptions,
  ) => sourceControlSubscribe(method, input, listener, options);

  const stackClient: StackRpcClient = {
    getSnapshot: (input) => stackRequest(STACK_WS_METHODS.getSnapshot, input),
    createEntry: (input) => stackRequest(STACK_WS_METHODS.createEntry, input),
    switchEntry: (input) => stackRequest(STACK_WS_METHODS.switchEntry, input),
    renameEntry: (input) => stackRequest(STACK_WS_METHODS.renameEntry, input),
    dropEntry: (input) => stackRequest(STACK_WS_METHODS.dropEntry, input),
    reorderEntries: (input) => stackRequest(STACK_WS_METHODS.reorderEntries, input),
    restack: (input) => stackRequest(STACK_WS_METHODS.restack, input),
    sync: (input) => stackRequest(STACK_WS_METHODS.sync, input),
    squashEntry: (input) => stackRequest(STACK_WS_METHODS.squashEntry, input),
    splitEntry: (input) => stackRequest(STACK_WS_METHODS.splitEntry, input),
    publish: (input) => stackRequest(STACK_WS_METHODS.publish, input),
    continueOperation: (input) => stackRequest(STACK_WS_METHODS.continueOperation, input),
    abortOperation: (input) => stackRequest(STACK_WS_METHODS.abortOperation, input),
    onEvent: (input, listener, options) =>
      stackSubscribe(STACK_WS_METHODS.subscribeEvents, input, listener, options),
  };

  return {
    dispose: () => transport.dispose(),
    reconnect: async () => {
      resetWsReconnectBackoff();
      await transport.reconnect();
    },
    isHeartbeatFresh: () => transport.isHeartbeatFresh(),
    terminal: {
      open: (input) => transport.request((client) => client[WS_METHODS.terminalOpen](input)),
      write: (input) => transport.request((client) => client[WS_METHODS.terminalWrite](input)),
      resize: (input) => transport.request((client) => client[WS_METHODS.terminalResize](input)),
      clear: (input) => transport.request((client) => client[WS_METHODS.terminalClear](input)),
      restart: (input) => transport.request((client) => client[WS_METHODS.terminalRestart](input)),
      close: (input) => transport.request((client) => client[WS_METHODS.terminalClose](input)),
      onEvent: (listener, options) =>
        transport.subscribe(
          (client) => client[WS_METHODS.subscribeTerminalEvents]({}),
          listener,
          options,
        ),

      attachTmux: (input) =>
        transport.request((client) => client[WS_METHODS.terminalAttachTmux](input)),

      detachTmux: (input) =>
        transport.request((client) => client[WS_METHODS.terminalDetachTmux](input)),

      writeTmux: (input) =>
        transport.request((client) => client[WS_METHODS.terminalWriteTmux](input)),

      resizeTmux: (input) =>
        transport.request((client) => client[WS_METHODS.terminalResizeTmux](input)),
    },
    rawTcp: {
      createListener: (input) =>
        transport.request((client) => client[WS_METHODS.rawTcpCreateListener](input)),
      stopListener: (input) =>
        transport.request((client) => client[WS_METHODS.rawTcpStopListener](input)),
      listListeners: () =>
        transport.request((client) => client[WS_METHODS.rawTcpListListeners]({})),
      listSessions: () => transport.request((client) => client[WS_METHODS.rawTcpListSessions]({})),
      sessionWrite: (input) =>
        transport.request((client) => client[WS_METHODS.rawTcpSessionWrite](input)),
      sessionUpgradePty: (input) =>
        transport.request((client) => client[WS_METHODS.rawTcpSessionUpgradePty](input)),
      sessionClose: (input) =>
        transport.request((client) => client[WS_METHODS.rawTcpSessionClose](input)),
      onEvent: (listener, options) =>
        transport.subscribe(
          (client) => client[WS_METHODS.subscribeRawTcpEvents]({}),
          listener,
          options,
        ),
    },
    remoteController: {
      listHosts: () =>
        transport.request((client) => client[WS_METHODS.remoteControllerListHosts]({})),
      createHost: (input) =>
        transport.request((client) => client[WS_METHODS.remoteControllerCreateHost](input)),
      updateHost: (input) =>
        transport.request((client) => client[WS_METHODS.remoteControllerUpdateHost](input)),
      deleteHost: (input) =>
        transport.request((client) => client[WS_METHODS.remoteControllerDeleteHost](input)),
      startConnection: (input) =>
        transport.request((client) => client[WS_METHODS.remoteControllerStartConnection](input)),
      stopConnection: (input) =>
        transport.request((client) => client[WS_METHODS.remoteControllerStopConnection](input)),
      setConnectionPath: (input) =>
        transport.request((client) => client[WS_METHODS.remoteControllerSetConnectionPath](input)),
      listConnections: () =>
        transport.request((client) => client[WS_METHODS.remoteControllerListConnections]({})),
      sendCommand: (input) =>
        transport.request((client) => client[WS_METHODS.remoteControllerSendCommand](input)),
      listCommandRuns: (input) =>
        transport.request((client) => client[WS_METHODS.remoteControllerListCommandRuns](input)),
      listDirectory: (input) =>
        transport.request((client) => client[WS_METHODS.remoteControllerListDirectory](input)),
      onEvent: (listener, options) =>
        transport.subscribe(
          (client) => client[WS_METHODS.subscribeRemoteControllerEvents]({}),
          listener,
          options,
        ),
    },
    projects: {
      listEntries: (input) =>
        transport.request((client) => client[WS_METHODS.projectsListEntries](input)),
      searchEntries: (input) =>
        transport.request((client) => client[WS_METHODS.projectsSearchEntries](input)),
      readFile: (input) =>
        transport.request((client) => client[WS_METHODS.projectsReadFile](input)),
      writeFile: (input) =>
        transport.request((client) => client[WS_METHODS.projectsWriteFile](input)),
      createFile: (input) =>
        transport.request((client) => client[WS_METHODS.projectsCreateFile](input)),
      createDirectory: (input) =>
        transport.request((client) => client[WS_METHODS.projectsCreateDirectory](input)),
      removeEntry: (input) =>
        transport.request((client) => client[WS_METHODS.projectsRemoveEntry](input)),
      moveEntry: (input) =>
        transport.request((client) => client[WS_METHODS.projectsMoveEntry](input)),
      copyEntry: (input) =>
        transport.request((client) => client[WS_METHODS.projectsCopyEntry](input)),
    },
    filesystem: {
      browse: (input) => transport.request((client) => client[WS_METHODS.filesystemBrowse](input)),
    },
    shell: {
      openInEditor: (input) =>
        transport.request((client) => client[WS_METHODS.shellOpenInEditor](input)),
    },
    git: {
      runStackedAction: async (input, options) => {
        let result: GitRunStackedActionResult | null = null;

        await transport.requestStream(
          (client) => client[WS_METHODS.gitRunStackedAction](input),
          (event) => {
            options?.onProgress?.(event);
            if (event.kind === "action_finished") {
              result = event.result;
            }
          },
        );

        if (result) {
          return result;
        }

        throw new Error("Git action stream completed without a final result.");
      },
      resolvePullRequest: (input) =>
        transport.request((client) => client[WS_METHODS.gitResolvePullRequest](input)),
      preparePullRequestThread: (input) =>
        transport.request((client) => client[WS_METHODS.gitPreparePullRequestThread](input)),
    },
    gitDiff: {
      listRepositories: (input) =>
        transport.request((client) => client[WS_METHODS.gitDiffListRepositories](input)),
      loadChangeSignature: (input) =>
        transport.request((client) => client[WS_METHODS.gitDiffLoadChangeSignature](input)),
      loadFile: (input) => transport.request((client) => client[WS_METHODS.gitDiffLoadFile](input)),
      loadFileIndex: (input) =>
        transport.request((client) => client[WS_METHODS.gitDiffLoadFileIndex](input)),
      loadActiveChangeRequestStackedFileIndex: (input) =>
        transport.request((client) =>
          client[WS_METHODS.gitDiffLoadActiveChangeRequestStackedFileIndex](input),
        ),
      loadStackedFileIndex: (input) =>
        transport.request((client) => client[WS_METHODS.gitDiffLoadStackedFileIndex](input)),
      loadHistory: (input) =>
        transport.request((client) => client[WS_METHODS.gitDiffLoadHistory](input)),
      loadIgnoreLists: (input) =>
        transport.request((client) => client[WS_METHODS.gitDiffLoadIgnoreLists](input)),
      createIgnoreList: (input) =>
        transport.request((client) => client[WS_METHODS.gitDiffCreateIgnoreList](input)),
      updateIgnoreList: (input) =>
        transport.request((client) => client[WS_METHODS.gitDiffUpdateIgnoreList](input)),
      deleteIgnoreList: (input) =>
        transport.request((client) => client[WS_METHODS.gitDiffDeleteIgnoreList](input)),
      loadReviewNotes: (input) =>
        transport.request((client) => client[WS_METHODS.gitDiffLoadReviewNotes](input)),
      createReviewNote: (input) =>
        transport.request((client) => client[WS_METHODS.gitDiffCreateReviewNote](input)),
      deleteReviewNote: (input) =>
        transport.request((client) => client[WS_METHODS.gitDiffDeleteReviewNote](input)),
      updateReviewSession: (input) =>
        transport.request((client) => client[WS_METHODS.gitDiffUpdateReviewSession](input)),
      loadReviewSession: (input) =>
        transport.request((client) => client[WS_METHODS.gitDiffLoadReviewSession](input)),
      requestReviewNavigation: (input) =>
        transport.request((client) => client[WS_METHODS.gitDiffRequestReviewNavigation](input)),
      stageWorktreeChanges: (input) =>
        transport.request((client) => client[WS_METHODS.gitDiffStageWorktreeChanges](input)),
      unstageStagedChanges: (input) =>
        transport.request((client) => client[WS_METHODS.gitDiffUnstageStagedChanges](input)),
      discardWorktreeChanges: (input) =>
        transport.request((client) => client[WS_METHODS.gitDiffDiscardWorktreeChanges](input)),
      discardWorktreeHunk: (input) =>
        transport.request((client) => client[WS_METHODS.gitDiffDiscardWorktreeHunk](input)),
      amendStagedChanges: (input) =>
        transport.request((client) => client[WS_METHODS.gitDiffAmendStagedChanges](input)),
      revertCommit: (input) =>
        transport.request((client) => client[WS_METHODS.gitDiffRevertCommit](input)),
      cherryPickCommit: (input) =>
        transport.request((client) => client[WS_METHODS.gitDiffCherryPickCommit](input)),
      loadOperation: (input) =>
        transport.request((client) => client[WS_METHODS.gitDiffLoadOperation](input)),
      continueOperation: (input) =>
        transport.request((client) => client[WS_METHODS.gitDiffContinueOperation](input)),
      abortOperation: (input) =>
        transport.request((client) => client[WS_METHODS.gitDiffAbortOperation](input)),
      loadStashes: (input) =>
        transport.request((client) => client[WS_METHODS.gitDiffLoadStashes](input)),
      createStash: (input) =>
        transport.request((client) => client[WS_METHODS.gitDiffCreateStash](input)),
      applyStash: (input) =>
        transport.request((client) => client[WS_METHODS.gitDiffApplyStash](input)),
      popStash: (input) => transport.request((client) => client[WS_METHODS.gitDiffPopStash](input)),
      dropStash: (input) =>
        transport.request((client) => client[WS_METHODS.gitDiffDropStash](input)),
      closeChangeRequest: (input) =>
        transport.request((client) => client[WS_METHODS.gitDiffCloseChangeRequest](input)),
      mergeChangeRequest: (input) =>
        transport.request((client) => client[WS_METHODS.gitDiffMergeChangeRequest](input)),
      loadChangeRequestChecks: (input) =>
        transport.request((client) => client[WS_METHODS.gitDiffLoadChangeRequestChecks](input)),
      loadChangeRequestReviewThreads: (input) =>
        transport.request((client) =>
          client[WS_METHODS.gitDiffLoadChangeRequestReviewThreads](input),
        ),
      commentChangeRequestLines: (input) =>
        transport.request((client) => client[WS_METHODS.gitDiffCommentChangeRequestLines](input)),
      revertChangeRequestLines: (input) =>
        transport.request((client) => client[WS_METHODS.gitDiffRevertChangeRequestLines](input)),
    },
    vcs: {
      pull: (input) => transport.request((client) => client[WS_METHODS.vcsPull](input)),
      refreshStatus: (input) =>
        transport.request((client) => client[WS_METHODS.vcsRefreshStatus](input)),
      onStatus: (input, listener, options) => {
        let current: VcsStatusResult | null = null;
        return transport.subscribe(
          (client) => client[WS_METHODS.subscribeVcsStatus](input),
          (event: VcsStatusStreamEvent) => {
            current = applyVcsStatusStreamEvent(current, event);
            if (current) {
              listener(current);
            }
          },
          options,
        );
      },
      listRefs: (input) => transport.request((client) => client[WS_METHODS.vcsListRefs](input)),
      createWorktree: (input) =>
        transport.request((client) => client[WS_METHODS.vcsCreateWorktree](input)),
      removeWorktree: (input) =>
        transport.request((client) => client[WS_METHODS.vcsRemoveWorktree](input)),
      createRef: (input) => transport.request((client) => client[WS_METHODS.vcsCreateRef](input)),
      switchRef: (input) => transport.request((client) => client[WS_METHODS.vcsSwitchRef](input)),
      init: (input) => transport.request((client) => client[WS_METHODS.vcsInit](input)),
    },
    server: {
      getConfig: () => transport.request((client) => client[WS_METHODS.serverGetConfig]({})),
      listProviderSkills: (input) =>
        transport.request((client) => client[WS_METHODS.serverListProviderSkills](input)),
      refreshProviders: (input) =>
        transport.request((client) => client[WS_METHODS.serverRefreshProviders](input ?? {})),
      updateProvider: (input) =>
        transport.request((client) => client[WS_METHODS.serverUpdateProvider](input)),
      upsertKeybinding: (input) =>
        transport.request((client) => client[WS_METHODS.serverUpsertKeybinding](input)),
      removeKeybinding: (input) =>
        transport.request((client) => client[WS_METHODS.serverRemoveKeybinding](input)),
      getTraceDiagnostics: () =>
        transport.request((client) => client[WS_METHODS.serverGetTraceDiagnostics]({})),
      getProcessDiagnostics: () =>
        transport.request((client) => client[WS_METHODS.serverGetProcessDiagnostics]({})),
      getProcessResourceHistory: (input) =>
        transport.request((client) => client[WS_METHODS.serverGetProcessResourceHistory](input)),
      signalProcess: (input) =>
        transport.request((client) => client[WS_METHODS.serverSignalProcess](input)),
      getSettings: () => transport.request((client) => client[WS_METHODS.serverGetSettings]({})),
      updateSettings: (patch) =>
        transport.request((client) => client[WS_METHODS.serverUpdateSettings]({ patch })),
      discoverSourceControl: () =>
        transport.request((client) => client[WS_METHODS.serverDiscoverSourceControl]({})),
      getGlobalActions: () =>
        transport.request((client) => client[WS_METHODS.serverGetGlobalActions]({})),
      createGlobalAction: (input) =>
        transport.request((client) => client[WS_METHODS.serverCreateGlobalAction](input)),
      updateGlobalAction: (id, input) =>
        transport.request((client) =>
          client[WS_METHODS.serverUpdateGlobalAction]({ id, ...input }),
        ),
      deleteGlobalAction: (id) =>
        transport.request((client) => client[WS_METHODS.serverDeleteGlobalAction]({ id })),
      subscribeConfig: (listener, options) =>
        transport.subscribe(
          (client) => client[WS_METHODS.subscribeServerConfig]({}),
          listener,
          options,
        ),
      subscribeLifecycle: (listener, options) =>
        transport.subscribe(
          (client) => client[WS_METHODS.subscribeServerLifecycle]({}),
          listener,
          options,
        ),
      subscribeAuthAccess: (listener, options) =>
        transport.subscribe(
          (client) => client[WS_METHODS.subscribeAuthAccess]({}),
          listener,
          options,
        ),
    },
    trafficLens: {
      getTraffic: (input) =>
        transport.request((client) => client[WS_METHODS.trafficLensGetTraffic](input)),
      getTrafficDetail: (input) =>
        transport.request((client) => client[WS_METHODS.trafficLensGetTrafficDetail](input)),
      clearTraffic: (input) =>
        transport.request((client) => client[WS_METHODS.trafficLensClearTraffic](input)),
      replayRequest: (input) =>
        transport.request((client) => client[WS_METHODS.trafficLensReplayRequest](input)),
      listFindings: (input) =>
        transport.request((client) => client[WS_METHODS.trafficLensListFindings](input)),
      listRules: () => transport.request((client) => client[WS_METHODS.trafficLensListRules]({})),
      upsertRule: (input) =>
        transport.request((client) => client[WS_METHODS.trafficLensUpsertRule](input)),
      deleteRule: (input) =>
        transport.request((client) => client[WS_METHODS.trafficLensDeleteRule](input)),
      listOverrides: () =>
        transport.request((client) => client[WS_METHODS.trafficLensListOverrides]({})),
      upsertOverride: (input) =>
        transport.request((client) => client[WS_METHODS.trafficLensUpsertOverride](input)),
      deleteOverride: (input) =>
        transport.request((client) => client[WS_METHODS.trafficLensDeleteOverride](input)),
      listProfiles: () =>
        transport.request((client) => client[WS_METHODS.trafficLensListProfiles]({})),
      upsertProfile: (input) =>
        transport.request((client) => client[WS_METHODS.trafficLensUpsertProfile](input)),
      deleteProfile: (input) =>
        transport.request((client) => client[WS_METHODS.trafficLensDeleteProfile](input)),
      listStorageOrigins: (input) =>
        transport.request((client) => client[WS_METHODS.trafficLensListStorageOrigins](input)),
      getCookieSnapshot: (input) =>
        transport.request((client) => client[WS_METHODS.trafficLensGetCookieSnapshot](input)),
      getLocalStorageSnapshot: (input) =>
        transport.request((client) => client[WS_METHODS.trafficLensGetLocalStorageSnapshot](input)),
      listSessionStorageSnapshots: (input) =>
        transport.request((client) =>
          client[WS_METHODS.trafficLensListSessionStorageSnapshots](input),
        ),
      getSessionStorageSnapshot: (input) =>
        transport.request((client) =>
          client[WS_METHODS.trafficLensGetSessionStorageSnapshot](input),
        ),
      updateSessionStorageSnapshot: (input) =>
        transport.request((client) =>
          client[WS_METHODS.trafficLensUpdateSessionStorageSnapshot](input),
        ),
      getStorageVersions: (input) =>
        transport.request((client) => client[WS_METHODS.trafficLensGetStorageVersions](input)),
      clearPersistedOrigin: (input) =>
        transport.request((client) => client[WS_METHODS.trafficLensClearPersistedOrigin](input)),
      onEvent: (listener, options) =>
        transport.subscribe(
          (client) => client[WS_METHODS.subscribeTrafficLensEvents]({}),
          listener,
          options,
        ),
    },
    localServers: {
      subscribe: (listener, options) =>
        transport.subscribe(
          (client) => client[WS_METHODS.subscribeLocalServers]({}),
          listener,
          options,
        ),
    },
    planRunner: {
      listFeatures: (input) =>
        transport.request((client) => client[WS_METHODS.planRunnerListFeatures](input)),
      getFeaturePlans: (input) =>
        transport.request((client) => client[WS_METHODS.planRunnerGetFeaturePlans](input)),
      getFeatureRun: (input) =>
        transport.request((client) => client[WS_METHODS.planRunnerGetFeatureRun](input)),
      listRuns: (input) =>
        transport.request((client) => client[WS_METHODS.planRunnerListRuns](input)),
      start: (input) => transport.request((client) => client[WS_METHODS.planRunnerStart](input)),
      rerunFromFailure: (input) =>
        transport.request((client) => client[WS_METHODS.planRunnerRerunFromFailure](input)),
      getStatus: (input) =>
        transport.request((client) => client[WS_METHODS.planRunnerGetStatus](input)),
      cancel: (input) => transport.request((client) => client[WS_METHODS.planRunnerCancel](input)),
      stop: (input) => transport.request((client) => client[WS_METHODS.planRunnerStop](input)),
      resume: (input) => transport.request((client) => client[WS_METHODS.planRunnerResume](input)),
      getStepLog: (input) =>
        transport.request((client) => client[WS_METHODS.planRunnerGetStepLog](input)),
      archiveFeature: (input) =>
        transport.request((client) => client[WS_METHODS.planRunnerArchiveFeature](input)),
      unarchiveFeature: (input) =>
        transport.request((client) => client[WS_METHODS.planRunnerUnarchiveFeature](input)),
      listArchivedFeatures: (input) =>
        transport.request((client) => client[WS_METHODS.planRunnerListArchivedFeatures](input)),
      renameFeature: (input) =>
        transport.request((client) => client[WS_METHODS.planRunnerRenameFeature](input)),
      onEvent: (listener, options) =>
        transport.subscribe(
          (client) => client[WS_METHODS.subscribePlanRunnerEvents]({}),
          listener,
          options,
        ),
    },
    workflows: {
      createDraft: (input) =>
        transport.request((client) => client[WS_METHODS.workflowsCreateDraft](input)),
      listThread: (input) =>
        transport.request((client) => client[WS_METHODS.workflowsListThread](input)),
      openSource: (input) =>
        transport.request((client) => client[WS_METHODS.workflowsOpenSource](input)),
      syncSource: (input) =>
        transport.request((client) => client[WS_METHODS.workflowsSyncSource](input)),
      validate: (input) =>
        transport.request((client) => client[WS_METHODS.workflowsValidate](input)),
      archive: (input) => transport.request((client) => client[WS_METHODS.workflowsArchive](input)),
      run: (input) => transport.request((client) => client[WS_METHODS.workflowsRun](input)),
      stop: (input) => transport.request((client) => client[WS_METHODS.workflowsStop](input)),
      respondToInput: (input) =>
        transport.request((client) => client[WS_METHODS.workflowsRespondToInput](input)),
      getRun: (input) => transport.request((client) => client[WS_METHODS.workflowsGetRun](input)),
      getTimeline: (input) =>
        transport.request((client) => client[WS_METHODS.workflowsGetTimeline](input)),
      onEvent: (listener, options) =>
        transport.subscribe(
          (client) => client[WS_METHODS.subscribeWorkflowEvents]({}),
          listener,
          options,
        ),
    },
    managedProcess: {
      list: (input) => transport.request((client) => client[WS_METHODS.managedProcessList](input)),
      start: (input) =>
        transport.request((client) => client[WS_METHODS.managedProcessStart](input)),
      stop: (input) => transport.request((client) => client[WS_METHODS.managedProcessStop](input)),
      forceKill: (input) =>
        transport.request((client) => client[WS_METHODS.managedProcessForceKill](input)),
      restart: (input) =>
        transport.request((client) => client[WS_METHODS.managedProcessRestart](input)),
      writeStdin: (input) =>
        transport.request((client) => client[WS_METHODS.managedProcessWriteStdin](input)),
      upsertDefinition: (input) =>
        transport.request((client) => client[WS_METHODS.managedProcessUpsertDefinition](input)),
      deleteDefinition: (input) =>
        transport.request((client) => client[WS_METHODS.managedProcessDeleteDefinition](input)),
      proposedImports: (input) =>
        transport.request((client) => client[WS_METHODS.managedProcessProposedImports](input)),
      subscribeLog: (input, listener, options) =>
        transport.subscribe(
          (client) => client[WS_METHODS.managedProcessSubscribeLog](input),
          listener,
          options,
        ),
    },
    orchestration: {
      getBootstrapSnapshot: () =>
        transport.request((client) => client[ORCHESTRATION_WS_METHODS.getBootstrapSnapshot]({})),
      getArchivedShellSnapshot: () =>
        transport.request((client) =>
          client[ORCHESTRATION_WS_METHODS.getArchivedShellSnapshot]({}),
        ),
      subscribeShell: (listener, options) =>
        transport.subscribe(
          (client) => client[ORCHESTRATION_WS_METHODS.subscribeShell]({}),
          listener,
          options,
        ),
      subscribeManagedProcesses: (listener, options) =>
        transport.subscribe(
          (client) => client[ORCHESTRATION_WS_METHODS.subscribeManagedProcesses]({}),
          listener,
          options,
        ),
      getSnapshot: () =>
        transport.request((client) => client[ORCHESTRATION_WS_METHODS.getSnapshot]({})),
      getThreadSnapshot: (input) =>
        transport.request((client) => client[ORCHESTRATION_WS_METHODS.getThreadSnapshot](input)),
      dispatchCommand: (input) =>
        transport.request((client) => client[ORCHESTRATION_WS_METHODS.dispatchCommand](input)),
      getTurnDiff: (input) =>
        transport.request((client) => client[ORCHESTRATION_WS_METHODS.getTurnDiff](input)),
      getFullThreadDiff: (input) =>
        transport.request((client) => client[ORCHESTRATION_WS_METHODS.getFullThreadDiff](input)),
      replayEvents: (input) =>
        transport
          .request((client) => client[ORCHESTRATION_WS_METHODS.replayEvents](input))
          .then((events) => [...events]),
      onDomainEvent: (listener, options) =>
        transport.subscribe(
          (client) => client[WS_METHODS.subscribeOrchestrationDomainEvents]({}),
          listener,
          options,
        ),
    },
    sourceControl: {
      lookupRepository: (input) =>
        transport.request((client) => client[WS_METHODS.sourceControlLookupRepository](input)),
      cloneRepository: (input) =>
        transport.request((client) => client[WS_METHODS.sourceControlCloneRepository](input)),
      publishRepository: (input) =>
        transport.request((client) => client[WS_METHODS.sourceControlPublishRepository](input)),
      stack: stackClient,
    },
  };
}
