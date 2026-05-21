import { AuthSessionId, IsoDateTime } from "@fenrir/contracts";
import { Option, Schema, ServiceMap } from "effect";
import type { Effect } from "effect";

import type { ProjectionRepositoryError } from "../Errors.ts";
import {
  GitHubReviewDraftId,
  ReviewGitHubPendingDraft,
  ReviewSessionId,
} from "../../../../../packages/contracts/src/review.ts";

export const ReviewGitHubPendingDraftRecord = ReviewGitHubPendingDraft;
export type ReviewGitHubPendingDraftRecord = typeof ReviewGitHubPendingDraftRecord.Type;

export const GetReviewGitHubPendingDraftInput = Schema.Struct({
  draftId: GitHubReviewDraftId,
});
export type GetReviewGitHubPendingDraftInput = typeof GetReviewGitHubPendingDraftInput.Type;

export const ListReviewGitHubPendingDraftsInput = Schema.Struct({
  sessionId: ReviewSessionId,
  authSessionId: AuthSessionId,
});
export type ListReviewGitHubPendingDraftsInput = typeof ListReviewGitHubPendingDraftsInput.Type;

export const DeleteReviewGitHubPendingDraftInput = GetReviewGitHubPendingDraftInput;
export type DeleteReviewGitHubPendingDraftInput = typeof DeleteReviewGitHubPendingDraftInput.Type;

export const DeleteReviewGitHubPendingDraftsForViewerInput = Schema.Struct({
  sessionId: ReviewSessionId,
  authSessionId: AuthSessionId,
});
export type DeleteReviewGitHubPendingDraftsForViewerInput =
  typeof DeleteReviewGitHubPendingDraftsForViewerInput.Type;

export const DeleteReviewGitHubPendingDraftsForSessionInput = Schema.Struct({
  sessionId: ReviewSessionId,
});
export type DeleteReviewGitHubPendingDraftsForSessionInput =
  typeof DeleteReviewGitHubPendingDraftsForSessionInput.Type;

export const TouchReviewGitHubPendingDraftsOutdatedInput = Schema.Struct({
  sessionId: ReviewSessionId,
  markedOutdatedAt: IsoDateTime,
});
export type TouchReviewGitHubPendingDraftsOutdatedInput =
  typeof TouchReviewGitHubPendingDraftsOutdatedInput.Type;

export interface ReviewGitHubPendingDraftRepositoryShape {
  readonly upsert: (
    draft: ReviewGitHubPendingDraftRecord,
  ) => Effect.Effect<void, ProjectionRepositoryError>;
  readonly getById: (
    input: GetReviewGitHubPendingDraftInput,
  ) => Effect.Effect<Option.Option<ReviewGitHubPendingDraftRecord>, ProjectionRepositoryError>;
  readonly listForViewer: (
    input: ListReviewGitHubPendingDraftsInput,
  ) => Effect.Effect<ReadonlyArray<ReviewGitHubPendingDraftRecord>, ProjectionRepositoryError>;
  readonly deleteById: (
    input: DeleteReviewGitHubPendingDraftInput,
  ) => Effect.Effect<void, ProjectionRepositoryError>;
  readonly deleteForViewer: (
    input: DeleteReviewGitHubPendingDraftsForViewerInput,
  ) => Effect.Effect<void, ProjectionRepositoryError>;
  readonly deleteForSession: (
    input: DeleteReviewGitHubPendingDraftsForSessionInput,
  ) => Effect.Effect<void, ProjectionRepositoryError>;
  readonly markSessionDraftsOutdated: (
    input: TouchReviewGitHubPendingDraftsOutdatedInput,
  ) => Effect.Effect<void, ProjectionRepositoryError>;
}

export class ReviewGitHubPendingDraftRepository extends ServiceMap.Service<
  ReviewGitHubPendingDraftRepository,
  ReviewGitHubPendingDraftRepositoryShape
>()("t3/persistence/Services/ReviewGitHubDrafts/ReviewGitHubPendingDraftRepository") {}
