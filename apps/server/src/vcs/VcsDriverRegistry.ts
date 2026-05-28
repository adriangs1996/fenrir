import { Effect, Layer, Context } from "effect";

import { GitCommandError } from "@fenrir/contracts";
import { GitVcsDriver, GitVcsDriverLive } from "./GitVcsDriver.ts";
import type { VcsDriverKind, VcsDriverShape, VcsRepositoryIdentity } from "./VcsDriver.ts";

export interface VcsDriverResolveInput {
  readonly cwd: string;
  readonly requestedKind?: VcsDriverKind | "auto";
}

export interface VcsDriverHandle {
  readonly kind: VcsDriverKind;
  readonly repository: VcsRepositoryIdentity;
  readonly driver: VcsDriverShape;
}

export interface VcsDriverRegistryShape {
  readonly detect: (
    input: VcsDriverResolveInput,
  ) => Effect.Effect<VcsDriverHandle | null, GitCommandError>;
  readonly resolve: (
    input: VcsDriverResolveInput,
  ) => Effect.Effect<VcsDriverHandle, GitCommandError>;
}

export class VcsDriverRegistry extends Context.Service<VcsDriverRegistry, VcsDriverRegistryShape>()(
  "fenrir/vcs/Services/VcsDriverRegistry",
) {}

function registryError(operation: string, cwd: string, detail: string): GitCommandError {
  return new GitCommandError({
    operation,
    command: "vcs",
    cwd,
    detail,
  });
}

const makeVcsDriverRegistry = Effect.gen(function* () {
  const git = yield* GitVcsDriver;

  const detect: VcsDriverRegistryShape["detect"] = Effect.fn("VcsDriverRegistry.detect")(
    function* (input) {
      const requestedKind = input.requestedKind ?? "auto";
      if (requestedKind !== "auto" && requestedKind !== "git") {
        return null;
      }

      const repository = yield* git.detectRepository(input.cwd);
      if (!repository) {
        return null;
      }

      return {
        kind: "git",
        repository,
        driver: git,
      } satisfies VcsDriverHandle;
    },
  );

  const resolve: VcsDriverRegistryShape["resolve"] = Effect.fn("VcsDriverRegistry.resolve")(
    function* (input) {
      const detected = yield* detect(input);
      if (detected) {
        return detected;
      }

      return yield* registryError(
        "VcsDriverRegistry.resolve",
        input.cwd,
        "No supported VCS repository was detected.",
      );
    },
  );

  return VcsDriverRegistry.of({
    detect,
    resolve,
  });
});

export const VcsDriverRegistryLive = Layer.effect(VcsDriverRegistry, makeVcsDriverRegistry).pipe(
  Layer.provide(GitVcsDriverLive),
);
