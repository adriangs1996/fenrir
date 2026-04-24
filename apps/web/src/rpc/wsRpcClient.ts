import {
  type GitActionProgressEvent,
  type GitRunStackedActionInput,
  type GitRunStackedActionResult,
  type GitStatusResult,
  type GitStatusStreamEvent,
  type LocalApi,
  type MetasploitEvent,
  ORCHESTRATION_WS_METHODS,
  type CreateGlobalActionInput,
  type UpdateGlobalActionInput,
  type ServerSettingsPatch,
  WS_METHODS,
} from "@fenrir/contracts";
import { applyGitStatusStreamEvent } from "@fenrir/shared/git";
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
  RpcMethod<TTag> extends (
    input: any,
    options?: any,
  ) => Effect.Effect<infer TSuccess, any, any>
    ? (input: RpcInput<TTag>) => Promise<TSuccess>
    : never;

type RpcUnaryNoArgMethod<TTag extends RpcTag> =
  RpcMethod<TTag> extends (
    input: any,
    options?: any,
  ) => Effect.Effect<infer TSuccess, any, any>
    ? () => Promise<TSuccess>
    : never;

type RpcStreamMethod<TTag extends RpcTag> =
  RpcMethod<TTag> extends (
    input: any,
    options?: any,
  ) => Stream.Stream<infer TEvent, any, any>
    ? (
        listener: (event: TEvent) => void,
        options?: StreamSubscriptionOptions,
      ) => () => void
    : never;

interface GitRunStackedActionOptions {
  readonly onProgress?: (event: GitActionProgressEvent) => void;
}

