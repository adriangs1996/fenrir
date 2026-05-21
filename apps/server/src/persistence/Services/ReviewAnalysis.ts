import { IsoDateTime, TrimmedNonEmptyString } from "@fenrir/contracts";
import { Option, Schema, ServiceMap } from "effect";
import type { Effect } from "effect";

import type { ProjectionRepositoryError } from "../Errors.ts";
import {
  ReviewAnalysisArtifact,
  ReviewSessionId,
} from "../../../../../packages/contracts/src/review.ts";

export const ReviewAnalysisRecord = Schema.Struct({
  sessionId: ReviewSessionId,
  artifact: ReviewAnalysisArtifact,
  analysisPayload: Schema.Unknown,
  generatedAt: IsoDateTime,
  staleMarkerInputs: Schema.NullOr(Schema.Unknown),
  staleReasonFlags: Schema.Array(TrimmedNonEmptyString),
  updatedAt: IsoDateTime,
});
export type ReviewAnalysisRecord = typeof ReviewAnalysisRecord.Type;

export const GetReviewAnalysisInput = Schema.Struct({
  sessionId: ReviewSessionId,
});
export type GetReviewAnalysisInput = typeof GetReviewAnalysisInput.Type;

export const DeleteReviewAnalysisInput = GetReviewAnalysisInput;
export type DeleteReviewAnalysisInput = typeof DeleteReviewAnalysisInput.Type;

export interface ReviewAnalysisRepositoryShape {
  readonly upsertLatest: (
    analysis: ReviewAnalysisRecord,
  ) => Effect.Effect<void, ProjectionRepositoryError>;
  readonly getBySessionId: (
    input: GetReviewAnalysisInput,
  ) => Effect.Effect<Option.Option<ReviewAnalysisRecord>, ProjectionRepositoryError>;
  readonly deleteBySessionId: (
    input: DeleteReviewAnalysisInput,
  ) => Effect.Effect<void, ProjectionRepositoryError>;
}

export class ReviewAnalysisRepository extends ServiceMap.Service<
  ReviewAnalysisRepository,
  ReviewAnalysisRepositoryShape
>()("t3/persistence/Services/ReviewAnalysis/ReviewAnalysisRepository") {}
