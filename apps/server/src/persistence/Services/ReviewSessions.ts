import {
  IsoDateTime,
  PositiveInt,
  ProjectId,
  ThreadId,
  TrimmedNonEmptyString,
} from "@fenrir/contracts";
import { Option, Schema, Context } from "effect";
import type { Effect } from "effect";

import type { ProjectionRepositoryError } from "../Errors.ts";
import {
  ReviewArtifactProviderKind,
  ReviewSessionId,
  ReviewScope,
  ReviewSessionTarget,
  ReviewTabMode,
} from "@fenrir/contracts/sourceControlReview";

export const ReviewSessionRecord = Schema.Struct({
  sessionId: ReviewSessionId,
  threadId: ThreadId,
  projectId: Schema.NullOr(ProjectId),
  checkoutPath: TrimmedNonEmptyString,
  mode: ReviewTabMode,
  scope: ReviewScope,
  target: ReviewSessionTarget,
  pullRequestOverrideProvider: Schema.NullOr(ReviewArtifactProviderKind),
  pullRequestOverrideNumber: Schema.NullOr(PositiveInt),
  pullRequestOverrideUrl: Schema.NullOr(Schema.String),
  pullRequestProvider: Schema.NullOr(ReviewArtifactProviderKind),
  pullRequestNumber: Schema.NullOr(PositiveInt),
  pullRequestUrl: Schema.NullOr(Schema.String),
  baseBranchOverride: Schema.NullOr(TrimmedNonEmptyString),
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
  lastActivatedAt: IsoDateTime,
  archivedAt: Schema.NullOr(IsoDateTime),
});
export type ReviewSessionRecord = typeof ReviewSessionRecord.Type;

export const GetReviewSessionInput = Schema.Struct({
  sessionId: ReviewSessionId,
});
export type GetReviewSessionInput = typeof GetReviewSessionInput.Type;

export const FindActiveReviewSessionInput = Schema.Struct({
  threadId: ThreadId,
  checkoutPath: TrimmedNonEmptyString,
});
export type FindActiveReviewSessionInput = typeof FindActiveReviewSessionInput.Type;

export const ListReviewSessionsByThreadInput = Schema.Struct({
  threadId: ThreadId,
  includeArchived: Schema.optional(Schema.Boolean),
});
export type ListReviewSessionsByThreadInput = typeof ListReviewSessionsByThreadInput.Type;

export const ArchiveReviewSessionInput = Schema.Struct({
  sessionId: ReviewSessionId,
  archivedAt: IsoDateTime,
  updatedAt: IsoDateTime,
});
export type ArchiveReviewSessionInput = typeof ArchiveReviewSessionInput.Type;

export interface ReviewSessionRepositoryShape {
  readonly upsert: (session: ReviewSessionRecord) => Effect.Effect<void, ProjectionRepositoryError>;
  readonly getById: (
    input: GetReviewSessionInput,
  ) => Effect.Effect<Option.Option<ReviewSessionRecord>, ProjectionRepositoryError>;
  readonly findActiveByThread: (
    input: FindActiveReviewSessionInput,
  ) => Effect.Effect<Option.Option<ReviewSessionRecord>, ProjectionRepositoryError>;
  readonly listByThreadId: (
    input: ListReviewSessionsByThreadInput,
  ) => Effect.Effect<ReadonlyArray<ReviewSessionRecord>, ProjectionRepositoryError>;
  readonly archive: (
    input: ArchiveReviewSessionInput,
  ) => Effect.Effect<void, ProjectionRepositoryError>;
}

export class ReviewSessionRepository extends Context.Service<
  ReviewSessionRepository,
  ReviewSessionRepositoryShape
>()("t3/persistence/Services/ReviewSessions/ReviewSessionRepository") {}
