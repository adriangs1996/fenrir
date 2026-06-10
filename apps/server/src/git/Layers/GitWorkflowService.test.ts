import { assert, describe, it, vi } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import { GitCore, type GitCoreShape } from "../Services/GitCore.ts";
import { GitManager, type GitManagerShape } from "../Services/GitManager.ts";
import { GitWorkflowService } from "../Services/GitWorkflowService.ts";
import { GitWorkflowServiceLive } from "./GitWorkflowService.ts";
import { VcsDriverRegistry, type VcsDriverRegistryShape } from "../../vcs/VcsDriverRegistry.ts";

function makeLayer(input: {
  readonly registry: Partial<VcsDriverRegistryShape>;
  readonly gitCore?: Partial<GitCoreShape>;
  readonly gitManager?: Partial<GitManagerShape>;
}) {
  return GitWorkflowServiceLive.pipe(
    Layer.provide(Layer.mock(VcsDriverRegistry)(input.registry)),
    Layer.provide(Layer.mock(GitCore)(input.gitCore ?? {})),
    Layer.provide(Layer.mock(GitManager)(input.gitManager ?? {})),
  );
}

describe("GitWorkflowService", () => {
  it.effect("returns an empty local status when no VCS repository is detected", () =>
    Effect.gen(function* () {
      const workflow = yield* GitWorkflowService;
      const status = yield* workflow.localStatus({ cwd: "/not-a-repo" });

      assert.deepStrictEqual(status, {
        isRepo: false,
        hasPrimaryRemote: false,
        isDefaultRef: false,
        refName: null,
        hasWorkingTreeChanges: false,
        workingTree: {
          files: [],
          insertions: 0,
          deletions: 0,
        },
      });
    }).pipe(
      Effect.provide(
        makeLayer({
          registry: {
            detect: () => Effect.succeed(null),
          },
        }),
      ),
    ),
  );

  it.effect("returns an empty full status when no VCS repository is detected", () =>
    Effect.gen(function* () {
      const workflow = yield* GitWorkflowService;
      const status = yield* workflow.status({ cwd: "/not-a-repo" });

      assert.deepStrictEqual(status, {
        isRepo: false,
        hasPrimaryRemote: false,
        isDefaultRef: false,
        refName: null,
        hasWorkingTreeChanges: false,
        workingTree: {
          files: [],
          insertions: 0,
          deletions: 0,
        },
        hasUpstream: false,
        aheadCount: 0,
        behindCount: 0,
        aheadOfDefaultCount: 0,
        pr: null,
      });
    }).pipe(
      Effect.provide(
        makeLayer({
          registry: {
            detect: () => Effect.succeed(null),
          },
        }),
      ),
    ),
  );

  it.effect("does not call GitManager status methods when no VCS repository is detected", () => {
    const localStatus = vi.fn();
    const remoteStatus = vi.fn();
    const status = vi.fn();

    return Effect.gen(function* () {
      const workflow = yield* GitWorkflowService;
      yield* workflow.localStatus({ cwd: "/not-a-repo" });
      yield* workflow.remoteStatus({ cwd: "/not-a-repo" });
      yield* workflow.status({ cwd: "/not-a-repo" });

      assert.equal(localStatus.mock.calls.length, 0);
      assert.equal(remoteStatus.mock.calls.length, 0);
      assert.equal(status.mock.calls.length, 0);
    }).pipe(
      Effect.provide(
        makeLayer({
          registry: {
            detect: () => Effect.succeed(null),
          },
          gitManager: {
            localStatus,
            remoteStatus,
            status,
          },
        }),
      ),
    );
  });

  it.effect("returns an empty ref list when no VCS repository is detected", () =>
    Effect.gen(function* () {
      const workflow = yield* GitWorkflowService;
      const refs = yield* workflow.listRefs({ cwd: "/not-a-repo" });

      assert.deepStrictEqual(refs, {
        refs: [],
        isRepo: false,
        hasPrimaryRemote: false,
        nextCursor: null,
        totalCount: 0,
      });
    }).pipe(
      Effect.provide(
        makeLayer({
          registry: {
            detect: () => Effect.succeed(null),
          },
        }),
      ),
    ),
  );
});
