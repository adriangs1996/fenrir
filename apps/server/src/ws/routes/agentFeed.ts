import { Effect, Queue, Stream } from "effect";

import { type ApprovalFeedEvent, WS_METHODS } from "@fenrir/contracts";

import { AgentFeedService } from "../../agentFeed/Services/AgentFeedService";
import { makeRpcDomain } from "../handlers";

/**
 * D-042 approval feed relay routes: a per-workspace (or global) subscription
 * stream of pending/settled events and the decide RPC that accepts exactly
 * one decision per request id.
 */
export const makeAgentFeedRoutes = Effect.gen(function* () {
  const agentFeed = yield* AgentFeedService;
  const domain = makeRpcDomain("agentFeed");

  return {
    [WS_METHODS.subscribeApprovalFeed]: domain.stream(WS_METHODS.subscribeApprovalFeed, (input) =>
      Stream.callback<ApprovalFeedEvent>((queue) =>
        Effect.acquireRelease(
          agentFeed.subscribe((event) => {
            if (input.workspaceId === undefined || event.workspaceId === input.workspaceId) {
              Queue.offerUnsafe(queue, event);
            }
          }),
          (unsubscribe) => Effect.sync(unsubscribe),
        ),
      ),
    ),

    [WS_METHODS.agentFeedDecide]: domain.effect(WS_METHODS.agentFeedDecide, (input) =>
      agentFeed.decide(input),
    ),
  };
});
