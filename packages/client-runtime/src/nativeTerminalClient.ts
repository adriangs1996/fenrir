import type {
  AuthSessionId,
  ProjectId,
  TmuxActor,
  TmuxKernelEvent,
  TmuxKernelSubscribeInput,
  TmuxNeovimPaneInput,
  TmuxOperationalPaneStatusInput,
  TmuxOperationalPaneStatusResult,
  TmuxPane,
  TmuxPaneAttachMetadataInput,
  TmuxPaneCloseInput,
  TmuxPaneCreateInput,
  TmuxPaneResizeInput,
  TmuxPaneStreamDescriptor,
  TmuxPaneStreamEvent,
  TmuxPaneStreamSubscribeInput,
  TmuxPaneWriteInput,
  TmuxPaneWriteResult,
  TmuxWindowCloseInput,
  TmuxWindowCreateInput,
  TmuxWorkspaceEnsureInput,
  TmuxWorkspaceGetSnapshotInput,
  TmuxWorkspaceId,
  TmuxWorkspaceListInput,
  TmuxWorkspaceListResult,
  TmuxWorkspaceSnapshot,
} from "@fenrir/contracts";

import { createPaneStreamSubscribeInput } from "./tmuxPaneBootstrap";

export interface NativeTerminalBearerAuth {
  readonly kind: "bearer";
  readonly token: string;
  readonly sessionId: AuthSessionId;
  readonly subject: string;
}

export interface NativeTerminalConnectionConfig {
  readonly serverUrl: string;
  readonly auth: NativeTerminalBearerAuth;
  readonly clientName?: string;
}

export interface NativeTerminalCapabilities {
  readonly protocol: "tmux-kernel-v1";
  readonly auth: {
    readonly mode: "explicit-bearer-session";
    readonly requiresActorSessionId: true;
  };
  readonly workspace: {
    readonly attach: true;
    readonly detach: "local-subscription";
    readonly reconnect: true;
  };
  readonly paneStream: {
    readonly encoding: "utf8";
    readonly sequenceBackfill: true;
    readonly overflowEvents: true;
    readonly slowClientPolicies: readonly TmuxPaneStreamSubscribeInput["slowClientPolicy"][];
    readonly defaultBackfill: TmuxPaneStreamSubscribeInput["backfill"];
    readonly defaultMaxBufferedChunks: number;
  };
  readonly paneWrite: {
    readonly acknowledgements: true;
    readonly maxBytes: number;
  };
  readonly neovim: {
    readonly paneBootstrap: true;
    readonly reconnect: true;
  };
}

export const NATIVE_TERMINAL_CAPABILITIES: NativeTerminalCapabilities = {
  protocol: "tmux-kernel-v1",
  auth: {
    mode: "explicit-bearer-session",
    requiresActorSessionId: true,
  },
  workspace: {
    attach: true,
    detach: "local-subscription",
    reconnect: true,
  },
  paneStream: {
    encoding: "utf8",
    sequenceBackfill: true,
    overflowEvents: true,
    slowClientPolicies: ["fast-forward", "close"],
    defaultBackfill: "from-seq",
    defaultMaxBufferedChunks: 512,
  },
  paneWrite: {
    acknowledgements: true,
    maxBytes: 65_536,
  },
  neovim: {
    paneBootstrap: true,
    reconnect: true,
  },
};

export type NativeTerminalWorkspaceAttachmentStatus = "attached" | "detached";

export interface NativeTerminalWorkspaceAttachment {
  readonly actor: TmuxActor;
  readonly workspaceId: TmuxWorkspaceId;
  readonly snapshot: TmuxWorkspaceSnapshot;
  readonly status: NativeTerminalWorkspaceAttachmentStatus;
  readonly detachReason: string | null;
}

export type NativePaneStreamLifecycle =
  | "idle"
  | "backfilling"
  | "live"
  | "gapped"
  | "overflowed"
  | "closed";

export interface NativePaneStreamGap {
  readonly requestedAfterSeq: Extract<
    TmuxPaneStreamEvent,
    { readonly type: "gap" }
  >["requestedAfterSeq"];
  readonly resumedAtSeq: number;
  readonly reason: Extract<TmuxPaneStreamEvent, { readonly type: "gap" }>["reason"];
}

export interface NativePaneStreamOverflow {
  readonly droppedCount: number;
  readonly policy: TmuxPaneStreamSubscribeInput["slowClientPolicy"];
  readonly reason: Extract<TmuxPaneStreamEvent, { readonly type: "overflow" }>["reason"];
}

export interface NativePaneStreamBackfillState {
  readonly active: boolean;
  readonly fromSeq: number | null;
  readonly toSeq: number | null;
}

