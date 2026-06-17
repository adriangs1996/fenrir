import { Schema } from "effect";
import * as Rpc from "effect/unstable/rpc/Rpc";

import { LocalServersSnapshot } from "../localServers";
import { WS_METHODS } from "./methods";

export const WsSubscribeLocalServersRpc = Rpc.make(WS_METHODS.subscribeLocalServers, {
  payload: Schema.Struct({}),
  success: LocalServersSnapshot,
  stream: true,
});
