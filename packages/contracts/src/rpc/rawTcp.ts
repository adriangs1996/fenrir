import { Schema } from "effect";
import * as Rpc from "effect/unstable/rpc/Rpc";

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
} from "../rawTcpListener";
import { WS_METHODS } from "./methods";

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
