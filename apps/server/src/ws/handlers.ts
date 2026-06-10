import { Effect, type Stream } from "effect";
import type { Rpc, RpcGroup } from "effect/unstable/rpc";

import { WsRpcGroup } from "@fenrir/contracts";

import {
  observeRpcEffect,
  observeRpcStream,
  observeRpcStreamEffect,
} from "../observability/RpcInstrumentation";

type WsRpcs = RpcGroup.Rpcs<typeof WsRpcGroup>;

/** Method tags handled by the WebSocket RPC group. */
export type WsMethod = WsRpcs["_tag"];

/** Payload type for a given WebSocket RPC method tag. */
export type WsPayload<Tag extends WsMethod> = Rpc.Payload<Rpc.ExtractTag<WsRpcs, Tag>>;

/**
 * Builds the per-domain RPC handler helpers used by the ws route modules.
 *
 * Every handler in the WebSocket router follows one of three shapes:
 * - `effect`: unary request/response handlers (`observeRpcEffect`)
 * - `stream`: subscription handlers returning a Stream (`observeRpcStream`)
 * - `streamEffect`: subscription handlers returning an Effect of a Stream
 *   (`observeRpcStreamEffect`)
 *
 * The factory binds the `rpc.aggregate` trace attribute once per domain so
 * route modules only declare the method tag and the handler body.
 */
export const makeRpcDomain = (aggregate: string) => {
  const traceAttributes = { "rpc.aggregate": aggregate } as const;
  return {
    effect:
      <Tag extends WsMethod, A, E, R>(
        method: Tag,
        run: (input: WsPayload<Tag>) => Effect.Effect<A, E, R>,
      ) =>
      (input: WsPayload<Tag>) =>
        observeRpcEffect(method, run(input), traceAttributes),
    stream:
      <Tag extends WsMethod, A, E, R>(
        method: Tag,
        run: (input: WsPayload<Tag>) => Stream.Stream<A, E, R>,
      ) =>
      (input: WsPayload<Tag>) =>
        observeRpcStream(method, run(input), traceAttributes),
    streamEffect:
      <Tag extends WsMethod, A, StreamError, StreamContext, EffectError, EffectContext>(
        method: Tag,
        run: (
          input: WsPayload<Tag>,
        ) => Effect.Effect<
          Stream.Stream<A, StreamError, StreamContext>,
          EffectError,
          EffectContext
        >,
      ) =>
      (input: WsPayload<Tag>) =>
        observeRpcStreamEffect(method, run(input), traceAttributes),
  };
};

/**
 * Like {@link makeRpcDomain}, but additionally binds the domain-wide error
 * mapper applied to every unary handler (e.g. `toManagedProcessRpcError`).
 */
export const makeRpcDomainWithErrors = <EOut>(
  aggregate: string,
  mapError: (cause: unknown) => EOut,
) => {
  const domain = makeRpcDomain(aggregate);
  return {
    ...domain,
    effect:
      <Tag extends WsMethod, A, E, R>(
        method: Tag,
        run: (input: WsPayload<Tag>) => Effect.Effect<A, E, R>,
      ) =>
      (input: WsPayload<Tag>) =>
        observeRpcEffect(method, run(input).pipe(Effect.mapError(mapError)), {
          "rpc.aggregate": aggregate,
        }),
  };
};
