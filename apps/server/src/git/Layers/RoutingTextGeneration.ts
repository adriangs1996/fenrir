/**
 * RoutingTextGeneration - dispatches Git text generation through configured
 * provider instances.
 *
 * The selection's explicit `instanceId` wins. Legacy selections that only have
 * `provider` route to that provider's default instance id.
 *
 * @module RoutingTextGeneration
 */
import {
  defaultInstanceIdForDriver,
  type ModelSelection,
  type ProviderInstanceId,
  TextGenerationError,
} from "@fenrir/contracts";
import { Effect, Layer } from "effect";

import { ProviderInstanceRegistry } from "../../provider/Services/ProviderInstanceRegistry.ts";
import { TextGeneration, type TextGenerationShape } from "../Services/TextGeneration.ts";

type TextGenerationOperation =
  | "generateCommitMessage"
  | "generatePrContent"
  | "generateBranchName"
  | "generateThreadTitle"
  | "extractDependencies";

function resolveModelSelectionInstanceId(selection: ModelSelection): ProviderInstanceId {
  return selection.instanceId ?? defaultInstanceIdForDriver(selection.provider);
}

const makeRoutingTextGeneration = Effect.gen(function* () {
  const registry = yield* ProviderInstanceRegistry;

  const resolveTextGeneration = (
    operation: TextGenerationOperation,
    modelSelection: ModelSelection,
  ) =>
    registry.getInstance(resolveModelSelectionInstanceId(modelSelection)).pipe(
      Effect.flatMap((instance) =>
        instance
          ? Effect.succeed(instance.textGeneration)
          : Effect.fail(
              new TextGenerationError({
                operation,
                detail: `No provider instance registered for id '${resolveModelSelectionInstanceId(
                  modelSelection,
                )}'.`,
              }),
            ),
      ),
    );

  return {
    generateCommitMessage: (input) =>
      resolveTextGeneration("generateCommitMessage", input.modelSelection).pipe(
        Effect.flatMap((textGeneration) => textGeneration.generateCommitMessage(input)),
      ),
    generatePrContent: (input) =>
      resolveTextGeneration("generatePrContent", input.modelSelection).pipe(
        Effect.flatMap((textGeneration) => textGeneration.generatePrContent(input)),
      ),
    generateBranchName: (input) =>
      resolveTextGeneration("generateBranchName", input.modelSelection).pipe(
        Effect.flatMap((textGeneration) => textGeneration.generateBranchName(input)),
      ),
    generateThreadTitle: (input) =>
      resolveTextGeneration("generateThreadTitle", input.modelSelection).pipe(
        Effect.flatMap((textGeneration) => textGeneration.generateThreadTitle(input)),
      ),
    extractDependencies: (input) =>
      resolveTextGeneration("extractDependencies", input.modelSelection).pipe(
        Effect.flatMap((textGeneration) => textGeneration.extractDependencies(input)),
      ),
  } satisfies TextGenerationShape;
});

export const RoutingTextGenerationLive = Layer.effect(TextGeneration, makeRoutingTextGeneration);
