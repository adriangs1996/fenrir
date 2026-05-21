import { randomUUID } from "node:crypto";

import { Effect, Layer } from "effect";

import { GitHubCli } from "../../git/Services/GitHubCli.ts";
import { ReviewGitHubPendingDraftRepository } from "../../persistence/Services/ReviewGitHubDrafts.ts";
import { ReviewSessionRepository } from "../../persistence/Services/ReviewSessions.ts";
import { ReviewDiffService } from "../Services/ReviewDiffService.ts";
import { ReviewMutationService } from "../Services/ReviewMutationService.ts";
import { ReviewProvider } from "../Services/ReviewProvider.ts";
import { ReviewWriteService, makeReviewWriteService } from "../Services/ReviewWriteService.ts";

const makeLayer = Effect.gen(function* () {
  const sessions = yield* ReviewSessionRepository;
  const drafts = yield* ReviewGitHubPendingDraftRepository;
  const diff = yield* ReviewDiffService;
  const mutations = yield* ReviewMutationService;
  const provider = yield* ReviewProvider;
  const gitHubCli = yield* GitHubCli;

  return ReviewWriteService.of(
    makeReviewWriteService({
      sessions,
      drafts,
      diff,
      mutations,
      provider,
      gitHubCli,
      now: () => new Date().toISOString(),
      makeId: () => randomUUID(),
    }),
  );
});

export const ReviewWriteServiceLive = Layer.effect(ReviewWriteService, makeLayer);