export interface NativePaneStreamState {
  readonly descriptor: TmuxPaneStreamDescriptor;
  readonly lifecycle: NativePaneStreamLifecycle;
  readonly lastSeq: number | null;
  readonly receivedChunkCount: number;
  readonly gapCount: number;
  readonly overflowCount: number;
  readonly droppedCount: number;
  readonly backfill: NativePaneStreamBackfillState;
  readonly gaps: readonly NativePaneStreamGap[];
  readonly overflows: readonly NativePaneStreamOverflow[];
  readonly closedReason: Extract<TmuxPaneStreamEvent, { readonly type: "closed" }>["reason"] | null;
}

export interface NativePaneWriteState {
  readonly acceptedRequestIds: readonly string[];
  readonly rejectedRequestIds: readonly string[];
  readonly lastAcceptedInputSeq: number | null;
  readonly lastRejectedCode:
    | Extract<TmuxPaneWriteResult, { readonly type: "rejected" }>["code"]
    | null;
}

export interface NativeTerminalRpcTransport {
  readonly listWorkspaces: (input: TmuxWorkspaceListInput) => Promise<TmuxWorkspaceListResult>;
  readonly ensureWorkspace: (input: TmuxWorkspaceEnsureInput) => Promise<TmuxWorkspaceSnapshot>;
  readonly getWorkspaceSnapshot: (
    input: TmuxWorkspaceGetSnapshotInput,
  ) => Promise<TmuxWorkspaceSnapshot>;
  readonly reconnectWorkspace: (
    input: TmuxWorkspaceGetSnapshotInput,
  ) => Promise<TmuxWorkspaceSnapshot>;
  readonly subscribeWorkspace: (
    input: TmuxKernelSubscribeInput,
    listener: (event: TmuxKernelEvent) => void,
  ) => () => void;
  readonly createWindow: (input: TmuxWindowCreateInput) => Promise<TmuxWorkspaceSnapshot>;
  readonly closeWindow: (input: TmuxWindowCloseInput) => Promise<TmuxWorkspaceSnapshot>;
  readonly createPane: (input: TmuxPaneCreateInput) => Promise<TmuxWorkspaceSnapshot>;
  readonly createNeovimPane: (input: TmuxNeovimPaneInput) => Promise<TmuxWorkspaceSnapshot>;
  readonly reconnectNeovimPane: (input: TmuxNeovimPaneInput) => Promise<TmuxWorkspaceSnapshot>;
  readonly attachPaneMetadata: (input: TmuxPaneAttachMetadataInput) => Promise<TmuxPane>;
  readonly listOperationalPaneStatuses: (
    input: TmuxOperationalPaneStatusInput,
  ) => Promise<TmuxOperationalPaneStatusResult>;
  readonly closePane: (input: TmuxPaneCloseInput) => Promise<TmuxWorkspaceSnapshot>;
  readonly resizePane: (input: TmuxPaneResizeInput) => Promise<TmuxPane>;
  readonly writePane: (input: TmuxPaneWriteInput) => Promise<TmuxPaneWriteResult>;
  readonly subscribePaneStream: (
    input: TmuxPaneStreamSubscribeInput,
    listener: (event: TmuxPaneStreamEvent) => void,
  ) => () => void;
}

export interface NativeTerminalClient {
  readonly config: NativeTerminalConnectionConfig;
  readonly actor: TmuxActor;
  readonly capabilities: NativeTerminalCapabilities;
  readonly listWorkspaces: (
    input?: Omit<TmuxWorkspaceListInput, "actor">,
  ) => Promise<TmuxWorkspaceListResult>;
  readonly attachWorkspace: (
    input:
      | { readonly mode: "ensure"; readonly projectId: ProjectId; readonly cwd: string }
      | { readonly mode: "snapshot"; readonly workspaceId: TmuxWorkspaceId },
  ) => Promise<NativeTerminalWorkspaceAttachment>;
  readonly detachWorkspace: (
    attachment: NativeTerminalWorkspaceAttachment,
    reason?: string,
  ) => NativeTerminalWorkspaceAttachment;
  readonly reconnectWorkspace: (
    workspaceId: TmuxWorkspaceId,
  ) => Promise<NativeTerminalWorkspaceAttachment>;
  readonly subscribeWorkspace: (
    input: Omit<TmuxKernelSubscribeInput, "actor">,
    listener: (event: TmuxKernelEvent) => void,
  ) => () => void;
  readonly subscribePaneStream: (
    input: {
      readonly pane: TmuxPane;
      readonly state?: NativePaneStreamState;
      readonly afterSeq?: number;
      readonly backfill?: TmuxPaneStreamSubscribeInput["backfill"];
      readonly slowClientPolicy?: TmuxPaneStreamSubscribeInput["slowClientPolicy"];
      readonly maxBufferedChunks?: number;
    },
    listener: (event: TmuxPaneStreamEvent, state: NativePaneStreamState) => void,
  ) => {
    readonly unsubscribe: () => void;
    readonly getState: () => NativePaneStreamState;
    readonly createReconnectInput: () => TmuxPaneStreamSubscribeInput;
  };
  readonly writePane: (input: Omit<TmuxPaneWriteInput, "actor">) => Promise<TmuxPaneWriteResult>;
  readonly createNeovimPane: (
    input: Omit<TmuxNeovimPaneInput, "actor">,
  ) => Promise<TmuxWorkspaceSnapshot>;
  readonly reconnectNeovimPane: (
    input: Omit<TmuxNeovimPaneInput, "actor">,
  ) => Promise<TmuxWorkspaceSnapshot>;
}

