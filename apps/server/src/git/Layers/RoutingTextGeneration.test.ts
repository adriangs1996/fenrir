import {
  defaultInstanceIdForDriver,
  ProviderDriverKind,
  ProviderInstanceId,
} from "@fenrir/contracts";
import { it, assert } from "@effect/vitest";
import { Effect, Layer, Stream } from "effect";

import { ProviderInstanceRegistry } from "../../provider/Services/ProviderInstanceRegistry.ts";
import { TextGeneration, type TextGenerationShape } from "../Services/TextGeneration.ts";
import { RoutingTextGenerationLive } from "./RoutingTextGeneration.ts";

function makeTextGeneration(label: string): TextGenerationShape {
  return {
    generateCommitMessage: (input) =>
      Effect.succeed({
        subject: label,
        body: input.modelSelection.instanceId ?? "none",
      }),
    generatePrContent: (input) =>
      Effect.succeed({
        title: label,
        body: input.modelSelection.instanceId ?? "none",
      }),
    generateBranchName: () => Effect.succeed({ branch: label }),
    generateThreadTitle: () => Effect.succeed({ title: label }),
    extractDependencies: () => Effect.succeed({ dependencies: { [label]: [] } }),
  };
}

const unusedSnapshot = {
  getSnapshot: Effect.die("unused"),
  refresh: Effect.die("unused"),
  streamChanges: Stream.empty,
};

const codexDefaultId = defaultInstanceIdForDriver("codex");
const codexWorkId = ProviderInstanceId.make("codex_work");
const openCodeLocalId = ProviderInstanceId.make("opencode_local");

const routingLayer = it.layer(
  RoutingTextGenerationLive.pipe(
    Layer.provide(
      Layer.succeed(ProviderInstanceRegistry, {
        getInstance: (instanceId) =>
          Effect.succeed(
            [
              {
                provider: "codex" as const,
                driverKind: ProviderDriverKind.make("codex"),
                instanceId: codexDefaultId,
                snapshot: unusedSnapshot,
                textGeneration: makeTextGeneration("codex-default"),
              },
              {
                provider: "codex" as const,
                driverKind: ProviderDriverKind.make("codex"),
                instanceId: codexWorkId,
                displayName: "Codex Work",
                snapshot: unusedSnapshot,
                textGeneration: makeTextGeneration("codex-work"),
              },
              {
                provider: ProviderDriverKind.make("opencode"),
                driverKind: ProviderDriverKind.make("opencode"),
                instanceId: openCodeLocalId,
                snapshot: unusedSnapshot,
                textGeneration: makeTextGeneration("opencode-local"),
              },
            ].find((instance) => instance.instanceId === instanceId),
          ),
        listInstances: Effect.succeed([]),
        listUnavailable: Effect.succeed([]),
        streamChanges: Stream.empty,
      }),
    ),
  ),
);

routingLayer("RoutingTextGenerationLive", (it) => {
  it.effect("routes legacy provider selections to the default instance", () =>
    Effect.gen(function* () {
      const textGeneration = yield* TextGeneration;
      const generated = yield* textGeneration.generateCommitMessage({
        cwd: "/repo",
        branch: "main",
        stagedSummary: "summary",
        stagedPatch: "patch",
        modelSelection: { provider: "codex", model: "gpt-5" },
      });

      assert.equal(generated.subject, "codex-default");
      assert.equal(generated.body, "none");
    }),
  );

  it.effect("routes explicit modelSelection.instanceId to that provider instance", () =>
    Effect.gen(function* () {
      const textGeneration = yield* TextGeneration;
      const generated = yield* textGeneration.generatePrContent({
        cwd: "/repo",
        baseBranch: "main",
        headBranch: "feature",
        commitSummary: "commits",
        diffSummary: "diff",
        diffPatch: "patch",
        modelSelection: {
          provider: "codex",
          instanceId: codexWorkId,
          model: "gpt-5",
        },
      });

      assert.equal(generated.title, "codex-work");
      assert.equal(generated.body, codexWorkId);
    }),
  );

  it.effect("routes external provider slugs as instance ids for compatibility", () =>
    Effect.gen(function* () {
      const textGeneration = yield* TextGeneration;
      const generated = yield* textGeneration.generateThreadTitle({
        cwd: "/repo",
        message: "name this thread",
        modelSelection: {
          provider: openCodeLocalId,
          model: "openai/gpt-5",
        },
      });

      assert.equal(generated.title, "opencode-local");
    }),
  );

  it.effect("fails with TextGenerationError when the selected instance is unknown", () =>
    Effect.gen(function* () {
      const textGeneration = yield* TextGeneration;
      const result = yield* textGeneration
        .generateBranchName({
          cwd: "/repo",
          message: "make a branch",
          modelSelection: {
            provider: "missing_provider",
            model: "gpt-5",
          },
        })
        .pipe(Effect.result);

      assert.equal(result._tag, "Failure");
      if (result._tag === "Failure") {
        assert.equal(result.failure._tag, "TextGenerationError");
        assert.match(result.failure.detail, /missing_provider/);
      }
    }),
  );
});
