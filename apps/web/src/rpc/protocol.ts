import { WsRpcGroup } from "@fenrir/contracts";
import { Duration, Effect, Layer, Schedule } from "effect";
import { RpcClient, RpcSerialization } from "effect/unstable/rpc";
import * as Socket from "effect/unstable/socket/Socket";

import {
  acknowledgeRpcRequest,
  clearAllTrackedRpcRequests,
  trackRpcRequestSent,
} from "./requestLatencyState";
import {
  getWsReconnectDelayMsForRetry,
  recordWsConnectionAttempt,
  recordWsConnectionClosed,
  recordWsConnectionErrored,
  recordWsConnectionOpened,
  WS_RECONNECT_MAX_RETRIES,
} from "./wsConnectionState";

export interface WsProtocolLifecycleHandlers {
  readonly reportGlobalStatus?: boolean;
  readonly isActive?: () => boolean;
  readonly onAttempt?: (socketUrl: string) => void;
  readonly onOpen?: () => void;
  readonly onInboundMessage?: () => void;
  readonly onHeartbeatPong?: () => void;
  /**
   * `error` carries the original thrown value when the failure originated
   * from the socket-URL provider (e.g. a typed auth HTTP error), so handlers
   * can classify auth failures instead of parsing the message string.
   */
  readonly onError?: (message: string, error?: unknown) => void;
  readonly onClose?: (details: { readonly code: number; readonly reason: string }) => void;
}

export const makeWsRpcProtocolClient = RpcClient.make(WsRpcGroup);
type RpcClientFactory = typeof makeWsRpcProtocolClient;
export type WsRpcProtocolClient =
  RpcClientFactory extends Effect.Effect<infer Client, any, any> ? Client : never;
export type WsRpcProtocolSocketUrlProvider = string | (() => Promise<string>);

function formatSocketErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim().length > 0) {
    return error.message;
  }
  return String(error);
}

function resolveWsRpcSocketUrl(rawUrl: string): string {
  const resolved = new URL(rawUrl);
  if (resolved.protocol !== "ws:" && resolved.protocol !== "wss:") {
    throw new Error(`Unsupported websocket transport URL protocol: ${resolved.protocol}`);
  }

  resolved.pathname = "/ws";
  return resolved.toString();
}

function defaultLifecycleHandlers(): Required<WsProtocolLifecycleHandlers> {
  return {
    reportGlobalStatus: true,
    isActive: () => true,
    onAttempt: recordWsConnectionAttempt,
    onOpen: recordWsConnectionOpened,
    onInboundMessage: () => undefined,
    onHeartbeatPong: () => undefined,
    onError: (message) => {
      clearAllTrackedRpcRequests();
      recordWsConnectionErrored(message);
    },
    onClose: (details) => {
      clearAllTrackedRpcRequests();
      recordWsConnectionClosed(details);
    },
  };
}

function composeLifecycleHandlers(
  handlers?: WsProtocolLifecycleHandlers,
): Required<WsProtocolLifecycleHandlers> {
  const defaults = defaultLifecycleHandlers();
  const isActive = handlers?.isActive ?? (() => true);
  const reportGlobalStatus = handlers?.reportGlobalStatus ?? true;

  return {
    reportGlobalStatus,
    isActive,
    onAttempt: (socketUrl) => {
      if (!isActive()) {
        return;
      }
      if (reportGlobalStatus) {
        defaults.onAttempt(socketUrl);
      }
      handlers?.onAttempt?.(socketUrl);
    },
    onOpen: () => {
      if (!isActive()) {
        return;
      }
      if (reportGlobalStatus) {
        defaults.onOpen();
      }
      handlers?.onOpen?.();
    },
    onInboundMessage: () => {
      if (!isActive()) {
        return;
      }
      defaults.onInboundMessage();
      handlers?.onInboundMessage?.();
    },
    onHeartbeatPong: () => {
      if (!isActive()) {
        return;
      }
      defaults.onHeartbeatPong();
      handlers?.onHeartbeatPong?.();
    },
    onError: (message, error) => {
      if (!isActive()) {
        return;
      }
      if (reportGlobalStatus) {
        defaults.onError(message);
      }
      handlers?.onError?.(message, error);
    },
    onClose: (details) => {
      if (!isActive()) {
        return;
      }
      if (reportGlobalStatus) {
        defaults.onClose(details);
      }
      handlers?.onClose?.(details);
    },
  };
}

