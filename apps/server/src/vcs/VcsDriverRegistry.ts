import * as Cache from "effect/Cache";
import { Effect, Layer, Context, Duration, Exit } from "effect";

import { VcsUnsupportedOperationError, type VcsDriverKind, type VcsError } from "@fenrir/contracts";
import { GitVcsDriver, GitVcsDriverLive } from "./GitVcsDriver.ts";
import type { VcsDriverShape, VcsRepositoryIdentity } from "./VcsDriver.ts";
import { VcsProjectConfig, layer as VcsProjectConfigLive } from "./VcsProjectConfig.ts";

const DETECTION_CACHE_CAPACITY = 2_048;
const DETECTION_CACHE_TTL = Duration.seconds(2);

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
  readonly get: (kind: VcsDriverKind) => Effect.Effect<VcsDriverShape, VcsError>;
  readonly detect: (
    input: VcsDriverResolveInput,
  ) => Effect.Effect<VcsDriverHandle | null, VcsError>;
  readonly resolve: (input: VcsDriverResolveInput) => Effect.Effect<VcsDriverHandle, VcsError>;
}

export class VcsDriverRegistry extends Context.Service<VcsDriverRegistry, VcsDriverRegistryShape>()(
  "fenrir/vcs/Services/VcsDriverRegistry",
) {}

const unsupported = (operation: string, kind: VcsDriverKind, detail: string) =>
  new VcsUnsupportedOperationError({
    operation,
    kind,
    detail,
  });

const makeVcsDriverRegistry = Effect.gen(function* () {
  const projectConfig = yield* VcsProjectConfig;
  const git = yield* GitVcsDriver;
  const drivers: Partial<Record<VcsDriverKind, VcsDriverShape>> = {
    git,
  };

  const get: VcsDriverRegistryShape["get"] = (kind) => {
    const driver = drivers[kind];
    if (!driver) {
      return Effect.fail(
        unsupported("VcsDriverRegistry.get", kind, `No ${kind} VCS driver is registered.`),
      );
    }
    return Effect.succeed(driver);
  };

  const detectWithDriver = Effect.fn("VcsDriverRegistry.detectWithDriver")(function* (
    kind: VcsDriverKind,
    driver: VcsDriverShape,
    cwd: string,
  ) {
    const repository = yield* driver.detectRepository(cwd);
    if (!repository) {
      return null;
    }

    return {
      kind,
      repository,
      driver,
    } satisfies VcsDriverHandle;
  });

  const detectResolvedKind = Effect.fn("VcsDriverRegistry.detectResolvedKind")(function* (input: {
    readonly cwd: string;
    readonly requestedKind: VcsDriverKind | "auto";
  }) {
    const requestedKind = input.requestedKind;

    if (requestedKind !== "auto" && requestedKind !== "unknown") {
      const driver = yield* get(requestedKind);
      return yield* detectWithDriver(requestedKind, driver, input.cwd);
    }

    return yield* detectWithDriver("git", git, input.cwd);
  });

  const detectionCache = yield* Cache.makeWith<string, VcsDriverHandle | null, VcsError>(
    (key) => detectResolvedKind(parseDetectionCacheKey(key)),
    {
      capacity: DETECTION_CACHE_CAPACITY,
      timeToLive: (exit) => (Exit.isSuccess(exit) ? DETECTION_CACHE_TTL : Duration.zero),
    },
  );

  const detect: VcsDriverRegistryShape["detect"] = Effect.fn("VcsDriverRegistry.detect")(
    function* (input) {
      const requestedKind = yield* projectConfig.resolveKind(input);
      return yield* Cache.get(detectionCache, detectionCacheKey({ cwd: input.cwd, requestedKind }));
    },
  );

  const resolve: VcsDriverRegistryShape["resolve"] = Effect.fn("VcsDriverRegistry.resolve")(
    function* (input) {
      const detected = yield* detect(input);
      if (detected) {
        return detected;
      }

      const requestedKind = input.requestedKind ?? "auto";
      return yield* unsupported(
        "VcsDriverRegistry.resolve",
        requestedKind === "auto" ? "unknown" : requestedKind,
        requestedKind === "auto"
          ? `No supported VCS repository was detected at ${input.cwd}.`
          : `No ${requestedKind} repository was detected at ${input.cwd}.`,
      );
    },
  );

  return VcsDriverRegistry.of({
    get,
    detect,
    resolve,
  });
});

function detectionCacheKey(input: {
  readonly cwd: string;
  readonly requestedKind: VcsDriverKind | "auto";
}): string {
  return `${input.requestedKind}\0${input.cwd}`;
}

function parseDetectionCacheKey(key: string): {
  readonly cwd: string;
  readonly requestedKind: VcsDriverKind | "auto";
} {
  const separatorIndex = key.indexOf("\0");
  if (separatorIndex === -1) {
    return {
      cwd: key,
      requestedKind: "auto",
    };
  }
  return {
    requestedKind: key.slice(0, separatorIndex) as VcsDriverKind | "auto",
    cwd: key.slice(separatorIndex + 1),
  };
}

export const VcsDriverRegistryLive = Layer.effect(VcsDriverRegistry, makeVcsDriverRegistry).pipe(
  Layer.provide(GitVcsDriverLive),
  Layer.provide(VcsProjectConfigLive),
);