export interface WsRpcClient {
  readonly dispose: () => Promise<void>;
  readonly reconnect: () => Promise<void>;
  readonly terminal: {
    readonly open: RpcUnaryMethod<typeof WS_METHODS.terminalOpen>;
    readonly write: RpcUnaryMethod<typeof WS_METHODS.terminalWrite>;
    readonly resize: RpcUnaryMethod<typeof WS_METHODS.terminalResize>;
    readonly clear: RpcUnaryMethod<typeof WS_METHODS.terminalClear>;
    readonly restart: RpcUnaryMethod<typeof WS_METHODS.terminalRestart>;
    readonly close: RpcUnaryMethod<typeof WS_METHODS.terminalClose>;
    readonly onEvent: RpcStreamMethod<
      typeof WS_METHODS.subscribeTerminalEvents
    >;
    readonly attachTmux: RpcUnaryMethod<typeof WS_METHODS.terminalAttachTmux>;
    readonly detachTmux: RpcUnaryMethod<typeof WS_METHODS.terminalDetachTmux>;
    readonly writeTmux: RpcUnaryMethod<typeof WS_METHODS.terminalWriteTmux>;
    readonly resizeTmux: RpcUnaryMethod<typeof WS_METHODS.terminalResizeTmux>;
  };
  readonly metasploit: {
    readonly status: RpcUnaryNoArgMethod<typeof WS_METHODS.metasploitStatus>;
    readonly createListener: RpcUnaryMethod<
      typeof WS_METHODS.metasploitCreateListener
    >;
    readonly stopListener: RpcUnaryMethod<
      typeof WS_METHODS.metasploitStopListener
    >;
    readonly listListeners: RpcUnaryNoArgMethod<
      typeof WS_METHODS.metasploitListListeners
    >;
    readonly listSessions: RpcUnaryNoArgMethod<
      typeof WS_METHODS.metasploitListSessions
    >;
    readonly sessionWrite: RpcUnaryMethod<
      typeof WS_METHODS.metasploitSessionWrite
    >;
    readonly sessionResize: RpcUnaryMethod<
      typeof WS_METHODS.metasploitSessionResize
    >;
    readonly sessionUpgrade: RpcUnaryMethod<
      typeof WS_METHODS.metasploitSessionUpgrade
    >;
    readonly sessionClose: RpcUnaryMethod<
      typeof WS_METHODS.metasploitSessionClose
    >;
    readonly onEvent: RpcStreamMethod<
      typeof WS_METHODS.subscribeMetasploitEvents
    >;
  };
  readonly projects: {
    readonly searchEntries: RpcUnaryMethod<
      typeof WS_METHODS.projectsSearchEntries
    >;
    readonly writeFile: RpcUnaryMethod<typeof WS_METHODS.projectsWriteFile>;
  };
  readonly shell: {
    readonly openInEditor: (input: {
      readonly cwd: Parameters<LocalApi["shell"]["openInEditor"]>[0];
      readonly editor: Parameters<LocalApi["shell"]["openInEditor"]>[1];
    }) => ReturnType<LocalApi["shell"]["openInEditor"]>;
  };
  readonly git: {
    readonly pull: RpcUnaryMethod<typeof WS_METHODS.gitPull>;
    readonly refreshStatus: RpcUnaryMethod<typeof WS_METHODS.gitRefreshStatus>;
    readonly onStatus: (
      input: RpcInput<typeof WS_METHODS.subscribeGitStatus>,
      listener: (status: GitStatusResult) => void,
      options?: StreamSubscriptionOptions,
    ) => () => void;
    readonly runStackedAction: (
      input: GitRunStackedActionInput,
      options?: GitRunStackedActionOptions,
    ) => Promise<GitRunStackedActionResult>;
    readonly listBranches: RpcUnaryMethod<typeof WS_METHODS.gitListBranches>;
    readonly createWorktree: RpcUnaryMethod<
      typeof WS_METHODS.gitCreateWorktree
    >;
    readonly removeWorktree: RpcUnaryMethod<
      typeof WS_METHODS.gitRemoveWorktree
    >;
    readonly createBranch: RpcUnaryMethod<typeof WS_METHODS.gitCreateBranch>;
    readonly checkout: RpcUnaryMethod<typeof WS_METHODS.gitCheckout>;
    readonly init: RpcUnaryMethod<typeof WS_METHODS.gitInit>;
    readonly resolvePullRequest: RpcUnaryMethod<
      typeof WS_METHODS.gitResolvePullRequest
    >;
    readonly preparePullRequestThread: RpcUnaryMethod<
      typeof WS_METHODS.gitPreparePullRequestThread
    >;
  };
  readonly server: {
    readonly getConfig: RpcUnaryNoArgMethod<typeof WS_METHODS.serverGetConfig>;
    readonly refreshProviders: RpcUnaryNoArgMethod<
      typeof WS_METHODS.serverRefreshProviders
    >;
    readonly upsertKeybinding: RpcUnaryMethod<
      typeof WS_METHODS.serverUpsertKeybinding
    >;
    readonly getSettings: RpcUnaryNoArgMethod<
      typeof WS_METHODS.serverGetSettings
    >;
    readonly updateSettings: (
      patch: ServerSettingsPatch,
    ) => ReturnType<RpcUnaryMethod<typeof WS_METHODS.serverUpdateSettings>>;
    readonly getGlobalActions: RpcUnaryNoArgMethod<
      typeof WS_METHODS.serverGetGlobalActions
    >;
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
    readonly subscribeConfig: RpcStreamMethod<
      typeof WS_METHODS.subscribeServerConfig
    >;
    readonly subscribeLifecycle: RpcStreamMethod<
      typeof WS_METHODS.subscribeServerLifecycle
    >;
    readonly subscribeAuthAccess: RpcStreamMethod<
      typeof WS_METHODS.subscribeAuthAccess
    >;
  };
  readonly trafficLens: {
    readonly getTraffic: RpcUnaryMethod<typeof WS_METHODS.trafficLensGetTraffic>;
    readonly getTrafficDetail: RpcUnaryMethod<typeof WS_METHODS.trafficLensGetTrafficDetail>;
    readonly clearTraffic: RpcUnaryMethod<typeof WS_METHODS.trafficLensClearTraffic>;
    readonly onEvent: RpcStreamMethod<typeof WS_METHODS.subscribeTrafficLensEvents>;
  };
  readonly orchestration: {
    readonly getSnapshot: RpcUnaryNoArgMethod<
      typeof ORCHESTRATION_WS_METHODS.getSnapshot
    >;
    readonly dispatchCommand: RpcUnaryMethod<
      typeof ORCHESTRATION_WS_METHODS.dispatchCommand
    >;
    readonly getTurnDiff: RpcUnaryMethod<
      typeof ORCHESTRATION_WS_METHODS.getTurnDiff
    >;
    readonly getFullThreadDiff: RpcUnaryMethod<
      typeof ORCHESTRATION_WS_METHODS.getFullThreadDiff
    >;
    readonly replayEvents: RpcUnaryMethod<
      typeof ORCHESTRATION_WS_METHODS.replayEvents
    >;
    readonly onDomainEvent: RpcStreamMethod<
      typeof WS_METHODS.subscribeOrchestrationDomainEvents
    >;
  };
}

