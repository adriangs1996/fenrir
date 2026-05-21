import { IsoDateTime, TrimmedNonEmptyString } from "@fenrir/contracts";
import { Option, Schema, ServiceMap } from "effect";
import type { Effect } from "effect";

import type { ProjectionRepositoryError } from "../Errors.ts";
import {
  ReviewChunkId,
  ReviewFileId,
  ReviewGroupId,
  ReviewLocalNoteAuthorSnapshot,
  ReviewSessionId,
  ReviewStableAnchor,
} from "../../../../../packages/contracts/src/review.ts";

export const ReviewAnnotationKind = Schema.Literals(["thread", "reply", "overview-note"]);
export type ReviewAnnotationKind = typeof ReviewAnnotationKind.Type;

export const ReviewAnnotationTargetKind = Schema.Literals(["chunk", "file", "group", "overview"]);
export type ReviewAnnotationTargetKind = typeof ReviewAnnotationTargetKind.Type;

export const ReviewAnnotationId = TrimmedNonEmptyString;
export type ReviewAnnotationId = typeof ReviewAnnotationId.Type;

export const ReviewAnnotationRecord = Schema.Struct({
  annotationId: ReviewAnnotationId,
  sessionId: ReviewSessionId,
  annotationKind: ReviewAnnotationKind,
  parentAnnotationId: Schema.NullOr(ReviewAnnotationId),
  targetKind: ReviewAnnotationTargetKind,
  targetId: Schema.NullOr(TrimmedNonEmptyString),
  groupId: Schema.NullOr(ReviewGroupId),
  fileId: Schema.NullOr(ReviewFileId),
  chunkId: Schema.NullOr(ReviewChunkId),
  anchor: Schema.NullOr(ReviewStableAnchor),
  source: Schema.Literal("local"),
  title: Schema.NullOr(TrimmedNonEmptyString),
  body: TrimmedNonEmptyString,
  author: ReviewLocalNoteAuthorSnapshot,
  isResolved: Schema.Boolean,
  isReopened: Schema.Boolean,
  isOutdated: Schema.Boolean,
  isSuggestedResolved: Schema.Boolean,
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
});
export type ReviewAnnotationRecord = typeof ReviewAnnotationRecord.Type;

export const GetReviewAnnotationInput = Schema.Struct({
  annotationId: ReviewAnnotationId,
});
export type GetReviewAnnotationInput = typeof GetReviewAnnotationInput.Type;

export const DeleteReviewAnnotationInput = GetReviewAnnotationInput;
export type DeleteReviewAnnotationInput = typeof DeleteReviewAnnotationInput.Type;

export const ListReviewAnnotationsInput = Schema.Struct({
  sessionId: ReviewSessionId,
});
export type ListReviewAnnotationsInput = typeof ListReviewAnnotationsInput.Type;

export interface ReviewAnnotationRepositoryShape {
  readonly upsert: (
    annotation: ReviewAnnotationRecord,
  ) => Effect.Effect<void, ProjectionRepositoryError>;
  readonly getById: (
    input: GetReviewAnnotationInput,
  ) => Effect.Effect<Option.Option<ReviewAnnotationRecord>, ProjectionRepositoryError>;
  readonly listBySessionId: (
    input: ListReviewAnnotationsInput,
  ) => Effect.Effect<ReadonlyArray<ReviewAnnotationRecord>, ProjectionRepositoryError>;
  readonly deleteById: (
    input: DeleteReviewAnnotationInput,
  ) => Effect.Effect<void, ProjectionRepositoryError>;
}

export class ReviewAnnotationRepository extends ServiceMap.Service<
  ReviewAnnotationRepository,
  ReviewAnnotationRepositoryShape
>()("t3/persistence/Services/ReviewAnnotations/ReviewAnnotationRepository") {}
