import { expect, it } from "@effect/vitest";
import { Cause, Deferred, Duration, Effect, Exit, Fiber } from "effect";
import { TestClock } from "effect/testing";
import * as Socket from "effect/unstable/socket/Socket";

import {
  WS_IDLE_CLOSE_CODE,
  WS_IDLE_TIMEOUT_MS,
  wrapSocketWithIdleTimeout,
} from "./socketIdleTimeout.ts";

type RawHandler = (data: string | Uint8Array) => unknown;

const makeFakeSocket = () => {
  let handler: RawHandler | null = null;
  const closed = Deferred.makeUnsafe<void>();

  const socket = Socket.make({
    writer: Effect.succeed(() => Effect.void),
    runRaw: (rawHandler) =>
      Effect.suspend(() => {
        handler = rawHandler as RawHandler;
        return Deferred.await(closed);
      }),
  });

  return {
    socket,
    emit: (data: string) => {
      handler?.(data);
    },
    close: () => Deferred.doneUnsafe(closed, Exit.void),
  };
};

const isIdleCloseExit = (exit: Exit.Exit<unknown, unknown>): boolean => {
  if (Exit.isSuccess(exit)) {
    return false;
  }
  const failure = Exit.isFailure(exit) ? Cause.squash(exit.cause) : undefined;
  return (
    Socket.SocketError.is(failure) &&
    failure.reason._tag === "SocketCloseError" &&
    failure.reason.code === WS_IDLE_CLOSE_CODE
  );
};

it.effect("closes the socket after the idle timeout with no inbound data", () =>
  Effect.gen(function* () {
    const fake = makeFakeSocket();
    const wrapped = wrapSocketWithIdleTimeout(fake.socket);

    const fiber = yield* Effect.forkScoped(wrapped.runRaw(() => undefined));
    yield* TestClock.adjust(Duration.millis(WS_IDLE_TIMEOUT_MS));

    const exit = yield* Fiber.await(fiber);
    expect(isIdleCloseExit(exit)).toBe(true);
  }),
);

it.effect("keeps the socket alive while inbound data arrives", () =>
  Effect.gen(function* () {
    const fake = makeFakeSocket();
    const wrapped = wrapSocketWithIdleTimeout(fake.socket);

    const fiber = yield* Effect.forkScoped(wrapped.runRaw(() => undefined));

    for (let i = 0; i < 5; i++) {
      yield* TestClock.adjust(Duration.millis(WS_IDLE_TIMEOUT_MS - 1_000));
      fake.emit("ping");
    }

    expect(fiber.pollUnsafe()).toBeUndefined();

    fake.close();
    const exit = yield* Fiber.await(fiber);
    expect(Exit.isSuccess(exit)).toBe(true);
  }),
);

it.effect("forwards inbound data to the wrapped handler", () =>
  Effect.gen(function* () {
    const fake = makeFakeSocket();
    const wrapped = wrapSocketWithIdleTimeout(fake.socket);
    const received: Array<string | Uint8Array> = [];

    const fiber = yield* Effect.forkScoped(
      wrapped.runRaw((data) => {
        received.push(data);
      }),
    );
    yield* TestClock.adjust(Duration.millis(1));

    fake.emit("hello");
    fake.close();
    yield* Fiber.await(fiber);

    expect(received).toEqual(["hello"]);
  }),
);
