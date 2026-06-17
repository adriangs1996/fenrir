import { Effect, Queue, Stream } from "effect";

import { type LocalServersSnapshot, WS_METHODS } from "@fenrir/contracts";

import { LocalServerDiscovery } from "../../localServers/Services/LocalServerDiscovery";
import { makeRpcDomain } from "../handlers";

export const makeLocalServersRoutes = Effect.gen(function* () {
  const localServerDiscovery = yield* LocalServerDiscovery;
  const localServers = makeRpcDomain("localServers");

  return {
    [WS_METHODS.subscribeLocalServers]: localServers.stream(
      WS_METHODS.subscribeLocalServers,
      (_input) =>
        Stream.callback<LocalServersSnapshot>((queue) =>
          Effect.acquireRelease(
            localServerDiscovery.subscribe((snapshot) => {
              Queue.offerUnsafe(queue, snapshot);
            }),
            (unsubscribe) => Effect.sync(unsubscribe),
          ),
        ),
    ),
  };
});
