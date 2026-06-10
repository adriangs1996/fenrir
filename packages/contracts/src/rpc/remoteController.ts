import { Schema } from "effect";
import * as Rpc from "effect/unstable/rpc/Rpc";

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
} from "../remoteController";
import { WS_METHODS } from "./methods";

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
