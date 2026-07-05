import * as Rpc from "effect/unstable/rpc/Rpc";

import {
  TmuxEffectiveKeymap,
  TmuxKernelError,
  TmuxKernelEvent,
  TmuxKeymapGetInput,
  TmuxKernelSubscribeInput,
  TmuxNeovimPaneInput,
  TmuxOperationalPaneStatusInput,
  TmuxOperationalPaneStatusResult,
  TmuxPane,
  TmuxPaneAttachMetadataInput,
  TmuxPaneCloseInput,
  TmuxPaneCreateInput,
  TmuxPaneFocusInput,
  TmuxPaneResizeInput,
  TmuxPaneStreamEvent,
  TmuxPaneStreamSubscribeInput,
  TmuxPaneWriteInput,
  TmuxPaneWriteResult,
  TmuxPaneZoomInput,
  TmuxWindow,
  TmuxWindowCloseInput,
  TmuxWindowCreateInput,
  TmuxWindowFocusInput,
  TmuxWindowRenameInput,
  TmuxWindowResizeInput,
  TmuxWorkspaceEnsureInput,
  TmuxWorkspaceGetSnapshotInput,
  TmuxWorkspaceListResult,
  TmuxWorkspaceListInput,
  TmuxWorkspaceSnapshot,
} from "../terminalKernel";
import { WS_METHODS } from "./methods";

export const WsTmuxWorkspaceListRpc = Rpc.make(WS_METHODS.tmuxWorkspaceList, {
  payload: TmuxWorkspaceListInput,
  success: TmuxWorkspaceListResult,
  error: TmuxKernelError,
});

export const WsTmuxWorkspaceEnsureRpc = Rpc.make(WS_METHODS.tmuxWorkspaceEnsure, {
  payload: TmuxWorkspaceEnsureInput,
  success: TmuxWorkspaceSnapshot,
  error: TmuxKernelError,
});

export const WsTmuxWorkspaceGetSnapshotRpc = Rpc.make(WS_METHODS.tmuxWorkspaceGetSnapshot, {
  payload: TmuxWorkspaceGetSnapshotInput,
  success: TmuxWorkspaceSnapshot,
  error: TmuxKernelError,
});

export const WsTmuxWorkspaceReconnectRpc = Rpc.make(WS_METHODS.tmuxWorkspaceReconnect, {
  payload: TmuxWorkspaceGetSnapshotInput,
  success: TmuxWorkspaceSnapshot,
  error: TmuxKernelError,
});

export const WsTmuxWorkspaceSubscribeRpc = Rpc.make(WS_METHODS.tmuxWorkspaceSubscribe, {
  payload: TmuxKernelSubscribeInput,
  success: TmuxKernelEvent,
  error: TmuxKernelError,
  stream: true,
});

export const WsTmuxWindowCreateRpc = Rpc.make(WS_METHODS.tmuxWindowCreate, {
  payload: TmuxWindowCreateInput,
  success: TmuxWorkspaceSnapshot,
  error: TmuxKernelError,
});

export const WsTmuxWindowRenameRpc = Rpc.make(WS_METHODS.tmuxWindowRename, {
  payload: TmuxWindowRenameInput,
  success: TmuxWindow,
  error: TmuxKernelError,
});

export const WsTmuxWindowFocusRpc = Rpc.make(WS_METHODS.tmuxWindowFocus, {
  payload: TmuxWindowFocusInput,
  success: TmuxWorkspaceSnapshot,
  error: TmuxKernelError,
});

export const WsTmuxWindowResizeRpc = Rpc.make(WS_METHODS.tmuxWindowResize, {
  payload: TmuxWindowResizeInput,
  success: TmuxWindow,
  error: TmuxKernelError,
});

export const WsTmuxWindowCloseRpc = Rpc.make(WS_METHODS.tmuxWindowClose, {
  payload: TmuxWindowCloseInput,
  success: TmuxWorkspaceSnapshot,
  error: TmuxKernelError,
});

export const WsTmuxPaneCreateRpc = Rpc.make(WS_METHODS.tmuxPaneCreate, {
  payload: TmuxPaneCreateInput,
  success: TmuxWorkspaceSnapshot,
  error: TmuxKernelError,
});

export const WsTmuxNeovimPaneCreateRpc = Rpc.make(WS_METHODS.tmuxNeovimPaneCreate, {
  payload: TmuxNeovimPaneInput,
  success: TmuxWorkspaceSnapshot,
  error: TmuxKernelError,
});

export const WsTmuxNeovimPaneReconnectRpc = Rpc.make(WS_METHODS.tmuxNeovimPaneReconnect, {
  payload: TmuxNeovimPaneInput,
  success: TmuxWorkspaceSnapshot,
  error: TmuxKernelError,
});

export const WsTmuxPaneAttachMetadataRpc = Rpc.make(WS_METHODS.tmuxPaneAttachMetadata, {
  payload: TmuxPaneAttachMetadataInput,
  success: TmuxPane,
  error: TmuxKernelError,
});

export const WsTmuxOperationalPaneStatusesRpc = Rpc.make(WS_METHODS.tmuxOperationalPaneStatuses, {
  payload: TmuxOperationalPaneStatusInput,
  success: TmuxOperationalPaneStatusResult,
  error: TmuxKernelError,
});

export const WsTmuxPaneCloseRpc = Rpc.make(WS_METHODS.tmuxPaneClose, {
  payload: TmuxPaneCloseInput,
  success: TmuxWorkspaceSnapshot,
  error: TmuxKernelError,
});

export const WsTmuxPaneFocusRpc = Rpc.make(WS_METHODS.tmuxPaneFocus, {
  payload: TmuxPaneFocusInput,
  success: TmuxWorkspaceSnapshot,
  error: TmuxKernelError,
});

export const WsTmuxPaneResizeRpc = Rpc.make(WS_METHODS.tmuxPaneResize, {
  payload: TmuxPaneResizeInput,
  success: TmuxPane,
  error: TmuxKernelError,
});

export const WsTmuxPaneZoomRpc = Rpc.make(WS_METHODS.tmuxPaneZoom, {
  payload: TmuxPaneZoomInput,
  success: TmuxWorkspaceSnapshot,
  error: TmuxKernelError,
});

export const WsTmuxPaneWriteRpc = Rpc.make(WS_METHODS.tmuxPaneWrite, {
  payload: TmuxPaneWriteInput,
  success: TmuxPaneWriteResult,
  error: TmuxKernelError,
});

export const WsTmuxPaneSubscribeStreamRpc = Rpc.make(WS_METHODS.tmuxPaneSubscribeStream, {
  payload: TmuxPaneStreamSubscribeInput,
  success: TmuxPaneStreamEvent,
  error: TmuxKernelError,
  stream: true,
});

export const WsTmuxKeymapGetRpc = Rpc.make(WS_METHODS.tmuxKeymapGet, {
  payload: TmuxKeymapGetInput,
  success: TmuxEffectiveKeymap,
  error: TmuxKernelError,
});
