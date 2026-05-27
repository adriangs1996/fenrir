import { Deferred, Effect, Layer, Option, Ref } from "effect";
import type * as Socket from "effect/unstable/socket/Socket";

import {
  BrowserLabControlError,
  BrowserLabControlService,
  type BrowserLabControlServiceShape,
} from "../Services/BrowserLabControlService.ts";

interface PendingCall {
  readonly deferred: Deferred.Deferred<unknown, BrowserLabControlError>;
}

interface Connection {
  readonly writer: (chunk: string) => Effect.Effect<void, Socket.SocketError>;
}

function parseMessage(raw: string | Uint8Array): unknown {
  const text =
    typeof raw === "string" ? raw : new TextDecoder().decode(raw as Uint8Array<ArrayBuffer>);
  return JSON.parse(text);
}

function errorMessage(value: unknown, fallback: string): string {
  if (value && typeof value === "object" && "message" in value) {
    const message = (value as { message?: unknown }).message;
    if (typeof message === "string" && message.trim()) {
      return message;
    }
  }
  return fallback;
}

export const BrowserLabControlServiceLive = Layer.effect(
  BrowserLabControlService,
  Effect.gen(function* () {
    const connectionRef = yield* Ref.make<Connection | null>(null);
    const pending = new Map<number, PendingCall>();
    let nextId = 1;

    const clearConnection = Effect.gen(function* () {
      yield* Ref.set(connectionRef, null);
      for (const [id, call] of pending) {
        pending.delete(id);
        yield* Deferred.fail(
          call.deferred,
          new BrowserLabControlError({ message: "Browser Lab desktop connection closed." }),
        );
      }
    });

    const handleMessage = (message: unknown) =>
      Effect.gen(function* () {
        if (!message || typeof message !== "object") {
          return;
        }
        const record = message as {
          readonly id?: unknown;
          readonly result?: unknown;
          readonly error?: unknown;
        };
        if (typeof record.id !== "number") {
          return;
        }
        const call = pending.get(record.id);
        if (!call) {
          return;
        }
        pending.delete(record.id);
        if (record.error !== undefined) {
          yield* Deferred.fail(
            call.deferred,
            new BrowserLabControlError({
              message: errorMessage(record.error, "Browser Lab desktop call failed."),
            }),
          );
          return;
        }
        yield* Deferred.succeed(call.deferred, record.result);
      });

    return {
      isConnected: Ref.get(connectionRef).pipe(Effect.map((connection) => connection !== null)),
      registerSocket: (socket) =>
        Effect.scoped(
          Effect.gen(function* () {
            const writer = yield* socket.writer;
            yield* Ref.set(connectionRef, { writer });
            yield* socket
              .runRaw((raw) =>
                Effect.try({
                  try: () => parseMessage(raw),
                  catch: () => undefined,
                }).pipe(Effect.flatMap(handleMessage)),
              )
              .pipe(
                Effect.ensuring(clearConnection),
                Effect.catch(() => clearConnection),
              );
          }),
        ),
      call: (method, params) =>
        Effect.gen(function* () {
          const connection = yield* Ref.get(connectionRef);
          if (!connection) {
            return yield* new BrowserLabControlError({
              message: "Browser Lab desktop connection is not available.",
            });
          }
          const id = nextId++;
          const deferred = yield* Deferred.make<unknown, BrowserLabControlError>();
          pending.set(id, { deferred });
          yield* connection.writer(JSON.stringify({ id, method, params })).pipe(
            Effect.mapError(
              (cause) =>
                new BrowserLabControlError({
                  message: `Failed to send Browser Lab command: ${cause}`,
                }),
            ),
            Effect.catch((error) =>
              Effect.gen(function* () {
                pending.delete(id);
                return yield* error;
              }),
            ),
          );
          const result = yield* Deferred.await(deferred).pipe(Effect.timeoutOption("15 seconds"));
          pending.delete(id);
          if (Option.isNone(result)) {
            return yield* new BrowserLabControlError({
              message: `Browser Lab command '${method}' timed out.`,
            });
          }
          return result.value;
        }),
    } satisfies BrowserLabControlServiceShape;
  }),
);