export function createWsRpcClient(transport: WsTransport): WsRpcClient {
  return {
    dispose: () => transport.dispose(),
    reconnect: async () => {
      resetWsReconnectBackoff();
      await transport.reconnect();
    },
    terminal: {
      open: (input) =>
        transport.request((client) => client[WS_METHODS.terminalOpen](input)),
      write: (input) =>
        transport.request((client) => client[WS_METHODS.terminalWrite](input)),
      resize: (input) =>
        transport.request((client) => client[WS_METHODS.terminalResize](input)),
      clear: (input) =>
        transport.request((client) => client[WS_METHODS.terminalClear](input)),
      restart: (input) =>
        transport.request((client) =>
          client[WS_METHODS.terminalRestart](input),
        ),
      close: (input) =>
        transport.request((client) => client[WS_METHODS.terminalClose](input)),
      onEvent: (listener, options) =>
        transport.subscribe(
          (client) => client[WS_METHODS.subscribeTerminalEvents]({}),
          listener,
          options,
        ),

      attachTmux: (input) =>
        transport.request((client) =>
          client[WS_METHODS.terminalAttachTmux](input),
        ),

      detachTmux: (input) =>
        transport.request((client) =>
          client[WS_METHODS.terminalDetachTmux](input),
        ),

      writeTmux: (input) =>
        transport.request((client) =>
          client[WS_METHODS.terminalWriteTmux](input),
        ),

      resizeTmux: (input) =>
        transport.request((client) =>
          client[WS_METHODS.terminalResizeTmux](input),
        ),
    },
    metasploit: {
      status: () =>
        transport.request((client) =>
          client[WS_METHODS.metasploitStatus]({}),
        ),
      createListener: (input) =>
        transport.request((client) =>
          client[WS_METHODS.metasploitCreateListener](input),
        ),
      stopListener: (input) =>
        transport.request((client) =>
          client[WS_METHODS.metasploitStopListener](input),
        ),
      listListeners: () =>
        transport.request((client) =>
          client[WS_METHODS.metasploitListListeners]({}),
        ),
      listSessions: () =>
        transport.request((client) =>
          client[WS_METHODS.metasploitListSessions]({}),
        ),
      sessionWrite: (input) =>
        transport.request((client) =>
          client[WS_METHODS.metasploitSessionWrite](input),
        ),
      sessionResize: (input) =>
        transport.request((client) =>
          client[WS_METHODS.metasploitSessionResize](input),
        ),
      sessionUpgrade: (input) =>
        transport.request((client) =>
          client[WS_METHODS.metasploitSessionUpgrade](input),
        ),
      sessionClose: (input) =>
        transport.request((client) =>
          client[WS_METHODS.metasploitSessionClose](input),
        ),
      onEvent: (listener, options) =>
        transport.subscribe(
          (client) => client[WS_METHODS.subscribeMetasploitEvents]({}),
          listener,
          options,
        ),
    },
    projects: {
      searchEntries: (input) =>
        transport.request((client) =>
          client[WS_METHODS.projectsSearchEntries](input),
        ),
      writeFile: (input) =>
        transport.request((client) =>
          client[WS_METHODS.projectsWriteFile](input),
        ),
    },
    shell: {
      openInEditor: (input) =>
        transport.request((client) =>
          client[WS_METHODS.shellOpenInEditor](input),
        ),
    },
    git: {
      pull: (input) =>
        transport.request((client) => client[WS_METHODS.gitPull](input)),
      refreshStatus: (input) =>
        transport.request((client) =>
          client[WS_METHODS.gitRefreshStatus](input),
        ),
      onStatus: (input, listener, options) => {
        let current: GitStatusResult | null = null;
        return transport.subscribe(
          (client) => client[WS_METHODS.subscribeGitStatus](input),
          (event: GitStatusStreamEvent) => {
            current = applyGitStatusStreamEvent(current, event);
            listener(current);
          },
          options,
        );
      },
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
      listBranches: (input) =>
        transport.request((client) =>
          client[WS_METHODS.gitListBranches](input),
        ),
      createWorktree: (input) =>
        transport.request((client) =>
          client[WS_METHODS.gitCreateWorktree](input),
        ),
      removeWorktree: (input) =>
        transport.request((client) =>
          client[WS_METHODS.gitRemoveWorktree](input),
        ),
      createBranch: (input) =>
        transport.request((client) =>
          client[WS_METHODS.gitCreateBranch](input),
        ),
      checkout: (input) =>
        transport.request((client) => client[WS_METHODS.gitCheckout](input)),
      init: (input) =>
        transport.request((client) => client[WS_METHODS.gitInit](input)),
      resolvePullRequest: (input) =>
        transport.request((client) =>
          client[WS_METHODS.gitResolvePullRequest](input),
        ),
      preparePullRequestThread: (input) =>
        transport.request((client) =>
          client[WS_METHODS.gitPreparePullRequestThread](input),
        ),
    },
    server: {
      getConfig: () =>
        transport.request((client) => client[WS_METHODS.serverGetConfig]({})),
      refreshProviders: () =>
        transport.request((client) =>
          client[WS_METHODS.serverRefreshProviders]({}),
        ),
      upsertKeybinding: (input) =>
        transport.request((client) =>
          client[WS_METHODS.serverUpsertKeybinding](input),
        ),
      getSettings: () =>
        transport.request((client) => client[WS_METHODS.serverGetSettings]({})),
      updateSettings: (patch) =>
        transport.request((client) =>
          client[WS_METHODS.serverUpdateSettings]({ patch }),
        ),
      getGlobalActions: () =>
        transport.request((client) =>
          client[WS_METHODS.serverGetGlobalActions]({}),
        ),
      createGlobalAction: (input) =>
        transport.request((client) =>
          client[WS_METHODS.serverCreateGlobalAction](input),
        ),
      updateGlobalAction: (id, input) =>
        transport.request((client) =>
          client[WS_METHODS.serverUpdateGlobalAction]({ id, ...input }),
        ),
      deleteGlobalAction: (id) =>
        transport.request((client) =>
          client[WS_METHODS.serverDeleteGlobalAction]({ id }),
        ),
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
        transport.request((client) =>
          client[WS_METHODS.trafficLensGetTraffic](input),
        ),
      getTrafficDetail: (input) =>
        transport.request((client) =>
          client[WS_METHODS.trafficLensGetTrafficDetail](input),
        ),
      clearTraffic: (input) =>
        transport.request((client) =>
          client[WS_METHODS.trafficLensClearTraffic](input),
        ),
      onEvent: (listener, options) =>
        transport.subscribe(
          (client) => client[WS_METHODS.subscribeTrafficLensEvents]({}),
          listener,
          options,
        ),
    },
    orchestration: {
      getSnapshot: () =>
        transport.request((client) =>
          client[ORCHESTRATION_WS_METHODS.getSnapshot]({}),
        ),
      dispatchCommand: (input) =>
        transport.request((client) =>
          client[ORCHESTRATION_WS_METHODS.dispatchCommand](input),
        ),
      getTurnDiff: (input) =>
        transport.request((client) =>
          client[ORCHESTRATION_WS_METHODS.getTurnDiff](input),
        ),
      getFullThreadDiff: (input) =>
        transport.request((client) =>
          client[ORCHESTRATION_WS_METHODS.getFullThreadDiff](input),
        ),
      replayEvents: (input) =>
        transport
          .request((client) =>
            client[ORCHESTRATION_WS_METHODS.replayEvents](input),
          )
          .then((events) => [...events]),
      onDomainEvent: (listener, options) =>
        transport.subscribe(
          (client) => client[WS_METHODS.subscribeOrchestrationDomainEvents]({}),
          listener,
          options,
        ),
    },
  };
}
