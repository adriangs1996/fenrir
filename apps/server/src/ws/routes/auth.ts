import { Effect, Ref, Stream } from "effect";

import { type AuthAccessStreamEvent, type AuthSessionId, WS_METHODS } from "@fenrir/contracts";

import {
  BootstrapCredentialService,
  type BootstrapCredentialChange,
} from "../../auth/Services/BootstrapCredentialService";
import { ServerAuth } from "../../auth/Services/ServerAuth";
import {
  SessionCredentialService,
  type SessionCredentialChange,
} from "../../auth/Services/SessionCredentialService";
import { makeRpcDomain } from "../handlers";

function toAuthAccessStreamEvent(
  change: BootstrapCredentialChange | SessionCredentialChange,
  revision: number,
  currentSessionId: AuthSessionId,
): AuthAccessStreamEvent {
  switch (change.type) {
    case "pairingLinkUpserted":
      return {
        version: 1,
        revision,
        type: "pairingLinkUpserted",
        payload: change.pairingLink,
      };
    case "pairingLinkRemoved":
      return {
        version: 1,
        revision,
        type: "pairingLinkRemoved",
        payload: { id: change.id },
      };
    case "clientUpserted":
      return {
        version: 1,
        revision,
        type: "clientUpserted",
        payload: {
          ...change.clientSession,
          current: change.clientSession.sessionId === currentSessionId,
        },
      };
    case "clientRemoved":
      return {
        version: 1,
        revision,
        type: "clientRemoved",
        payload: { sessionId: change.sessionId },
      };
  }
}

export const makeAuthRoutes = (deps: { readonly currentSessionId: AuthSessionId }) =>
  Effect.gen(function* () {
    const { currentSessionId } = deps;
    const serverAuth = yield* ServerAuth;
    const bootstrapCredentials = yield* BootstrapCredentialService;
    const sessions = yield* SessionCredentialService;

    const loadAuthAccessSnapshot = () =>
      Effect.all({
        pairingLinks: serverAuth.listPairingLinks().pipe(Effect.orDie),
        clientSessions: serverAuth.listClientSessions(currentSessionId).pipe(Effect.orDie),
      });

    const auth = makeRpcDomain("auth");

    return {
      [WS_METHODS.subscribeAuthAccess]: auth.streamEffect(
        WS_METHODS.subscribeAuthAccess,
        (_input) =>
          Effect.gen(function* () {
            const initialSnapshot = yield* loadAuthAccessSnapshot();
            const revisionRef = yield* Ref.make(1);
            const accessChanges: Stream.Stream<
              BootstrapCredentialChange | SessionCredentialChange
            > = Stream.merge(bootstrapCredentials.streamChanges, sessions.streamChanges);

            const liveEvents: Stream.Stream<AuthAccessStreamEvent> = accessChanges.pipe(
              Stream.mapEffect((change) =>
                Ref.updateAndGet(revisionRef, (revision) => revision + 1).pipe(
                  Effect.map((revision) =>
                    toAuthAccessStreamEvent(change, revision, currentSessionId),
                  ),
                ),
              ),
            );

            return Stream.concat(
              Stream.make({
                version: 1 as const,
                revision: 1,
                type: "snapshot" as const,
                payload: initialSnapshot,
              }),
              liveEvents,
            );
          }),
      ),
    };
  });
