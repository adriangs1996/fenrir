import { Effect, Layer } from "effect";

import { GitCore } from "../../git/Services/GitCore.ts";
import { GitStatusBroadcaster } from "../../git/Services/GitStatusBroadcaster.ts";
import { ReviewIgnoreRuleRepository } from "../../persistence/Services/ReviewIgnoreRules.ts";
import { ReviewDiffService, makeReviewDiffService } from "../Services/ReviewDiffService.ts";

const makeLayer = Effect.gen(function* () {
  const gitCore = yield* GitCore;
  const gitStatusBroadcaster = yield* GitStatusBroadcaster;
  const reviewIgnoreRules = yield* ReviewIgnoreRuleRepository;

  return ReviewDiffService.of(
    makeReviewDiffService({
      executeGit: (cwd, args, options) =>
        gitCore.execute({
          operation: "ReviewDiffService.executeGit",
          cwd,
          args,
          allowNonZeroExit: true,
          ...(options?.maxOutputBytes ? { maxOutputBytes: options.maxOutputBytes } : {}),
          truncateOutputAtMaxBytes: true,
        }),
      streamGitStatus: (cwd) => gitStatusBroadcaster.streamStatus({ cwd }),
      listReviewIgnoreRules: (checkoutPath) =>
        reviewIgnoreRules.listByCheckoutPath({
          checkoutPath,
        }),
    }),
  );
});

export const ReviewDiffServiceLive = Layer.effect(ReviewDiffService, makeLayer);
