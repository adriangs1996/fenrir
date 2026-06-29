import { Duration, Effect, Exit, Metric, Stream } from "effect";

import { getWsMethodPlane, type WsMethodName } from "@fenrir/contracts";

import { outcomeFromExit } from "./Attributes.ts";
import {
  increment,
  metricAttributes,
  rpcRequestDuration,
  rpcRequestsTotal,
  rpcStreamItemsTotal,
  withMetrics,
} from "./Metrics.ts";

const methodPlane = (method: string) => getWsMethodPlane(method as WsMethodName);

const annotateRpcSpan = (
  method: string,
  traceAttributes?: Readonly<Record<string, unknown>>,
): Effect.Effect<void, never, never> =>
  Effect.annotateCurrentSpan({
    "rpc.method": method,
    "rpc.stream.plane": methodPlane(method),
    ...traceAttributes,
  });

const recordRpcStreamMetrics = <E>(
  method: string,
  startedAt: number,
  exit: Exit.Exit<unknown, E>,
): Effect.Effect<void, never, never> =>
  Effect.gen(function* () {
    const plane = methodPlane(method);
    yield* Metric.update(
      Metric.withAttributes(rpcRequestDuration, metricAttributes({ method, plane })),
      Duration.millis(Math.max(0, Date.now() - startedAt)),
    );
    yield* Metric.update(
      Metric.withAttributes(
        rpcRequestsTotal,
        metricAttributes({
          method,
          plane,
          outcome: outcomeFromExit(exit),
        }),
      ),
      1,
    );
  });

export const observeRpcEffect = <A, E, R>(
  method: string,
  effect: Effect.Effect<A, E, R>,
  traceAttributes?: Readonly<Record<string, unknown>>,
): Effect.Effect<A, E, R> =>
  Effect.gen(function* () {
    yield* annotateRpcSpan(method, traceAttributes);

    return yield* effect.pipe(
      withMetrics({
        counter: rpcRequestsTotal,
        timer: rpcRequestDuration,
        attributes: {
          method,
          plane: methodPlane(method),
        },
      }),
    );
  });

const countRpcStreamItem = (method: string): Effect.Effect<void, never, never> =>
  increment(rpcStreamItemsTotal, {
    method,
    plane: methodPlane(method),
  });

export const observeRpcStream = <A, E, R>(
  method: string,
  stream: Stream.Stream<A, E, R>,
  traceAttributes?: Readonly<Record<string, unknown>>,
): Stream.Stream<A, E, R> =>
  Stream.unwrap(
    Effect.gen(function* () {
      yield* annotateRpcSpan(method, traceAttributes);
      const startedAt = Date.now();
      return stream.pipe(
        Stream.tap(() => countRpcStreamItem(method)),
        Stream.onExit((exit) => recordRpcStreamMetrics(method, startedAt, exit)),
      );
    }),
  );

export const observeRpcStreamEffect = <A, StreamError, StreamContext, EffectError, EffectContext>(
  method: string,
  effect: Effect.Effect<Stream.Stream<A, StreamError, StreamContext>, EffectError, EffectContext>,
  traceAttributes?: Readonly<Record<string, unknown>>,
): Stream.Stream<A, StreamError | EffectError, StreamContext | EffectContext> =>
  Stream.unwrap(
    Effect.gen(function* () {
      yield* annotateRpcSpan(method, traceAttributes);
      const startedAt = Date.now();
      const exit = yield* Effect.exit(effect);

      if (Exit.isFailure(exit)) {
        yield* recordRpcStreamMetrics(method, startedAt, exit);
        return yield* Effect.failCause(exit.cause);
      }

      return exit.value.pipe(
        Stream.tap(() => countRpcStreamItem(method)),
        Stream.onExit((streamExit) => recordRpcStreamMetrics(method, startedAt, streamExit)),
      );
    }),
  );
