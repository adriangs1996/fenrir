import { Effect, Queue, Stream } from "effect";

import { type RawTcpEvent, WS_METHODS } from "@fenrir/contracts";

import { RawTcpListenerService } from "../../raw-tcp/Services/RawTcpListenerService";
import { makeRpcDomain } from "../handlers";

export const makeRawTcpRoutes = Effect.gen(function* () {
  const rawTcpListenerService = yield* RawTcpListenerService;

  const rawTcp = makeRpcDomain("rawTcp");

  return {
    [WS_METHODS.rawTcpCreateListener]: rawTcp.effect(WS_METHODS.rawTcpCreateListener, (input) =>
      rawTcpListenerService.createListener(input),
    ),
    [WS_METHODS.rawTcpStopListener]: rawTcp.effect(WS_METHODS.rawTcpStopListener, (input) =>
      rawTcpListenerService.stopListener(input.listenerId),
    ),
    [WS_METHODS.rawTcpListListeners]: rawTcp.effect(WS_METHODS.rawTcpListListeners, (_input) =>
      rawTcpListenerService.listListeners(),
    ),
    [WS_METHODS.rawTcpListSessions]: rawTcp.effect(WS_METHODS.rawTcpListSessions, (_input) =>
      rawTcpListenerService.listSessions(),
    ),
    [WS_METHODS.rawTcpSessionWrite]: rawTcp.effect(WS_METHODS.rawTcpSessionWrite, (input) =>
      rawTcpListenerService.sessionWrite(input.sessionId, input.data),
    ),
    [WS_METHODS.rawTcpSessionUpgradePty]: rawTcp.effect(
      WS_METHODS.rawTcpSessionUpgradePty,
      (input) => rawTcpListenerService.sessionUpgradePty(input),
    ),
    [WS_METHODS.rawTcpSessionClose]: rawTcp.effect(WS_METHODS.rawTcpSessionClose, (input) =>
      rawTcpListenerService.sessionClose(input.sessionId),
    ),
    [WS_METHODS.subscribeRawTcpEvents]: rawTcp.stream(WS_METHODS.subscribeRawTcpEvents, (_input) =>
      Stream.callback<RawTcpEvent>((queue) =>
        Effect.acquireRelease(
          rawTcpListenerService.subscribe((event) => {
            Queue.offerUnsafe(queue, event);
          }),
          (unsubscribe) => Effect.sync(unsubscribe),
        ),
      ),
    ),
  };
});
