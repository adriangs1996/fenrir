import type {
  ProjectId,
  TmuxActor,
  TmuxKernelEvent,
  TmuxKernelError,
  TmuxPane,
  TmuxPaneAttachMetadataInput,
  TmuxPaneCloseInput,
  TmuxPaneCreateInput,
  TmuxOperationalPaneStatusInput,
  TmuxOperationalPaneStatusResult,
  TmuxPaneResizeInput,
  TmuxPaneStreamEvent,
  TmuxPaneStreamSubscribeInput,
  TmuxPaneWriteInput,
  TmuxPaneWriteResult,
  TmuxNeovimPaneInput,
  TmuxWindow,
  TmuxWindowId,
  TmuxWindowCloseInput,
  TmuxWindowCreateInput,
  TmuxWorkspaceEnsureInput,
  TmuxWorkspaceGetSnapshotInput,
  TmuxKernelSubscribeInput,
  TmuxWorkspaceId,
  TmuxWorkspaceListInput,
  TmuxWorkspaceListResult,
  TmuxWorkspaceSnapshot,
} from "@fenrir/contracts";
import { Context, Effect } from "effect";
import type { Stream } from "effect";

export interface TmuxWindowRenameInput {
  readonly actor: TmuxActor;
  readonly workspaceId: TmuxWorkspaceId;
  readonly windowId: TmuxWindowId;
  readonly name: string;
}

export interface TmuxWindowFocusInput {
  readonly actor: TmuxActor;
  readonly workspaceId: TmuxWorkspaceId;
  readonly windowId: TmuxWindowId;
}

export interface TmuxPaneFocusInput {
  readonly actor: TmuxActor;
  readonly workspaceId: TmuxWorkspaceId;
  readonly paneId: TmuxPane["paneId"];
}

export interface TmuxWorkspaceServiceShape {
  readonly listWorkspaces: (
    input: TmuxWorkspaceListInput,
  ) => Effect.Effect<TmuxWorkspaceListResult, TmuxKernelError>;
  readonly ensureWorkspace: (
    input: TmuxWorkspaceEnsureInput,
  ) => Effect.Effect<TmuxWorkspaceSnapshot, TmuxKernelError>;
  readonly reconnectWorkspace: (
    input: TmuxWorkspaceGetSnapshotInput,
  ) => Effect.Effect<TmuxWorkspaceSnapshot, TmuxKernelError>;
  readonly getSnapshot: (
    input: TmuxWorkspaceGetSnapshotInput,
  ) => Effect.Effect<TmuxWorkspaceSnapshot, TmuxKernelError>;
  readonly createWindow: (
    input: TmuxWindowCreateInput,
  ) => Effect.Effect<TmuxWorkspaceSnapshot, TmuxKernelError>;
  readonly renameWindow: (
    input: TmuxWindowRenameInput,
  ) => Effect.Effect<TmuxWindow, TmuxKernelError>;
  readonly focusWindow: (
    input: TmuxWindowFocusInput,
  ) => Effect.Effect<TmuxWorkspaceSnapshot, TmuxKernelError>;
  readonly closeWindow: (
    input: TmuxWindowCloseInput,
  ) => Effect.Effect<TmuxWorkspaceSnapshot, TmuxKernelError>;
  readonly createPane: (
    input: TmuxPaneCreateInput,
  ) => Effect.Effect<TmuxWorkspaceSnapshot, TmuxKernelError>;
  readonly attachPaneMetadata: (
    input: TmuxPaneAttachMetadataInput,
  ) => Effect.Effect<TmuxPane, TmuxKernelError>;
  readonly listOperationalPaneStatuses: (
    input: TmuxOperationalPaneStatusInput,
  ) => Effect.Effect<TmuxOperationalPaneStatusResult, TmuxKernelError>;
  readonly createNeovimPane: (
    input: TmuxNeovimPaneInput,
  ) => Effect.Effect<TmuxWorkspaceSnapshot, TmuxKernelError>;
  readonly reconnectNeovimPane: (
    input: TmuxNeovimPaneInput,
  ) => Effect.Effect<TmuxWorkspaceSnapshot, TmuxKernelError>;
  readonly focusPane: (
    input: TmuxPaneFocusInput,
  ) => Effect.Effect<TmuxWorkspaceSnapshot, TmuxKernelError>;
  readonly resizePane: (input: TmuxPaneResizeInput) => Effect.Effect<TmuxPane, TmuxKernelError>;
  readonly closePane: (
    input: TmuxPaneCloseInput,
  ) => Effect.Effect<TmuxWorkspaceSnapshot, TmuxKernelError>;
  readonly writePane: (
    input: TmuxPaneWriteInput,
  ) => Effect.Effect<TmuxPaneWriteResult, TmuxKernelError>;
  readonly subscribePaneStream: (
    input: TmuxPaneStreamSubscribeInput,
  ) => Effect.Effect<Stream.Stream<TmuxPaneStreamEvent, never>, TmuxKernelError>;
  readonly subscribe: (
    input: TmuxKernelSubscribeInput,
    listener: (event: TmuxKernelEvent) => Effect.Effect<void>,
  ) => Effect.Effect<() => void, TmuxKernelError>;
  readonly sessionNameForProject: (projectId: ProjectId) => string;
}

export class TmuxWorkspaceService extends Context.Service<
  TmuxWorkspaceService,
  TmuxWorkspaceServiceShape
>()("t3/terminal/Services/TmuxWorkspaceService") {}
