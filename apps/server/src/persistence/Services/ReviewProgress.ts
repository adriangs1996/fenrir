import { IsoDateTime, TrimmedNonEmptyString } from "@fenrir/contracts";
import { Option, Schema, ServiceMap } from "effect";
import type { Effect } from "effect";

import type { ProjectionRepositoryError } from "../Errors.ts";
import {
  ReviewLocalNoteAuthorSnapshot,
  ReviewProgressState,
  ReviewSessionId,
} from "../../../../../packages/contracts/src/review.ts";

export const ReviewProgressTargetKind = Schema.Literals([
  "group",
  "file",
  "chunk",
  "thread",
  "overview-note",
]);
export type ReviewProgressTargetKind = typeof ReviewProgressTargetKind.Type;

export const ReviewProgressRecord = Schema.Struct({
  sessionId: ReviewSessionId,
  targetKind: ReviewProgressTargetKind,
  targetId: TrimmedNonEmptyString,
  progressState: ReviewProgressState,
  author: ReviewLocalNoteAuthorSnapshot,
  lastUpdatedAt: IsoDateTime,
});
export type ReviewProgressRecord = typeof ReviewProgressRecord.Type;

export const GetReviewProgressInput = Schema.Struct({
  sessionId: ReviewSessionId,
  targetKind: ReviewProgressTargetKind,
  targetId: TrimmedNonEmptyString,
});
export type GetReviewProgressInput = typeof GetReviewProgressInput.Type;

export const DeleteReviewProgressInput = GetReviewProgressInput;
export type DeleteReviewProgressInput = typeof DeleteReviewProgressInput.Type;

export const ListReviewProgressInput = Schema.Struct({
  sessionId: ReviewSessionId,
});
export type ListReviewProgressInput = typeof ListReviewProgressInput.Type;

export interface ReviewProgressRepositoryShape {
  readonly upsert: (
    progress: ReviewProgressRecord,
  ) => Effect.Effect<void, ProjectionRepositoryError>;
  readonly getByTarget: (
    input: GetReviewProgressInput,
  ) => Effect.Effect<Option.Option<ReviewProgressRecord>, ProjectionRepositoryError>;
  readonly listBySessionId: (
    input: ListReviewProgressInput,
  ) => Effect.Effect<ReadonlyArray<ReviewProgressRecord>, ProjectionRepositoryError>;
  readonly deleteByTarget: (
    input: DeleteReviewProgressInput,
  ) => Effect.Effect<void, ProjectionRepositoryError>;
}

export class ReviewProgressRepository extends ServiceMap.Service<
  ReviewProgressRepository,
  ReviewProgressRepositoryShape
>()("t3/persistence/Services/ReviewProgress/ReviewProgressRepository") {}
