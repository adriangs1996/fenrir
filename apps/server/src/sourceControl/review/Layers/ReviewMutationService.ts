import { Effect, Layer, Option } from "effect";

import { GitCore } from "../../../git/Services/GitCore.ts";
import { ReviewIgnoreRuleRepository } from "../../../persistence/Services/ReviewIgnoreRules.ts";
import { ReviewSessionRepository } from "../../../persistence/Services/ReviewSessions.ts";
import { SourceControlStatus } from "../../Services/SourceControlStatus.ts";
import { ReviewDiffService } from "../Services/ReviewDiffService.ts";
import {
  ReviewMutationService,
  makeReviewMutationService,
} from "../Services/ReviewMutationService.ts";

const makeLayer = Effect.gen(function* () {
  const gitCore = yield* GitCore;
  const reviewDiffService = yield* ReviewDiffService;
  const reviewIgnoreRules = yield* ReviewIgnoreRuleRepository;
  const reviewSessions = yield* ReviewSessionRepository;
  const sourceControlStatus = yield* SourceControlStatus;

  return ReviewMutationService.of(
    makeReviewMutationService({
      getSession: (sessionId) =>
        reviewSessions
          .getById({ sessionId })
          .pipe(Effect.map((record) => (Option.isSome(record) ? record.value : null))),
      loadFilePatchArtifact: (input) => reviewDiffService.loadFilePatchArtifact(input),
      executeGitPatch: ({ cwd, args, patch }) =>
        gitCore
          .execute({
            operation: "ReviewMutationService.executeGitPatch",
            cwd,
            args,
            stdin: patch,
          })
          .pipe(Effect.asVoid),
      refreshGitStatus: (cwd) => sourceControlStatus.refreshStatus(cwd).pipe(Effect.asVoid),
      upsertIgnoreRule: (input) => reviewIgnoreRules.upsertNormalized(input),
      deleteIgnoreRule: (input) => reviewIgnoreRules.delete(input),
    }),
  );
});

export const ReviewMutationServiceLive = Layer.effect(ReviewMutationService, makeLayer);
