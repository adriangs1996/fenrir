import { Clock, Duration, Effect } from "effect";
import { type HttpServerRequest } from "effect/unstable/http";
import * as Socket from "effect/unstable/socket/Socket";

// Effect RPC clients (web transport and CLI) send a protocol-level Ping every
// 5 seconds, so a healthy connection always produces inbound traffic. A socket
// that stays silent for the whole window is a dead peer (laptop sleep, network
// drop without a close frame) and must be reaped so its per-connection
// resources are released and `markDisconnected` fires.
export const WS_IDLE_TIMEOUT_MS = 30_000;

export const WS_IDLE_CLOSE_CODE = 4008;
export const WS_IDLE_CLOSE_REASON = "connection idle timeout";

const idleCloseError = () =>
  new Socket.SocketError({
    reason: new Socket.SocketCloseError({
      code: WS_IDLE_CLOSE_CODE,
      closeReason: WS_IDLE_CLOSE_REASON,
    }),
  });

/**
 * Decorates a `Socket` so its `runRaw` loop fails with a close error when no
 * inbound data arrives within `idleTimeoutMs`. Failing the loop tears down the
 * websocket scope, which closes the underlying socket and runs every
 * per-connection finalizer.
 */
export const wrapSocketWithIdleTimeout = (
  socket: Socket.Socket,
  idleTimeoutMs: number = WS_IDLE_TIMEOUT_MS,
): Socket.Socket =>
  Socket.make({
    writer: socket.writer,
    runRaw: (handler, options) =>
      Effect.clockWith((clock) => {
        let lastInboundAt = clock.currentTimeMillisUnsafe();

        const trackedHandler = (data: string | Uint8Array) => {
          lastInboundAt = clock.currentTimeMillisUnsafe();
          return handler(data);
        };

        const idleWatchdog = Effect.gen(function* () {
          for (;;) {
            const now = yield* Clock.currentTimeMillis;
            const idleForMs = now - lastInboundAt;
            if (idleForMs >= idleTimeoutMs) {
              return yield* Effect.fail(idleCloseError());
            }
            yield* Effect.sleep(Duration.millis(idleTimeoutMs - idleForMs));
          }
        });

        return socket.runRaw(trackedHandler, options).pipe(Effect.raceFirst(idleWatchdog));
      }),
  });

/**
 * Returns a request whose `upgrade` yields an idle-timeout-wrapped socket, so
 * `RpcServer.toHttpEffectWebsocket` transparently gets dead-peer reaping.
 */
export const withIdleTimeoutUpgrade = (
  request: HttpServerRequest.HttpServerRequest,
  idleTimeoutMs: number = WS_IDLE_TIMEOUT_MS,
): HttpServerRequest.HttpServerRequest =>
  new Proxy(request, {
    get(target, prop) {
      if (prop === "upgrade") {
        return Effect.map(target.upgrade, (socket) =>
          wrapSocketWithIdleTimeout(socket, idleTimeoutMs),
        );
      }
      const value = Reflect.get(target, prop, target);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
