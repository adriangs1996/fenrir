import { IsoDateTime, TrimmedNonEmptyString } from "@fenrir/contracts";
import { Schema, ServiceMap } from "effect";
import type { Effect } from "effect";

import type { ProjectionRepositoryError } from "../Errors.ts";
import {
  ReviewIgnoreRule,
  ReviewIgnoreRuleKind,
} from "../../../../../packages/contracts/src/review.ts";

export const ReviewIgnoreRuleRecord = ReviewIgnoreRule;
export type ReviewIgnoreRuleRecord = typeof ReviewIgnoreRuleRecord.Type;

export const NormalizeReviewIgnoreRuleInput = Schema.Struct({
  checkoutPath: TrimmedNonEmptyString,
  rulePath: TrimmedNonEmptyString,
  ruleKind: ReviewIgnoreRuleKind,
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
});
export type NormalizeReviewIgnoreRuleInput = typeof NormalizeReviewIgnoreRuleInput.Type;

export const ListReviewIgnoreRulesInput = Schema.Struct({
  checkoutPath: TrimmedNonEmptyString,
});
export type ListReviewIgnoreRulesInput = typeof ListReviewIgnoreRulesInput.Type;

export const DeleteReviewIgnoreRuleInput = Schema.Struct({
  checkoutPath: TrimmedNonEmptyString,
  ruleKind: ReviewIgnoreRuleKind,
  normalizedPath: TrimmedNonEmptyString,
});
export type DeleteReviewIgnoreRuleInput = typeof DeleteReviewIgnoreRuleInput.Type;

export interface ReviewIgnoreRuleRepositoryShape {
  readonly upsertNormalized: (
    input: NormalizeReviewIgnoreRuleInput,
  ) => Effect.Effect<ReviewIgnoreRuleRecord, ProjectionRepositoryError>;
  readonly listByCheckoutPath: (
    input: ListReviewIgnoreRulesInput,
  ) => Effect.Effect<ReadonlyArray<ReviewIgnoreRuleRecord>, ProjectionRepositoryError>;
  readonly delete: (
    input: DeleteReviewIgnoreRuleInput,
  ) => Effect.Effect<void, ProjectionRepositoryError>;
}

export class ReviewIgnoreRuleRepository extends ServiceMap.Service<
  ReviewIgnoreRuleRepository,
  ReviewIgnoreRuleRepositoryShape
>()("t3/persistence/Services/ReviewIgnoreRules/ReviewIgnoreRuleRepository") {}
