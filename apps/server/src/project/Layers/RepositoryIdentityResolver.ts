import type { RepositoryIdentity } from "@fenrir/contracts";
import { Cache, Duration, Effect, Exit, Layer } from "effect";
import { detectGitHostingProviderFromRemoteUrl, normalizeGitRemoteUrl } from "@fenrir/shared/git";

import {
  VcsDriverRegistry,
  VcsDriverRegistryLive,
  type VcsDriverHandle,
} from "../../vcs/VcsDriverRegistry.ts";
import {
  RepositoryIdentityResolver,
  type RepositoryIdentityResolverShape,
} from "../Services/RepositoryIdentityResolver.ts";

function parseRemoteFetchUrls(stdout: string): Map<string, string> {
  const remotes = new Map<string, string>();
  for (const line of stdout.split("\n")) {
    const trimmed = line.trim();
    if (trimmed.length === 0) continue;
    const match = /^(\S+)\s+(\S+)\s+\((fetch|push)\)$/.exec(trimmed);
    if (!match) continue;
    const [, remoteName = "", remoteUrl = "", direction = ""] = match;
    if (direction !== "fetch" || remoteName.length === 0 || remoteUrl.length === 0) {
      continue;
    }
    remotes.set(remoteName, remoteUrl);
  }
  return remotes;
}

function pickPrimaryRemote(
  remotes: ReadonlyMap<string, string>,
): { readonly remoteName: string; readonly remoteUrl: string } | null {
  for (const preferredRemoteName of ["upstream", "origin"] as const) {
    const remoteUrl = remotes.get(preferredRemoteName);
    if (remoteUrl) {
      return { remoteName: preferredRemoteName, remoteUrl };
    }
  }

  const [remoteName, remoteUrl] =
    [...remotes.entries()].toSorted(([left], [right]) => left.localeCompare(right))[0] ?? [];
  return remoteName && remoteUrl ? { remoteName, remoteUrl } : null;
}

function buildRepositoryIdentity(input: {
  readonly remoteName: string;
  readonly remoteUrl: string;
}): RepositoryIdentity {
  const canonicalKey = normalizeGitRemoteUrl(input.remoteUrl);
  const hostingProvider = detectGitHostingProviderFromRemoteUrl(input.remoteUrl);
  const repositoryPath = canonicalKey.split("/").slice(1).join("/");
  const repositoryPathSegments = repositoryPath.split("/").filter((segment) => segment.length > 0);
  const [owner] = repositoryPathSegments;
  const repositoryName = repositoryPathSegments.at(-1);

  return {
    canonicalKey,
    locator: {
      source: "git-remote",
      remoteName: input.remoteName,
      remoteUrl: input.remoteUrl,
    },
    ...(repositoryPath ? { displayName: repositoryPath } : {}),
    ...(hostingProvider ? { provider: hostingProvider.kind } : {}),
    ...(owner ? { owner } : {}),
    ...(repositoryName ? { name: repositoryName } : {}),
  };
}

const DEFAULT_REPOSITORY_IDENTITY_CACHE_CAPACITY = 512;
const DEFAULT_POSITIVE_CACHE_TTL = Duration.minutes(1);
const DEFAULT_NEGATIVE_CACHE_TTL = Duration.minutes(1);

interface RepositoryIdentityResolverOptions {
  readonly cacheCapacity?: number;
  readonly positiveCacheTtl?: Duration.Input;
  readonly negativeCacheTtl?: Duration.Input;
}

export const makeRepositoryIdentityResolver = Effect.fn("makeRepositoryIdentityResolver")(
  function* (options: RepositoryIdentityResolverOptions = {}) {
    const vcsRegistry = yield* VcsDriverRegistry;

    const detectRepository = (cwd: string): Effect.Effect<VcsDriverHandle | null> =>
      vcsRegistry.detect({ cwd }).pipe(Effect.catch(() => Effect.succeed(null)));

    const resolveRepositoryIdentityCacheKey = (cwd: string): Effect.Effect<string> =>
      detectRepository(cwd).pipe(Effect.map((handle) => handle?.repository.rootPath ?? cwd));

    const resolveRepositoryIdentityFromCacheKey = (
      cacheKey: string,
    ): Effect.Effect<RepositoryIdentity | null> =>
      Effect.gen(function* () {
        const handle = yield* detectRepository(cacheKey);
        if (!handle || handle.kind !== "git") {
          return null;
        }

        const remoteResult = yield* handle.driver
          .execute({
            operation: "RepositoryIdentityResolver.listRemotes",
            cwd: handle.repository.rootPath,
            args: ["remote", "-v"],
            allowNonZeroExit: true,
            timeoutMs: 5_000,
            maxOutputBytes: 64 * 1024,
          })
          .pipe(Effect.catch(() => Effect.succeed(null)));
        if (!remoteResult || remoteResult.exitCode !== 0) {
          return null;
        }

        const remote = pickPrimaryRemote(parseRemoteFetchUrls(remoteResult.stdout));
        return remote ? buildRepositoryIdentity(remote) : null;
      });

    const repositoryIdentityCache = yield* Cache.makeWith<string, RepositoryIdentity | null>({
      capacity: options.cacheCapacity ?? DEFAULT_REPOSITORY_IDENTITY_CACHE_CAPACITY,
      lookup: resolveRepositoryIdentityFromCacheKey,
      timeToLive: Exit.match({
        onSuccess: (value) =>
          value === null
            ? (options.negativeCacheTtl ?? DEFAULT_NEGATIVE_CACHE_TTL)
            : (options.positiveCacheTtl ?? DEFAULT_POSITIVE_CACHE_TTL),
        onFailure: () => Duration.zero,
      }),
    });

    const resolve: RepositoryIdentityResolverShape["resolve"] = Effect.fn(
      "RepositoryIdentityResolver.resolve",
    )(function* (cwd) {
      const cacheKey = yield* resolveRepositoryIdentityCacheKey(cwd);
      return yield* Cache.get(repositoryIdentityCache, cacheKey);
    });

    return {
      resolve,
    } satisfies RepositoryIdentityResolverShape;
  },
);

export const RepositoryIdentityResolverLive = Layer.effect(
  RepositoryIdentityResolver,
  makeRepositoryIdentityResolver(),
).pipe(Layer.provide(VcsDriverRegistryLive));
