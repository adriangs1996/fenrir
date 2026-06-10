import * as Rpc from "effect/unstable/rpc/Rpc";

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
} from "../sourceControlStack";
import { WS_METHODS } from "./methods";

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
