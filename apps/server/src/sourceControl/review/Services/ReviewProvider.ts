import { IsoDateTime, PositiveInt } from "@fenrir/contracts";
import { Data, Schema, Context } from "effect";
import type { Effect } from "effect";

import {
  ReviewShortText,
  ReviewStableAnchor,
  ReviewText,
} from "@fenrir/contracts/sourceControlReview";

export const ReviewProviderKind = Schema.Literal("github");
export type ReviewProviderKind = typeof ReviewProviderKind.Type;

export const ReviewProviderPullRequest = Schema.Struct({
  provider: ReviewProviderKind,
  number: PositiveInt,
  url: Schema.String,
  baseRef: ReviewShortText,
  headRef: ReviewShortText,
});
export type ReviewProviderPullRequest = typeof ReviewProviderPullRequest.Type;

export const ReviewRemotePullRequestState = Schema.Literals(["open", "closed", "merged"]);
export type ReviewRemotePullRequestState = typeof ReviewRemotePullRequestState.Type;

export const ReviewRemoteReviewComment = Schema.Struct({
  id: ReviewShortText,
  url: Schema.optionalKey(Schema.String),
  body: ReviewText,
  path: ReviewShortText,
  anchor: ReviewStableAnchor,
  authorLogin: ReviewShortText,
  authorAvatarUrl: Schema.optionalKey(Schema.String),
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
});
export type ReviewRemoteReviewComment = typeof ReviewRemoteReviewComment.Type;

export const ReviewRemoteReviewThread = Schema.Struct({
  id: ReviewShortText,
  path: ReviewShortText,
  anchor: ReviewStableAnchor,
  isResolved: Schema.Boolean,
  isOutdated: Schema.Boolean,
  isCollapsed: Schema.Boolean,
  comments: Schema.Array(ReviewRemoteReviewComment),
});
export type ReviewRemoteReviewThread = typeof ReviewRemoteReviewThread.Type;

export const ReviewRemoteGeneralComment = Schema.Struct({
  id: ReviewShortText,
  url: Schema.optionalKey(Schema.String),
  body: ReviewText,
  authorLogin: ReviewShortText,
  authorAvatarUrl: Schema.optionalKey(Schema.String),
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
});
export type ReviewRemoteGeneralComment = typeof ReviewRemoteGeneralComment.Type;

export const ReviewProviderSnapshot = Schema.Struct({
  provider: ReviewProviderKind,
  pullRequest: Schema.Struct({
    number: PositiveInt,
    url: Schema.String,
    title: ReviewShortText,
    state: ReviewRemotePullRequestState,
    isDraft: Schema.Boolean,
    body: Schema.String,
    baseRef: ReviewShortText,
    headRef: ReviewShortText,
    authorLogin: Schema.optionalKey(ReviewShortText),
    authorAvatarUrl: Schema.optionalKey(Schema.String),
    createdAt: IsoDateTime,
    updatedAt: IsoDateTime,
  }),
  reviewThreads: Schema.Array(ReviewRemoteReviewThread),
  generalComments: Schema.Array(ReviewRemoteGeneralComment),
});
export type ReviewProviderSnapshot = typeof ReviewProviderSnapshot.Type;

export const ReviewProviderUnavailableReason = Schema.Literals([
  "no-pull-request",
  "provider-cli-missing",
  "provider-auth-missing",
  "provider-network-error",
  "provider-request-failed",
]);
export type ReviewProviderUnavailableReason = typeof ReviewProviderUnavailableReason.Type;

export interface ReviewProviderAvailableResult {
  readonly status: "available";
  readonly provider: ReviewProviderKind;
  readonly snapshot: ReviewProviderSnapshot;
}

export interface ReviewProviderUnavailableResult {
  readonly status: "unavailable";
  readonly provider: ReviewProviderKind;
  readonly reason: ReviewProviderUnavailableReason;
  readonly message: string;
  readonly pullRequest: ReviewProviderPullRequest | null;
}

export type ReviewProviderReadResult =
  | ReviewProviderAvailableResult
  | ReviewProviderUnavailableResult;

export class ReviewProviderError extends Data.TaggedError("ReviewProviderError")<{
  readonly operation: string;
  readonly provider: ReviewProviderKind;
  readonly message: string;
  readonly cause?: unknown;
}> {}

export interface ReviewProviderShape {
  readonly provider: ReviewProviderKind;
  readonly resolvePullRequestReference: (input: {
    readonly cwd: string;
    readonly reference: string;
  }) => Effect.Effect<ReviewProviderPullRequest, ReviewProviderError>;
  readonly readReview: (input: {
    readonly cwd: string;
    readonly pullRequest: ReviewProviderPullRequest | null;
  }) => Effect.Effect<ReviewProviderReadResult, never>;
}

export class ReviewProvider extends Context.Service<ReviewProvider, ReviewProviderShape>()(
  "t3/review/Services/ReviewProvider",
) {}
