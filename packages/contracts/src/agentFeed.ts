import { Schema } from "effect";

import { ApprovalRequestId, IsoDateTime, TrimmedNonEmptyString } from "./baseSchemas";

/**
 * D-042 agent approval feed contracts.
 *
 * Approval requests are discrete, structured decisions reported by
 * provisioned agent hooks (D-039). Payloads carry only the structured
 * request the hook provides (tool/action summary, options); they must never
 * include broader terminal content. The feed is an accelerator, never a
 * gate: hooks soft-wait (<= 120s) for a decision and fall back to the
 * agent's own TUI on timeout.
 */

export const APPROVAL_SUMMARY_MAX_CHARS = 512;
export const APPROVAL_OPTION_LABEL_MAX_CHARS = 64;
export const APPROVAL_MAX_OPTIONS = 8;

/** Hard ceiling for the hook soft-wait (D-042: target <= 120s). */
export const APPROVAL_TIMEOUT_MAX_MS = 120_000;
/** Default hook soft-wait when the request does not specify one. */
export const APPROVAL_TIMEOUT_DEFAULT_MS = 110_000;
export const APPROVAL_TIMEOUT_MIN_MS = 1_000;

export const ApprovalRequestKind = Schema.Literals(["permission", "planExit", "question"]);
export type ApprovalRequestKind = typeof ApprovalRequestKind.Type;

export const ApprovalOption = Schema.Struct({
  id: TrimmedNonEmptyString,
  label: TrimmedNonEmptyString.check(Schema.isMaxLength(APPROVAL_OPTION_LABEL_MAX_CHARS)),
});
export type ApprovalOption = typeof ApprovalOption.Type;

export const ApprovalRequest = Schema.Struct({
  id: ApprovalRequestId,
  workspaceId: TrimmedNonEmptyString,
  paneId: Schema.NullOr(TrimmedNonEmptyString),
  agentId: TrimmedNonEmptyString,
  kind: ApprovalRequestKind,
  summary: Schema.String.check(Schema.isMaxLength(APPROVAL_SUMMARY_MAX_CHARS)),
  options: Schema.Array(ApprovalOption).check(Schema.isMaxLength(APPROVAL_MAX_OPTIONS)),
  createdAt: IsoDateTime,
  expiresAt: IsoDateTime,
});
export type ApprovalRequest = typeof ApprovalRequest.Type;

/** Input a hook (or the smoke injector) submits to register a request. */
export const ApprovalSubmitInput = Schema.Struct({
  workspaceId: TrimmedNonEmptyString,
  paneId: Schema.optional(Schema.NullOr(TrimmedNonEmptyString)),
  agentId: TrimmedNonEmptyString,
  kind: ApprovalRequestKind,
  summary: Schema.String.check(Schema.isMaxLength(APPROVAL_SUMMARY_MAX_CHARS)),
  options: Schema.Array(ApprovalOption).check(Schema.isMaxLength(APPROVAL_MAX_OPTIONS)),
  timeoutMs: Schema.optional(Schema.Int),
});
export type ApprovalSubmitInput = typeof ApprovalSubmitInput.Type;

/** Client decision: exactly one decision per request id. */
export const ApprovalDecideInput = Schema.Struct({
  requestId: ApprovalRequestId,
  optionId: TrimmedNonEmptyString,
});
export type ApprovalDecideInput = typeof ApprovalDecideInput.Type;

export const ApprovalDecision = Schema.Struct({
  requestId: ApprovalRequestId,
  optionId: TrimmedNonEmptyString,
});
export type ApprovalDecision = typeof ApprovalDecision.Type;

export const ApprovalSettledReason = Schema.Literals(["decided", "timeout"]);
export type ApprovalSettledReason = typeof ApprovalSettledReason.Type;

const ApprovalFeedPendingEvent = Schema.Struct({
  type: Schema.Literal("pending"),
  workspaceId: TrimmedNonEmptyString,
  request: ApprovalRequest,
});
export type ApprovalFeedPendingEvent = typeof ApprovalFeedPendingEvent.Type;

const ApprovalFeedSettledEvent = Schema.Struct({
  type: Schema.Literal("settled"),
  workspaceId: TrimmedNonEmptyString,
  requestId: ApprovalRequestId,
  reason: ApprovalSettledReason,
  optionId: Schema.NullOr(TrimmedNonEmptyString),
  settledAt: IsoDateTime,
});
export type ApprovalFeedSettledEvent = typeof ApprovalFeedSettledEvent.Type;

export const ApprovalFeedEvent = Schema.Union([ApprovalFeedPendingEvent, ApprovalFeedSettledEvent]);
export type ApprovalFeedEvent = typeof ApprovalFeedEvent.Type;

export const ApprovalFeedSubscribeInput = Schema.Struct({
  workspaceId: Schema.optional(TrimmedNonEmptyString),
});
export type ApprovalFeedSubscribeInput = typeof ApprovalFeedSubscribeInput.Type;

/**
 * Typed rejection for decide: late (`not-found` after settlement eviction,
 * `expired` right after timeout) and duplicate (`already-decided`) decisions
 * are rejected so exactly one decision wins per request id.
 */
export class ApprovalDecideError extends Schema.TaggedErrorClass<ApprovalDecideError>()(
  "ApprovalDecideError",
  {
    code: Schema.Literals(["not-found", "already-decided", "expired", "invalid-option"]),
    message: Schema.String,
  },
) {}
