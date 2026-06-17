import { Effect, Layer } from "effect";
import { HttpRouter, HttpServerRequest } from "effect/unstable/http";
import { RpcSerialization, RpcServer } from "effect/unstable/rpc";

import { type AuthSessionId, WsRpcGroup } from "@fenrir/contracts";

import { respondToAuthError } from "./auth/http";
import { ServerAuth } from "./auth/Services/ServerAuth";
import { SessionCredentialService } from "./auth/Services/SessionCredentialService";
import { ProviderMaintenanceRunnerLive } from "./provider/providerMaintenanceRunner";
import { makeAuthRoutes } from "./ws/routes/auth";
import { makeGitDiffRoutes } from "./ws/routes/gitDiff";
import { makeLocalServersRoutes } from "./ws/routes/localServers";
import { makeManagedProcessRoutes } from "./ws/routes/managedProcess";
import { makeOrchestrationRoutes } from "./ws/routes/orchestration";
import { makePlanRunnerRoutes } from "./ws/routes/planRunner";
import { makeRawTcpRoutes } from "./ws/routes/rawTcp";
import { makeRemoteControllerRoutes } from "./ws/routes/remoteController";
import { makeServerRoutes } from "./ws/routes/server";
import { makeSourceControlRoutes } from "./ws/routes/sourceControl";
import { sourceControlStackRoutes } from "./ws/routes/sourceControlStack";
import { makeTerminalRoutes } from "./ws/routes/terminal";
import { makeTrafficLensRoutes } from "./ws/routes/trafficLens";
import { makeVcsRoutes } from "./ws/routes/vcs";
import { makeWorkspaceRoutes } from "./ws/routes/workspace";
import { makeRefreshGitStatus } from "./ws/shared";

const makeWsRpcLayer = (currentSessionId: AuthSessionId) =>
  WsRpcGroup.toLayer(
    Effect.gen(function* () {
      const refreshGitStatus = yield* makeRefreshGitStatus;

      const terminalRoutes = yield* makeTerminalRoutes;
      const orchestrationRoutes = yield* makeOrchestrationRoutes({ refreshGitStatus });
      const serverRoutes = yield* makeServerRoutes;
      const authRoutes = yield* makeAuthRoutes({ currentSessionId });
      const workspaceRoutes = yield* makeWorkspaceRoutes;
      const sourceControlRoutes = yield* makeSourceControlRoutes;
      const vcsRoutes = yield* makeVcsRoutes({ refreshGitStatus });
      const gitDiffRoutes = yield* makeGitDiffRoutes({ refreshGitStatus });
      const rawTcpRoutes = yield* makeRawTcpRoutes;
      const remoteControllerRoutes = yield* makeRemoteControllerRoutes;
      const trafficLensRoutes = yield* makeTrafficLensRoutes;
      const localServersRoutes = yield* makeLocalServersRoutes;
      const planRunnerRoutes = yield* makePlanRunnerRoutes;
      const managedProcessRoutes = yield* makeManagedProcessRoutes;

      return WsRpcGroup.of({
        ...terminalRoutes,
        ...orchestrationRoutes,
        ...serverRoutes,
        ...authRoutes,
        ...workspaceRoutes,
        ...sourceControlRoutes,
        ...vcsRoutes,
        ...gitDiffRoutes,
        ...rawTcpRoutes,
        ...remoteControllerRoutes,
        ...trafficLensRoutes,
        ...localServersRoutes,
        ...planRunnerRoutes,
        ...managedProcessRoutes,
        ...sourceControlStackRoutes,
      });
    }),
  );

export const websocketRpcRouteLayer = Layer.unwrap(
  Effect.succeed(
    HttpRouter.add(
      "GET",
      "/ws",
      Effect.gen(function* () {
        const request = yield* HttpServerRequest.HttpServerRequest;
        const serverAuth = yield* ServerAuth;
        const sessions = yield* SessionCredentialService;
        const session = yield* serverAuth.authenticateWebSocketUpgrade(request);
        const rpcWebSocketHttpEffect = yield* RpcServer.toHttpEffectWebsocket(WsRpcGroup, {
          spanPrefix: "ws.rpc",
          spanAttributes: {
            "rpc.transport": "websocket",
            "rpc.system": "effect-rpc",
          },
        }).pipe(
          Effect.provide(
            makeWsRpcLayer(session.sessionId).pipe(
              Layer.provideMerge(RpcSerialization.layerJson),
              Layer.provideMerge(ProviderMaintenanceRunnerLive),
            ),
          ),
        );
        return yield* Effect.acquireUseRelease(
          sessions.markConnected(session.sessionId),
          () => rpcWebSocketHttpEffect,
          () => sessions.markDisconnected(session.sessionId),
        );
      }).pipe(Effect.catchTag("AuthError", respondToAuthError)),
    ),
  ),
);
