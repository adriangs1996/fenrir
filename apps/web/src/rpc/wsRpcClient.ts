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
  type CreateSkillInput,
  type UpdateSkillInput,
  type ResolveSkillConflictInput,
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

interface ReviewRpcClient {
  readonly getOrCreateSession: (input: unknown) => Promise<unknown>;
  readonly getSessionSummary: (input: unknown) => Promise<unknown>;
  readonly getSessionSnapshot: (input: unknown) => Promise<unknown>;
  readonly setMode: (input: unknown) => Promise<unknown>;
  readonly setScope: (input: unknown) => Promise<unknown>;
  readonly setProgress: (input: unknown) => Promise<unknown>;
  readonly createLocalThread: (input: unknown) => Promise<unknown>;
  readonly updateLocalThread: (input: unknown) => Promise<unknown>;
  readonly deleteLocalThread: (input: unknown) => Promise<unknown>;
  readonly setLocalThreadResolved: (input: unknown) => Promise<unknown>;
  readonly createLocalReply: (input: unknown) => Promise<unknown>;
  readonly updateLocalReply: (input: unknown) => Promise<unknown>;
  readonly deleteLocalReply: (input: unknown) => Promise<unknown>;
  readonly upsertOverviewNote: (input: unknown) => Promise<unknown>;
  readonly deleteOverviewNote: (input: unknown) => Promise<unknown>;
  readonly getDiffSnapshot: (input: unknown) => Promise<unknown>;
  readonly getFilePatch: (input: unknown) => Promise<unknown>;
  readonly getChunkPayload: (input: unknown) => Promise<unknown>;
  readonly getGitHubSnapshot: (input: unknown) => Promise<unknown>;
  readonly upsertGitHubDraft: (input: unknown) => Promise<unknown>;
  readonly applyRawMutation: (input: unknown) => Promise<unknown>;
  readonly deleteGitHubDraft: (input: unknown) => Promise<unknown>;
  readonly replyToGitHubThread: (input: unknown) => Promise<unknown>;
  readonly submitGitHubDraft: (input: unknown) => Promise<unknown>;
  readonly refreshProviderData: (input: unknown) => Promise<unknown>;
  readonly generateAnalysis: (input: unknown) => Promise<unknown>;
  readonly onEvent: (
    input: unknown,
    listener: (event: unknown) => void,
    options?: StreamSubscriptionOptions,
  ) => () => void;
}

