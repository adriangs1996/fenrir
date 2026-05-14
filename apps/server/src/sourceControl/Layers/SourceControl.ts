import { Effect, Layer } from "effect";

import { RepositoryIdentityResolverLive } from "../../project/Layers/RepositoryIdentityResolver.ts";
import { RepositoryIdentityResolver } from "../../project/Services/RepositoryIdentityResolver.ts";
import { VcsDriverRegistry, VcsDriverRegistryLive } from "../../vcs/VcsDriverRegistry.ts";
import { SourceControl, type SourceControlShape } from "../Services/SourceControl.ts";

const makeSourceControl = Effect.gen(function* () {
  const vcsRegistry = yield* VcsDriverRegistry;
  const repositoryIdentityResolver = yield* RepositoryIdentityResolver;

  const resolveWorkspace: SourceControlShape["resolveWorkspace"] = Effect.fn(
    "SourceControl.resolveWorkspace",
  )(function* (cwd) {
    const handle = yield* vcsRegistry
      .detect({ cwd })
      .pipe(Effect.catch(() => Effect.succeed(null)));
    if (!handle) {
      return null;
    }

    const repositoryIdentity = yield* repositoryIdentityResolver.resolve(
      handle.repository.rootPath,
    );

    return {
      kind: handle.kind,
      rootPath: handle.repository.rootPath,
      metadataPath: handle.repository.metadataPath,
      repositoryIdentity,
    };
  });

  const isSupportedWorkspace: SourceControlShape["isSupportedWorkspace"] = (cwd) =>
    resolveWorkspace(cwd).pipe(Effect.map((workspace) => workspace !== null));

  const resolveRepositoryIdentity: SourceControlShape["resolveRepositoryIdentity"] = (cwd) =>
    resolveWorkspace(cwd).pipe(Effect.map((workspace) => workspace?.repositoryIdentity ?? null));

  return SourceControl.of({
    resolveWorkspace,
    isSupportedWorkspace,
    resolveRepositoryIdentity,
  });
});

export const SourceControlLive = Layer.effect(SourceControl, makeSourceControl).pipe(
  Layer.provideMerge(RepositoryIdentityResolverLive),
  Layer.provideMerge(VcsDriverRegistryLive),
);
