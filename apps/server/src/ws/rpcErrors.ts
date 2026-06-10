import { Cause, Schema } from "effect";

import {
  ManagedProcessRpcError,
  OrchestrationDispatchCommandError,
  SourceControlStackRpcError,
} from "@fenrir/contracts";

/**
 * Builds an error mapper that passes through values already matching the RPC
 * error schema and wraps everything else with the provided fallback
 * constructor.
 */
export const makeRpcErrorMapper = <A>(
  schema: Schema.Schema<A>,
  fallback: (cause: unknown) => A,
) => {
  const isRpcError = Schema.is(schema);
  return (cause: unknown): A => (isRpcError(cause) ? cause : fallback(cause));
};

export const toManagedProcessRpcError = makeRpcErrorMapper(
  ManagedProcessRpcError,
  (err) =>
    new ManagedProcessRpcError({
      code: "io-error",
      message: err instanceof globalThis.Error ? err.message : "Managed process operation failed",
    }),
);

export const toSourceControlStackRpcError = makeRpcErrorMapper(
  SourceControlStackRpcError,
  (err) =>
    new SourceControlStackRpcError({
      message:
        err instanceof globalThis.Error ? err.message : "Source-control stack operation failed.",
      cause: err,
    }),
);

export const toDispatchCommandError = (
  cause: unknown,
  fallbackMessage: string,
): OrchestrationDispatchCommandError =>
  makeRpcErrorMapper(
    OrchestrationDispatchCommandError,
    (error) =>
      new OrchestrationDispatchCommandError({
        message: error instanceof Error ? error.message : fallbackMessage,
        cause: error,
      }),
  )(cause);

export const toBootstrapDispatchCommandCauseError = (
  cause: Cause.Cause<unknown>,
): OrchestrationDispatchCommandError =>
  makeRpcErrorMapper(
    OrchestrationDispatchCommandError,
    (error) =>
      new OrchestrationDispatchCommandError({
        message: error instanceof Error ? error.message : "Failed to bootstrap thread turn start.",
        cause,
      }),
  )(Cause.squash(cause));
