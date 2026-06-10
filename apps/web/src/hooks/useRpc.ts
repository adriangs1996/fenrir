import type { EnvironmentApi, EnvironmentId, LocalApi } from "@fenrir/contracts";
import { useQuery, type UseQueryResult } from "@tanstack/react-query";

import { toastManager } from "../components/ui/toast";
import { readEnvironmentApi } from "../environmentApi";
import { readLocalApi } from "../localApi";

/**
 * Centralized access helpers for `EnvironmentApi` / `LocalApi` calls.
 *
 * Call sites previously reinvented the same boilerplate: read the api,
 * null-check it (environment not connected), try/catch the call, and show an
 * error toast. These helpers centralize that so behavior stays consistent:
 *
 * - `runEnvironmentRpc` / `runLocalRpc` for mutations and one-shot calls.
 * - `useEnvironmentRpcQuery` for reads (React Query is the read layer in
 *   this app; this wrapper centralizes the connection gating).
 * - `rpcErrorMessage` for normalizing unknown errors into user-visible text.
 *
 * Not covered on purpose: streaming subscriptions (`onEvent`-style APIs),
 * optimistic updates, and flows that render errors inline instead of
 * toasting — those keep their custom handling.
 */

/** Normalizes an unknown error into a user-visible message. */
export function rpcErrorMessage(error: unknown, fallback = "An error occurred."): string {
  return error instanceof Error ? error.message : fallback;
}

export interface RpcRunOptions {
  /**
   * Error toast shown when the call rejects. When omitted, the error
   * propagates to the caller unchanged.
   */
  errorToast?: {
    title: string;
    /** Used when the thrown value is not an `Error`. Defaults to "An error occurred." */
    fallbackDescription?: string;
  };
  /** Rethrow the error after showing the error toast. */
  rethrow?: boolean;
  /**
   * Error toast shown when the API is unavailable (environment not
   * connected). When omitted, the call is skipped silently and the helper
   * resolves to `undefined`.
   */
  unavailableToast?: {
    title: string;
    description?: string;
  };
}

async function runRpc<Api, T>(
  api: Api | undefined,
  run: (api: Api) => Promise<T>,
  options: RpcRunOptions,
): Promise<T | undefined> {
  if (!api) {
    if (options.unavailableToast) {
      toastManager.add({
        type: "error",
        title: options.unavailableToast.title,
        ...(options.unavailableToast.description !== undefined
          ? { description: options.unavailableToast.description }
          : {}),
      });
    }
    return undefined;
  }

  if (!options.errorToast) {
    return run(api);
  }

  try {
    return await run(api);
  } catch (error) {
    toastManager.add({
      type: "error",
      title: options.errorToast.title,
      description: rpcErrorMessage(error, options.errorToast.fallbackDescription),
    });
    if (options.rethrow) {
      throw error;
    }
    return undefined;
  }
}

/**
 * Runs a call against an environment-scoped API.
 *
 * Resolves the api synchronously and invokes `run` synchronously up to its
 * first `await`, so callers may rely on synchronous side effects inside
 * `run` happening before the helper yields. Resolves to `undefined` when
 * the environment is not connected or when the call failed and an
 * `errorToast` was configured (without `rethrow`).
 */
export function runEnvironmentRpc<T>(
  environmentId: EnvironmentId | null | undefined,
  run: (api: EnvironmentApi) => Promise<T>,
  options: RpcRunOptions = {},
): Promise<T | undefined> {
  const api = environmentId ? readEnvironmentApi(environmentId) : undefined;
  return runRpc(api, run, options);
}

function readLocalApiOrUndefined(): LocalApi | undefined {
  try {
    return readLocalApi();
  } catch {
    return undefined;
  }
}

/**
 * Runs a call against the local API. Same semantics as `runEnvironmentRpc`;
 * a local api that cannot be constructed (no primary connection yet) is
 * treated as unavailable.
 */
export function runLocalRpc<T>(
  run: (api: LocalApi) => Promise<T>,
  options: RpcRunOptions = {},
): Promise<T | undefined> {
  return runRpc(readLocalApiOrUndefined(), run, options);
}

/**
 * Builds a React Query `queryFn` for an environment-scoped read. A missing
 * connection surfaces as a query error so the read recovers via retries
 * after reconnects. Use directly for imperative `prefetchQuery` calls so
 * prefetched entries share the exact semantics of `useEnvironmentRpcQuery`.
 */
export function environmentRpcQueryFn<T>(
  environmentId: EnvironmentId | null | undefined,
  queryFn: (api: EnvironmentApi) => Promise<T>,
): () => Promise<T> {
  return () => {
    const api = environmentId ? readEnvironmentApi(environmentId) : undefined;
    if (!api) {
      throw new Error("Environment is not connected.");
    }
    return queryFn(api);
  };
}

export interface EnvironmentRpcQueryOptions<T> {
  environmentId: EnvironmentId | null | undefined;
  /** React Query cache key. Include the environment id for environment-scoped data. */
  queryKey: readonly unknown[];
  queryFn: (api: EnvironmentApi) => Promise<T>;
  /** Additional gating; the query is always disabled while `environmentId` is unset. */
  enabled?: boolean;
  staleTime?: number;
}

/**
 * React Query wrapper for environment-scoped reads. Centralizes the
 * "environment not connected" guard: the query is disabled until the
 * environment id is known, and a missing connection surfaces as a query
 * error (retried by React Query) so reads recover after reconnects.
 */
export function useEnvironmentRpcQuery<T>(
  options: EnvironmentRpcQueryOptions<T>,
): UseQueryResult<T> {
  const { enabled = true, environmentId, queryFn, queryKey, staleTime } = options;
  return useQuery({
    queryKey,
    queryFn: environmentRpcQueryFn(environmentId, queryFn),
    enabled: enabled && Boolean(environmentId),
    ...(staleTime !== undefined ? { staleTime } : {}),
  });
}
