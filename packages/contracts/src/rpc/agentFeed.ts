import * as Rpc from "effect/unstable/rpc/Rpc";

import {
  ApprovalDecideError,
  ApprovalDecideInput,
  ApprovalDecision,
  ApprovalFeedEvent,
  ApprovalFeedSubscribeInput,
} from "../agentFeed";
import { WS_METHODS } from "./methods";

/**
 * D-042 approval feed relay: clients subscribe to pending approvals per
 * workspace (or all workspaces when no filter is given) and dispatch exactly
 * one decision per request id. Late or duplicate decisions are rejected with
 * a typed `ApprovalDecideError`.
 */
export const WsSubscribeApprovalFeedRpc = Rpc.make(WS_METHODS.subscribeApprovalFeed, {
  payload: ApprovalFeedSubscribeInput,
  success: ApprovalFeedEvent,
  stream: true,
});

export const WsApprovalFeedDecideRpc = Rpc.make(WS_METHODS.agentFeedDecide, {
  payload: ApprovalDecideInput,
  success: ApprovalDecision,
  error: ApprovalDecideError,
});
