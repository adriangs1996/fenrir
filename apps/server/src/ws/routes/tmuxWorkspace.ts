import { Effect, Queue, Stream } from "effect";

import {
  TmuxKernelError,
  type AuthSessionId,
  type TmuxActor,
  type TmuxKernelEvent,
  type TmuxPermissionGrant,
  WS_METHODS,
} from "@fenrir/contracts";

import { TmuxWorkspaceService } from "../../terminal/Services/TmuxWorkspaceService";
import { makeRpcDomain } from "../handlers";

function permissionDenied(message: string): TmuxKernelError {
  return new TmuxKernelError({
    code: "permission-denied",
    message,
  });
}

function validateActorSession(
  actor: TmuxActor,
  currentSessionId: AuthSessionId,
): Effect.Effect<void, TmuxKernelError> {
  if (actor.sessionId === currentSessionId) return Effect.void;
  return Effect.fail(permissionDenied("tmux pane actor does not match the authenticated session"));
}

function validateGrantSessions(
  grants: readonly TmuxPermissionGrant[] | undefined,
  currentSessionId: AuthSessionId,
): Effect.Effect<void, TmuxKernelError> {
  return Effect.forEach(
    grants ?? [],
    (grant) => validateActorSession(grant.actor, currentSessionId),
    { discard: true },
  );
}

export const makeTmuxWorkspaceRoutes = (deps: { readonly currentSessionId: AuthSessionId }) =>
  Effect.gen(function* () {
    const { currentSessionId } = deps;
    const tmuxWorkspace = yield* TmuxWorkspaceService;

    const tmux = makeRpcDomain("tmuxWorkspace");

    return {
      [WS_METHODS.tmuxWorkspaceList]: tmux.effect(WS_METHODS.tmuxWorkspaceList, (input) =>
        validateActorSession(input.actor, currentSessionId).pipe(
          Effect.andThen(tmuxWorkspace.listWorkspaces(input)),
        ),
      ),

      [WS_METHODS.tmuxWorkspaceEnsure]: tmux.effect(WS_METHODS.tmuxWorkspaceEnsure, (input) =>
        validateActorSession(input.actor, currentSessionId).pipe(
          Effect.andThen(validateGrantSessions(input.initialGrants, currentSessionId)),
          Effect.andThen(tmuxWorkspace.ensureWorkspace(input)),
        ),
      ),

      [WS_METHODS.tmuxWorkspaceGetSnapshot]: tmux.effect(
        WS_METHODS.tmuxWorkspaceGetSnapshot,
        (input) =>
          validateActorSession(input.actor, currentSessionId).pipe(
            Effect.andThen(tmuxWorkspace.getSnapshot(input)),
          ),
      ),

      [WS_METHODS.tmuxWorkspaceReconnect]: tmux.effect(WS_METHODS.tmuxWorkspaceReconnect, (input) =>
        validateActorSession(input.actor, currentSessionId).pipe(
          Effect.andThen(tmuxWorkspace.reconnectWorkspace(input)),
        ),
      ),

      [WS_METHODS.tmuxWorkspaceSubscribe]: tmux.streamEffect(
        WS_METHODS.tmuxWorkspaceSubscribe,
        (input) =>
          validateActorSession(input.actor, currentSessionId).pipe(
            Effect.andThen(
              Effect.gen(function* () {
                const queue = yield* Queue.unbounded<TmuxKernelEvent>();
                const unsubscribe = yield* tmuxWorkspace.subscribe(input, (event) =>
                  Queue.offer(queue, event).pipe(Effect.asVoid),
                );

                return Stream.fromQueue(queue).pipe(
                  Stream.ensuring(Effect.sync(() => unsubscribe())),
                );
              }),
            ),
          ),
      ),

      [WS_METHODS.tmuxWindowCreate]: tmux.effect(WS_METHODS.tmuxWindowCreate, (input) =>
        validateActorSession(input.actor, currentSessionId).pipe(
          Effect.andThen(tmuxWorkspace.createWindow(input)),
        ),
      ),

      [WS_METHODS.tmuxWindowClose]: tmux.effect(WS_METHODS.tmuxWindowClose, (input) =>
        validateActorSession(input.actor, currentSessionId).pipe(
          Effect.andThen(tmuxWorkspace.closeWindow(input)),
        ),
      ),

      [WS_METHODS.tmuxPaneCreate]: tmux.effect(WS_METHODS.tmuxPaneCreate, (input) =>
        validateActorSession(input.actor, currentSessionId).pipe(
          Effect.andThen(tmuxWorkspace.createPane(input)),
        ),
      ),

      [WS_METHODS.tmuxNeovimPaneCreate]: tmux.effect(WS_METHODS.tmuxNeovimPaneCreate, (input) =>
        validateActorSession(input.actor, currentSessionId).pipe(
          Effect.andThen(tmuxWorkspace.createNeovimPane(input)),
        ),
      ),

      [WS_METHODS.tmuxNeovimPaneReconnect]: tmux.effect(
        WS_METHODS.tmuxNeovimPaneReconnect,
        (input) =>
          validateActorSession(input.actor, currentSessionId).pipe(
            Effect.andThen(tmuxWorkspace.reconnectNeovimPane(input)),
          ),
      ),

      [WS_METHODS.tmuxPaneAttachMetadata]: tmux.effect(WS_METHODS.tmuxPaneAttachMetadata, (input) =>
        validateActorSession(input.actor, currentSessionId).pipe(
          Effect.andThen(tmuxWorkspace.attachPaneMetadata(input)),
        ),
      ),

      [WS_METHODS.tmuxOperationalPaneStatuses]: tmux.effect(
        WS_METHODS.tmuxOperationalPaneStatuses,
        (input) =>
          validateActorSession(input.actor, currentSessionId).pipe(
            Effect.andThen(tmuxWorkspace.listOperationalPaneStatuses(input)),
          ),
      ),

      [WS_METHODS.tmuxPaneClose]: tmux.effect(WS_METHODS.tmuxPaneClose, (input) =>
        validateActorSession(input.actor, currentSessionId).pipe(
          Effect.andThen(tmuxWorkspace.closePane(input)),
        ),
      ),

      [WS_METHODS.tmuxPaneResize]: tmux.effect(WS_METHODS.tmuxPaneResize, (input) =>
        validateActorSession(input.actor, currentSessionId).pipe(
          Effect.andThen(tmuxWorkspace.resizePane(input)),
        ),
      ),

      [WS_METHODS.tmuxPaneWrite]: tmux.effect(WS_METHODS.tmuxPaneWrite, (input) =>
        validateActorSession(input.actor, currentSessionId).pipe(
          Effect.andThen(tmuxWorkspace.writePane(input)),
        ),
      ),

      [WS_METHODS.tmuxPaneSubscribeStream]: tmux.streamEffect(
        WS_METHODS.tmuxPaneSubscribeStream,
        (input) =>
          validateActorSession(input.actor, currentSessionId).pipe(
            Effect.andThen(tmuxWorkspace.subscribePaneStream(input)),
          ),
      ),
    };
  });