function requireNonEmpty(value: string, field: string): string {
  if (value.trim().length === 0) {
    throw new Error(`${field} is required`);
  }
  return value;
}

export function createNativeTerminalActor(auth: NativeTerminalBearerAuth): TmuxActor {
  requireNonEmpty(auth.token, "auth.token");
  return {
    sessionId: auth.sessionId,
    subject: requireNonEmpty(auth.subject, "auth.subject"),
  };
}

export function discoverNativeTerminalCapabilities(): NativeTerminalCapabilities {
  return NATIVE_TERMINAL_CAPABILITIES;
}

export function createNativePaneStreamState(input: {
  readonly descriptor: TmuxPaneStreamDescriptor;
  readonly lastSeq?: number;
}): NativePaneStreamState {
  return {
    descriptor: input.descriptor,
    lifecycle: "idle",
    lastSeq: input.lastSeq ?? null,
    receivedChunkCount: 0,
    gapCount: 0,
    overflowCount: 0,
    droppedCount: input.descriptor.droppedCount,
    backfill: {
      active: false,
      fromSeq: null,
      toSeq: null,
    },
    gaps: [],
    overflows: [],
    closedReason: null,
  };
}

export function applyNativePaneStreamEvent(
  state: NativePaneStreamState,
  event: TmuxPaneStreamEvent,
): NativePaneStreamState {
  switch (event.type) {
    case "backfill-started":
      return {
        ...state,
        descriptor: event.descriptor,
        lifecycle: "backfilling",
        backfill: {
          active: true,
          fromSeq: event.fromSeq,
          toSeq: event.toSeq,
        },
      };
    case "chunk": {
      const lastSeq = Math.max(state.lastSeq ?? -1, event.seq);
      const backfillComplete =
        state.backfill.active && state.backfill.toSeq !== null && lastSeq >= state.backfill.toSeq;
      return {
        ...state,
        descriptor: event.descriptor,
        lifecycle: backfillComplete
          ? "live"
          : state.lifecycle === "idle"
            ? "live"
            : state.lifecycle,
        lastSeq,
        receivedChunkCount: state.receivedChunkCount + 1,
        droppedCount: event.descriptor.droppedCount,
        backfill: backfillComplete ? { ...state.backfill, active: false } : state.backfill,
      };
    }
    case "gap": {
      const resumedCursor = event.resumedAtSeq === 0 ? 0 : event.resumedAtSeq - 1;
      return {
        ...state,
        descriptor: event.descriptor,
        lifecycle: "gapped",
        lastSeq: Math.max(state.lastSeq ?? -1, resumedCursor),
        gapCount: state.gapCount + 1,
        droppedCount: event.descriptor.droppedCount,
        gaps: [
          ...state.gaps,
          {
            requestedAfterSeq: event.requestedAfterSeq,
            resumedAtSeq: event.resumedAtSeq,
            reason: event.reason,
          },
        ],
      };
    }
    case "overflow":
      return {
        ...state,
        descriptor: event.descriptor,
        lifecycle: event.policy === "close" ? "closed" : "overflowed",
        overflowCount: state.overflowCount + 1,
        droppedCount: state.droppedCount + event.droppedCount,
        overflows: [
          ...state.overflows,
          {
            droppedCount: event.droppedCount,
            policy: event.policy,
            reason: event.reason,
          },
        ],
        closedReason: event.policy === "close" ? "slow-client" : state.closedReason,
      };
    case "closed":
      return {
        ...state,
        descriptor: event.descriptor,
        lifecycle: "closed",
        droppedCount: event.descriptor.droppedCount,
        backfill: {
          ...state.backfill,
          active: false,
        },
        closedReason: event.reason,
      };
  }
}

