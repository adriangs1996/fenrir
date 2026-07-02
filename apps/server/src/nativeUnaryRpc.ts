import { Effect, Exit, Layer, Schema, Scope, Stream } from "effect";
import { Headers, HttpRouter, HttpServerRequest, HttpServerResponse } from "effect/unstable/http";
import { Rpc, RpcSchema, RpcSerialization } from "effect/unstable/rpc";
import { RequestId } from "effect/unstable/rpc/RpcMessage";

import { WS_METHODS, WsRpcGroup } from "@fenrir/contracts";

import { respondToAuthError } from "./auth/http";
import { AuthError, ServerAuth } from "./auth/Services/ServerAuth";
import { ProviderMaintenanceRunnerLive } from "./provider/providerMaintenanceRunner";
import { makeWsRpcLayer } from "./ws";

type NativeUnaryRpcHandler = (
  payload: unknown,
  context: {
    readonly client: Rpc.ServerClient;
    readonly requestId: RequestId;
    readonly headers: Headers.Headers;
  },
) => Effect.Effect<unknown, unknown>;

type NativeStreamRpcHandler = (
  payload: unknown,
  context: {
    readonly client: Rpc.ServerClient;
    readonly requestId: RequestId;
    readonly headers: Headers.Headers;
  },
) => Effect.Effect<Stream.Stream<unknown, unknown>, unknown> | Stream.Stream<unknown, unknown>;

const NativeUnaryRpcRequest = Schema.Struct({
  method: Schema.String,
  requestId: Schema.optional(Schema.String),
  payload: Schema.Unknown,
});

let nativeUnaryRpcRequestSequence = 0n;

const nextNativeUnaryRpcRequestId = () => {
  nativeUnaryRpcRequestSequence += 1n;
  return RequestId(nativeUnaryRpcRequestSequence);
};

class NativeUnaryRpcError extends Error {
  readonly _tag = "NativeUnaryRpcError";

  constructor(
    message: string,
    readonly status: number,
    override readonly cause?: unknown,
    readonly diagnostics?: {
      readonly method?: string | undefined;
      readonly requestId?: string | undefined;
    },
  ) {
    super(message);
  }
}

const causeTag = (cause: unknown) => {
  if (typeof cause === "object" && cause !== null && "_tag" in cause) {
    const tag = (cause as { readonly _tag?: unknown })._tag;
    if (typeof tag === "string" && tag.length > 0) {
      return tag;
    }
  }
  return cause instanceof Error ? cause.name : typeof cause;
};

const causeMessage = (cause: unknown) => {
  const message =
    cause instanceof Error
      ? cause.message
      : typeof cause === "object" && cause !== null && "message" in cause
        ? (cause as { readonly message?: unknown }).message
        : typeof cause === "string"
          ? cause
          : undefined;

  return typeof message === "string" && message.length > 0 ? message.slice(0, 1_000) : undefined;
};

const respondToNativeUnaryRpcError = (error: NativeUnaryRpcError) =>
  Effect.gen(function* () {
    if (error.status >= 500) {
      yield* Effect.logError("native unary rpc failed", {
        message: error.message,
        method: error.diagnostics?.method,
        requestId: error.diagnostics?.requestId,
        causeTag: causeTag(error.cause),
        causeMessage: causeMessage(error.cause),
        cause: error.cause,
      });
    }
    const diagnostics =
      error.status >= 500
        ? {
            method: error.diagnostics?.method,
            requestId: error.diagnostics?.requestId,
            cause: {
              tag: causeTag(error.cause),
              message: causeMessage(error.cause),
            },
          }
        : undefined;
    return HttpServerResponse.jsonUnsafe(
      {
        error: error.message,
        ...(diagnostics ? { diagnostics } : {}),
      },
      { status: error.status },
    );
  });

const decodeRpcPayload = (rpc: Rpc.AnyWithProps, payload: unknown) =>
  Schema.decodeUnknownEffect(Schema.toCodecJson(rpc.payloadSchema))(payload).pipe(
    Effect.mapError((cause) => new NativeUnaryRpcError("Invalid native RPC payload.", 400, cause)),
  ) as Effect.Effect<unknown, NativeUnaryRpcError, never>;

const encodeRpcSuccess = (rpc: Rpc.AnyWithProps, value: unknown) =>
  Schema.encodeUnknownEffect(Schema.toCodecJson(rpc.successSchema))(value).pipe(
    Effect.mapError(
      (cause) => new NativeUnaryRpcError("Failed to encode native RPC response.", 500, cause),
    ),
  ) as Effect.Effect<unknown, NativeUnaryRpcError, never>;

const encodeRpcStreamElement = (rpc: Rpc.AnyWithProps, value: unknown) => {
  if (!RpcSchema.isStreamSchema(rpc.successSchema)) {
    return Effect.fail(new NativeUnaryRpcError("Native stream RPC requires a stream schema.", 400));
  }
  return Schema.encodeUnknownEffect(Schema.toCodecJson(rpc.successSchema.success))(value).pipe(
    Effect.mapError(
      (cause) => new NativeUnaryRpcError("Failed to encode native stream RPC event.", 500, cause),
    ),
  ) as Effect.Effect<unknown, NativeUnaryRpcError, never>;
};

const encodeNdjsonLine = (value: unknown) => new TextEncoder().encode(`${JSON.stringify(value)}\n`);