function resolveAsyncWsRpcSocketUrl(
  url: () => Promise<string>,
  lifecycle: Required<WsProtocolLifecycleHandlers>,
): Effect.Effect<string> {
  // Invoke the provider on EVERY socket open attempt. The resolved URL embeds
  // a short-lived wsToken (5-minute TTL); memoizing it doomed every in-session
  // retry once the token expired, turning a transient blip into minutes of
  // guaranteed-failing reconnect attempts.
  return Effect.promise(() =>
    Promise.resolve()
      .then(url)
      .then(resolveWsRpcSocketUrl)
      .catch((error: unknown) => {
        lifecycle.onError(formatSocketErrorMessage(error), error);
        throw error;
      }),
  );
}

export function createWsRpcProtocolLayer(
  url: WsRpcProtocolSocketUrlProvider,
  handlers?: WsProtocolLifecycleHandlers,
) {
  const lifecycle = composeLifecycleHandlers(handlers);
  const resolvedUrl =
    typeof url === "function"
      ? resolveAsyncWsRpcSocketUrl(url, lifecycle)
      : resolveWsRpcSocketUrl(url);

  const trackingWebSocketConstructorLayer = Layer.succeed(
    Socket.WebSocketConstructor,
    (socketUrl, protocols) => {
      lifecycle.onAttempt(socketUrl);
      const socket = new globalThis.WebSocket(socketUrl, protocols);

      socket.addEventListener(
        "open",
        () => {
          lifecycle.onOpen();
        },
        { once: true },
      );
      socket.addEventListener(
        "error",
        () => {
          lifecycle.onError("Unable to connect to the T3 server WebSocket.");
        },
        { once: true },
      );
      socket.addEventListener("message", (event) => {
        lifecycle.onInboundMessage();
        try {
          const message = JSON.parse(String(event.data)) as { readonly _tag?: string };
          if (message._tag === "Pong") {
            lifecycle.onHeartbeatPong();
          }
        } catch {
          // Ignore malformed messages here; the Effect RPC parser owns protocol errors.
        }
      });
      socket.addEventListener(
        "close",
        (event) => {
          lifecycle.onClose({
            code: event.code,
            reason: event.reason,
          });
        },
        { once: true },
      );

      return socket;
    },
  );
  const socketLayer = Socket.layerWebSocket(resolvedUrl).pipe(
    Layer.provide(trackingWebSocketConstructorLayer),
  );
  const retryPolicy = Schedule.addDelay(Schedule.recurs(WS_RECONNECT_MAX_RETRIES), (retryCount) =>
    Effect.succeed(Duration.millis(getWsReconnectDelayMsForRetry(retryCount) ?? 0)),
  );
  const protocolLayer = Layer.effect(
    RpcClient.Protocol,
    Effect.map(
      RpcClient.makeProtocolSocket({
        retryPolicy,
        retryTransientErrors: true,
      }),
      (protocol) => ({
        ...protocol,
        run: (clientId, writeResponse) =>
          protocol.run(clientId, (response) => {
            if (response._tag === "Chunk" || response._tag === "Exit") {
              acknowledgeRpcRequest(response.requestId);
            } else if (response._tag === "ClientProtocolError" || response._tag === "Defect") {
              clearAllTrackedRpcRequests();
            }
            return writeResponse(response);
          }),
        send: (clientId, request, transferables) => {
          if (request._tag === "Request") {
            trackRpcRequestSent(request.id, request.tag);
          }
          return protocol.send(clientId, request, transferables);
        },
      }),
    ),
  );

  return protocolLayer.pipe(Layer.provide(Layer.mergeAll(socketLayer, RpcSerialization.layerJson)));
}