function applyVcsStatusStreamEvent(
  current: VcsStatusResult | null,
  event: VcsStatusStreamEvent,
): VcsStatusResult {
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
      return {
        ...event.local,
        ...(current
          ? {
              hasUpstream: current.hasUpstream,
              aheadCount: current.aheadCount,
              behindCount: current.behindCount,
              ...(current.aheadOfDefaultCount !== undefined
                ? { aheadOfDefaultCount: current.aheadOfDefaultCount }
                : {}),
              pr: current.pr,
            }
          : {
              hasUpstream: false,
              aheadCount: 0,
              behindCount: 0,
              pr: null,
            }),
      };
    case "remoteUpdated":
      if (!current) {
        return {
          isRepo: false,
          hasPrimaryRemote: false,
          isDefaultRef: false,
          refName: null,
          hasWorkingTreeChanges: false,
          workingTree: {
            files: [],
            insertions: 0,
            deletions: 0,
          },
          ...(event.remote ?? {
            hasUpstream: false,
            aheadCount: 0,
            behindCount: 0,
            pr: null,
          }),
        };
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

const REVIEW_WS_METHODS = {
  getOrCreateSession: "sourceControl.review.getOrCreateSession",
  getSessionSummary: "sourceControl.review.getSessionSummary",
  getSessionSnapshot: "sourceControl.review.getSessionSnapshot",
  setMode: "sourceControl.review.setMode",
  setScope: "sourceControl.review.setScope",
  setProgress: "sourceControl.review.setProgress",
  createLocalThread: "sourceControl.review.createLocalThread",
  updateLocalThread: "sourceControl.review.updateLocalThread",
  deleteLocalThread: "sourceControl.review.deleteLocalThread",
  setLocalThreadResolved: "sourceControl.review.setLocalThreadResolved",
  createLocalReply: "sourceControl.review.createLocalReply",
  updateLocalReply: "sourceControl.review.updateLocalReply",
  deleteLocalReply: "sourceControl.review.deleteLocalReply",
  upsertOverviewNote: "sourceControl.review.upsertOverviewNote",
  deleteOverviewNote: "sourceControl.review.deleteOverviewNote",
  getDiffSnapshot: "sourceControl.review.getDiffSnapshot",
  getFilePatch: "sourceControl.review.getFilePatch",
  getChunkPayload: "sourceControl.review.getChunkPayload",
  getGitHubSnapshot: "sourceControl.review.getGitHubSnapshot",
  upsertGitHubDraft: "sourceControl.review.upsertGitHubDraft",
  applyRawMutation: "sourceControl.review.applyRawMutation",
  deleteGitHubDraft: "sourceControl.review.deleteGitHubDraft",
  replyToGitHubThread: "sourceControl.review.replyToGitHubThread",
  submitGitHubDraft: "sourceControl.review.submitGitHubDraft",
  refreshProviderData: "sourceControl.review.refreshProviderData",
  generateAnalysis: "sourceControl.review.generateAnalysis",
  subscribeEvents: "subscribeSourceControlReviewEvents",
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
    readonly writeFile: RpcUnaryMethod<typeof WS_METHODS.projectsWriteFile>;
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
    readonly listSkills: RpcUnaryNoArgMethod<typeof WS_METHODS.serverListSkills>;
    readonly getSkillDetails: RpcUnaryMethod<typeof WS_METHODS.serverGetSkillDetails>;
    readonly createSkill: (
      input: CreateSkillInput,
    ) => ReturnType<RpcUnaryMethod<typeof WS_METHODS.serverCreateSkill>>;
    readonly updateSkill: (
      input: UpdateSkillInput,
    ) => ReturnType<RpcUnaryMethod<typeof WS_METHODS.serverUpdateSkill>>;
    readonly deleteSkill: (
      name: string,
    ) => ReturnType<RpcUnaryMethod<typeof WS_METHODS.serverDeleteSkill>>;
    readonly resolveSkillConflict: (
      input: ResolveSkillConflictInput,
    ) => ReturnType<RpcUnaryMethod<typeof WS_METHODS.serverResolveSkillConflict>>;
    readonly setActiveSkillProject: RpcUnaryMethod<typeof WS_METHODS.serverSetActiveSkillProject>;
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
    readonly review: ReviewRpcClient;
  };
}

export function createWsRpcClient(transport: WsTransport): WsRpcClient {
  const reviewRequest = (method: string, input: unknown) =>
    transport.request(
      (client) =>
        (
          client as unknown as Record<
            string,
            ((value: unknown) => Effect.Effect<unknown, Error, never>) | undefined
          >
        )[method]?.(input) as Effect.Effect<unknown, Error, never>,
    );
  const reviewSubscribe = (
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

  const reviewClient: ReviewRpcClient = {
    getOrCreateSession: (input) => reviewRequest(REVIEW_WS_METHODS.getOrCreateSession, input),
    getSessionSummary: (input) => reviewRequest(REVIEW_WS_METHODS.getSessionSummary, input),
    getSessionSnapshot: (input) => reviewRequest(REVIEW_WS_METHODS.getSessionSnapshot, input),
    setMode: (input) => reviewRequest(REVIEW_WS_METHODS.setMode, input),
    setScope: (input) => reviewRequest(REVIEW_WS_METHODS.setScope, input),
    setProgress: (input) => reviewRequest(REVIEW_WS_METHODS.setProgress, input),
    createLocalThread: (input) => reviewRequest(REVIEW_WS_METHODS.createLocalThread, input),
    updateLocalThread: (input) => reviewRequest(REVIEW_WS_METHODS.updateLocalThread, input),
    deleteLocalThread: (input) => reviewRequest(REVIEW_WS_METHODS.deleteLocalThread, input),
    setLocalThreadResolved: (input) =>
      reviewRequest(REVIEW_WS_METHODS.setLocalThreadResolved, input),
    createLocalReply: (input) => reviewRequest(REVIEW_WS_METHODS.createLocalReply, input),
    updateLocalReply: (input) => reviewRequest(REVIEW_WS_METHODS.updateLocalReply, input),
    deleteLocalReply: (input) => reviewRequest(REVIEW_WS_METHODS.deleteLocalReply, input),
    upsertOverviewNote: (input) => reviewRequest(REVIEW_WS_METHODS.upsertOverviewNote, input),
    deleteOverviewNote: (input) => reviewRequest(REVIEW_WS_METHODS.deleteOverviewNote, input),
    getDiffSnapshot: (input) => reviewRequest(REVIEW_WS_METHODS.getDiffSnapshot, input),
    getFilePatch: (input) => reviewRequest(REVIEW_WS_METHODS.getFilePatch, input),
    getChunkPayload: (input) => reviewRequest(REVIEW_WS_METHODS.getChunkPayload, input),
    getGitHubSnapshot: (input) => reviewRequest(REVIEW_WS_METHODS.getGitHubSnapshot, input),
    upsertGitHubDraft: (input) => reviewRequest(REVIEW_WS_METHODS.upsertGitHubDraft, input),
    applyRawMutation: (input) => reviewRequest(REVIEW_WS_METHODS.applyRawMutation, input),
    deleteGitHubDraft: (input) => reviewRequest(REVIEW_WS_METHODS.deleteGitHubDraft, input),
    replyToGitHubThread: (input) => reviewRequest(REVIEW_WS_METHODS.replyToGitHubThread, input),
    submitGitHubDraft: (input) => reviewRequest(REVIEW_WS_METHODS.submitGitHubDraft, input),
    refreshProviderData: (input) => reviewRequest(REVIEW_WS_METHODS.refreshProviderData, input),
    generateAnalysis: (input) => reviewRequest(REVIEW_WS_METHODS.generateAnalysis, input),
    onEvent: (input, listener, options) =>
      reviewSubscribe(REVIEW_WS_METHODS.subscribeEvents, input, listener, options),
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
      writeFile: (input) =>
        transport.request((client) => client[WS_METHODS.projectsWriteFile](input)),
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
            listener(current);
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
      listSkills: () => transport.request((client) => client[WS_METHODS.serverListSkills]({})),
      getSkillDetails: (input) =>
        transport.request((client) => client[WS_METHODS.serverGetSkillDetails](input)),
      createSkill: (input) =>
        transport.request((client) => client[WS_METHODS.serverCreateSkill](input)),
      updateSkill: (input) =>
        transport.request((client) => client[WS_METHODS.serverUpdateSkill](input)),
      deleteSkill: (name) =>
        transport.request((client) => client[WS_METHODS.serverDeleteSkill]({ name })),
      resolveSkillConflict: (input) =>
        transport.request((client) => client[WS_METHODS.serverResolveSkillConflict](input)),
      setActiveSkillProject: (input) =>
        transport.request((client) => client[WS_METHODS.serverSetActiveSkillProject](input)),
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
      review: reviewClient,
    },
  };
}