export function createNativePaneStreamReconnectInput(input: {
  readonly actor: TmuxActor;
  readonly pane: TmuxPane;
  readonly state: NativePaneStreamState;
  readonly slowClientPolicy?: TmuxPaneStreamSubscribeInput["slowClientPolicy"];
  readonly maxBufferedChunks?: number;
}): TmuxPaneStreamSubscribeInput {
  return createPaneStreamSubscribeInput({
    actor: input.actor,
    pane: input.pane,
    ...(input.state.lastSeq === null ? {} : { afterSeq: input.state.lastSeq }),
    backfill: input.state.lastSeq === null ? "latest" : "from-seq",
    ...(input.slowClientPolicy === undefined ? {} : { slowClientPolicy: input.slowClientPolicy }),
    ...(input.maxBufferedChunks === undefined
      ? {}
      : { maxBufferedChunks: input.maxBufferedChunks }),
  });
}

export function createNativePaneWriteState(): NativePaneWriteState {
  return {
    acceptedRequestIds: [],
    rejectedRequestIds: [],
    lastAcceptedInputSeq: null,
    lastRejectedCode: null,
  };
}

export function applyNativePaneWriteResult(
  state: NativePaneWriteState,
  result: TmuxPaneWriteResult,
): NativePaneWriteState {
  if (result.type === "accepted") {
    return {
      ...state,
      acceptedRequestIds: [...state.acceptedRequestIds, result.requestId],
      lastAcceptedInputSeq: result.inputSeq,
    };
  }
  return {
    ...state,
    rejectedRequestIds: [...state.rejectedRequestIds, result.requestId],
    lastRejectedCode: result.code,
  };
}

export function createNativeTerminalClient(
  config: NativeTerminalConnectionConfig,
  transport: NativeTerminalRpcTransport,
): NativeTerminalClient {
  const actor = createNativeTerminalActor(config.auth);
  const capabilities = discoverNativeTerminalCapabilities();

  return {
    config,
    actor,
    capabilities,
    listWorkspaces: (input) => transport.listWorkspaces({ actor, ...input }),
    attachWorkspace: async (input) => {
      const snapshot =
        input.mode === "ensure"
          ? await transport.ensureWorkspace({
              actor,
              projectId: input.projectId,
              cwd: input.cwd,
            })
          : await transport.getWorkspaceSnapshot({
              actor,
              workspaceId: input.workspaceId,
            });
      return {
        actor,
        workspaceId: snapshot.workspace.workspaceId,
        snapshot,
        status: "attached",
        detachReason: null,
      };
    },
    detachWorkspace: (attachment, reason = "client-detach") => ({
      ...attachment,
      status: "detached",
      detachReason: requireNonEmpty(reason, "reason"),
    }),
    reconnectWorkspace: async (workspaceId) => {
      const snapshot = await transport.reconnectWorkspace({ actor, workspaceId });
      return {
        actor,
        workspaceId,
        snapshot,
        status: "attached",
        detachReason: null,
      };
    },
    subscribeWorkspace: (input, listener) =>
      transport.subscribeWorkspace({ actor, ...input }, listener),
    subscribePaneStream: (input, listener) => {
      let state =
        input.state ??
        createNativePaneStreamState({
          descriptor: input.pane.stream,
          ...(input.afterSeq === undefined ? {} : { lastSeq: input.afterSeq }),
        });
      const afterSeq = input.afterSeq ?? state.lastSeq;
      const backfill = input.backfill ?? (afterSeq === null ? "latest" : "from-seq");
      const subscribeInput = createPaneStreamSubscribeInput({
        actor,
        pane: input.pane,
        ...(afterSeq === null ? {} : { afterSeq }),
        backfill,
        ...(input.slowClientPolicy === undefined
          ? {}
          : { slowClientPolicy: input.slowClientPolicy }),
        ...(input.maxBufferedChunks === undefined
          ? {}
          : { maxBufferedChunks: input.maxBufferedChunks }),
      });
      const unsubscribe = transport.subscribePaneStream(subscribeInput, (event) => {
        state = applyNativePaneStreamEvent(state, event);
        listener(event, state);
      });
      return {
        unsubscribe,
        getState: () => state,
        createReconnectInput: () => {
          const reconnectInput = {
            actor,
            pane: input.pane,
            state,
            ...(input.slowClientPolicy === undefined
              ? {}
              : { slowClientPolicy: input.slowClientPolicy }),
            ...(input.maxBufferedChunks === undefined
              ? {}
              : { maxBufferedChunks: input.maxBufferedChunks }),
          };
          return createNativePaneStreamReconnectInput(reconnectInput);
        },
      };
    },
    writePane: (input) => transport.writePane({ actor, ...input }),
    createNeovimPane: (input) => transport.createNeovimPane({ actor, ...input }),
    reconnectNeovimPane: (input) => transport.reconnectNeovimPane({ actor, ...input }),
  };
}