const nativeUnaryRpcRoute = Effect.gen(function* () {
  const request = yield* HttpServerRequest.HttpServerRequest;
  const serverAuth = yield* ServerAuth;
  const session = yield* serverAuth.authenticateHttpRequest(request);
  const rpcLayer = makeWsRpcLayer(session.sessionId).pipe(
    Layer.provideMerge(RpcSerialization.layerJson),
    Layer.provideMerge(ProviderMaintenanceRunnerLive),
  );
  const body = yield* HttpServerRequest.schemaBodyJson(NativeUnaryRpcRequest).pipe(
    Effect.mapError((cause) => new NativeUnaryRpcError("Invalid native RPC request.", 400, cause)),
  );
  const rpc = WsRpcGroup.requests.get(body.method) as Rpc.AnyWithProps | undefined;
  if (!rpc) {
    return yield* Effect.fail(
      new NativeUnaryRpcError(`Unknown native RPC method: ${body.method}`, 404),
    );
  }
  if (RpcSchema.isStreamSchema(rpc.successSchema)) {
    return yield* Effect.fail(
      new NativeUnaryRpcError(
        `Native unary RPC does not support streaming method: ${body.method}`,
        400,
      ),
    );
  }

  const runHandler = Effect.gen(function* () {
    const payload = yield* decodeRpcPayload(rpc, body.payload);
    const handler = (yield* WsRpcGroup.accessHandler(
      body.method as never,
    )) as unknown as NativeUnaryRpcHandler;
    const value = yield* handler(payload as never, {
      client: new Rpc.ServerClient(0),
      requestId: nextNativeUnaryRpcRequestId(),
      headers: Headers.fromInput(request.headers),
    });
    const encoded = yield* encodeRpcSuccess(rpc, value);
    return HttpServerResponse.jsonUnsafe({ ok: true, payload: encoded }, { status: 200 });
  }).pipe(
    Effect.mapError((cause) =>
      cause instanceof NativeUnaryRpcError
        ? cause
        : new NativeUnaryRpcError(`Native RPC ${body.method} failed.`, 500, cause, {
            method: body.method,
            requestId: body.requestId,
          }),
    ),
    Effect.provide(rpcLayer),
  );

  return yield* runHandler;
});

const nativeStreamRpcRoute = Effect.gen(function* () {
  const request = yield* HttpServerRequest.HttpServerRequest;
  const serverAuth = yield* ServerAuth;
  const session = yield* serverAuth.authenticateHttpRequest(request);
  const rpcLayer = makeWsRpcLayer(session.sessionId).pipe(
    Layer.provideMerge(RpcSerialization.layerJson),
    Layer.provideMerge(ProviderMaintenanceRunnerLive),
  );
  const body = yield* HttpServerRequest.schemaBodyJson(NativeUnaryRpcRequest).pipe(
    Effect.mapError((cause) => new NativeUnaryRpcError("Invalid native RPC request.", 400, cause)),
  );
  const rpc = WsRpcGroup.requests.get(body.method) as Rpc.AnyWithProps | undefined;
  if (!rpc) {
    return yield* Effect.fail(
      new NativeUnaryRpcError(`Unknown native RPC method: ${body.method}`, 404),
    );
  }
  if (body.method !== WS_METHODS.tmuxPaneSubscribeStream) {
    return yield* Effect.fail(
      new NativeUnaryRpcError(`Unsupported native stream RPC method: ${body.method}`, 404),
    );
  }
  if (!RpcSchema.isStreamSchema(rpc.successSchema)) {
    return yield* Effect.fail(
      new NativeUnaryRpcError(`Native stream RPC requires streaming method: ${body.method}`, 400),
    );
  }

  const runHandler = Effect.gen(function* () {
    const payload = yield* decodeRpcPayload(rpc, body.payload);
    const rpcScope = yield* Scope.make();
    const rpcContext = yield* Layer.buildWithScope(rpcLayer, rpcScope);
    const handler = (yield* WsRpcGroup.accessHandler(body.method as never).pipe(
      Effect.provide(rpcContext),
    )) as unknown as NativeStreamRpcHandler;
    const handled = handler(payload as never, {
      client: new Rpc.ServerClient(0),
      requestId: nextNativeUnaryRpcRequestId(),
      headers: Headers.fromInput(request.headers),
    });
    const eventStream = (Effect.isEffect(handled) ? yield* handled : handled) as Stream.Stream<
      unknown,
      unknown
    >;
    return HttpServerResponse.stream(
      eventStream.pipe(
        Stream.provideContext(rpcContext),
        Stream.mapEffect((event) => encodeRpcStreamElement(rpc, event)),
        Stream.map(encodeNdjsonLine),
        Stream.ensuring(Scope.close(rpcScope, Exit.void)),
      ),
      {
        contentType: "application/x-ndjson",
        headers: {
          "cache-control": "no-store",
        },
      },
    );
  }).pipe(
    Effect.mapError((cause) =>
      cause instanceof NativeUnaryRpcError
        ? cause
        : new NativeUnaryRpcError(`Native stream RPC ${body.method} failed.`, 500, cause, {
            method: body.method,
            requestId: body.requestId,
          }),
    ),
  );

  return yield* runHandler;
});

export const nativeUnaryRpcRouteLayer = Layer.mergeAll(
  HttpRouter.add(
    "POST",
    "/api/native/rpc",
    nativeUnaryRpcRoute.pipe(
      Effect.catchTag("AuthError", (error: AuthError) => respondToAuthError(error)),
      Effect.catchTag("NativeUnaryRpcError", respondToNativeUnaryRpcError),
    ),
  ),
  HttpRouter.add(
    "POST",
    "/api/native/rpc/stream",
    nativeStreamRpcRoute.pipe(
      Effect.catchTag("AuthError", (error: AuthError) => respondToAuthError(error)),
      Effect.catchTag("NativeUnaryRpcError", respondToNativeUnaryRpcError),
    ),
  ),
);
