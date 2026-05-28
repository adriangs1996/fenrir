import { Effect, Layer } from "effect";

import { ProjectionSnapshotQuery } from "../../../orchestration/Services/ProjectionSnapshotQuery.ts";
import { ReviewDiffService } from "../Services/ReviewDiffService.ts";
import { ReviewProvider } from "../Services/ReviewProvider.ts";
import {
  makeReviewAnalysisService,
  ReviewAnalysisService,
} from "../Services/ReviewAnalysisService.ts";

const makeLayer = Effect.gen(function* () {
  const projection = yield* ProjectionSnapshotQuery;
  const diff = yield* ReviewDiffService;
  const provider = yield* ReviewProvider;

  return ReviewAnalysisService.of(
    makeReviewAnalysisService({
      projection,
      diff,
      provider,
      now: () => new Date().toISOString(),
    }),
  );
});

export const ReviewAnalysisServiceLive = Layer.effect(ReviewAnalysisService, makeLayer);
