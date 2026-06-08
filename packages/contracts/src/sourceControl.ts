import * as Schema from "effect/Schema";
import { PositiveInt, TrimmedNonEmptyString } from "./baseSchemas";
import { VcsDriverKind } from "./vcs";

export const SourceControlProviderKind = Schema.Literals([
  "github",
  "gitlab",
  "azure-devops",
  "bitbucket",
  "unknown",
]);
export type SourceControlProviderKind = typeof SourceControlProviderKind.Type;

export const SourceControlProviderInfo = Schema.Struct({
  kind: SourceControlProviderKind,
  name: TrimmedNonEmptyString,
  baseUrl: Schema.String,
});
export type SourceControlProviderInfo = typeof SourceControlProviderInfo.Type;

export const ChangeRequestState = Schema.Literals(["open", "closed", "merged"]);
export type ChangeRequestState = typeof ChangeRequestState.Type;

export const ChangeRequestLineSide = Schema.Literals(["additions", "deletions"]);
export type ChangeRequestLineSide = typeof ChangeRequestLineSide.Type;

export const ChangeRequestCheckStatus = Schema.Literals([
  "pending",
  "success",
  "failure",
  "cancelled",
  "skipped",
  "unknown",
]);
export type ChangeRequestCheckStatus = typeof ChangeRequestCheckStatus.Type;

export const ChangeRequest = Schema.Struct({
  provider: SourceControlProviderKind,
  number: PositiveInt,
  title: TrimmedNonEmptyString,
  url: Schema.String,
  baseRefName: TrimmedNonEmptyString,
  headRefName: TrimmedNonEmptyString,
  state: ChangeRequestState,
  updatedAt: Schema.Option(Schema.DateTimeUtc),
  isCrossRepository: Schema.optional(Schema.Boolean),
  headRepositoryNameWithOwner: Schema.optional(Schema.NullOr(TrimmedNonEmptyString)),
  headRepositoryOwnerLogin: Schema.optional(Schema.NullOr(TrimmedNonEmptyString)),
});
export type ChangeRequest = typeof ChangeRequest.Type;

export const ChangeRequestCheck = Schema.Struct({
  name: TrimmedNonEmptyString,
  status: ChangeRequestCheckStatus,
  url: Schema.optionalKey(Schema.String),
  description: Schema.optionalKey(Schema.String),
  startedAt: Schema.Option(Schema.DateTimeUtc),
  completedAt: Schema.Option(Schema.DateTimeUtc),
});
export type ChangeRequestCheck = typeof ChangeRequestCheck.Type;

export const ChangeRequestReviewCommentAuthor = Schema.Struct({
  login: TrimmedNonEmptyString,
  avatarUrl: Schema.optionalKey(Schema.String),
});
export type ChangeRequestReviewCommentAuthor = typeof ChangeRequestReviewCommentAuthor.Type;

export const ChangeRequestReviewComment = Schema.Struct({
  id: TrimmedNonEmptyString,
  body: Schema.String,
  author: ChangeRequestReviewCommentAuthor,
  createdAt: Schema.optionalKey(Schema.String),
  updatedAt: Schema.optionalKey(Schema.String),
  url: Schema.optionalKey(Schema.String),
});
export type ChangeRequestReviewComment = typeof ChangeRequestReviewComment.Type;

export const ChangeRequestReviewThread = Schema.Struct({
  id: TrimmedNonEmptyString,
  path: TrimmedNonEmptyString,
  side: ChangeRequestLineSide,
  line: PositiveInt,
  startLine: Schema.optionalKey(PositiveInt),
  isResolved: Schema.optionalKey(Schema.Boolean),
  isOutdated: Schema.optionalKey(Schema.Boolean),
  comments: Schema.Array(ChangeRequestReviewComment),
});
export type ChangeRequestReviewThread = typeof ChangeRequestReviewThread.Type;

export const SourceControlChangeRequestListInput = Schema.Struct({
  cwd: TrimmedNonEmptyString,
  context: Schema.optionalKey(SourceControlProviderInfo),
  source: Schema.optionalKey(
    Schema.Struct({
      refName: TrimmedNonEmptyString,
      owner: Schema.optionalKey(TrimmedNonEmptyString),
      repository: Schema.optionalKey(TrimmedNonEmptyString),
    }),
  ),
  headSelector: Schema.optionalKey(TrimmedNonEmptyString),
  baseRefName: Schema.optionalKey(TrimmedNonEmptyString),
  state: Schema.Union([ChangeRequestState, Schema.Literal("all")]),
  limit: Schema.optionalKey(PositiveInt),
});
export type SourceControlChangeRequestListInput = typeof SourceControlChangeRequestListInput.Type;

export const SourceControlChangeRequestUpdateInput = Schema.Struct({
  cwd: TrimmedNonEmptyString,
  reference: TrimmedNonEmptyString,
  baseRefName: Schema.optionalKey(TrimmedNonEmptyString),
  title: Schema.optionalKey(TrimmedNonEmptyString),
  bodyFile: Schema.optionalKey(TrimmedNonEmptyString),
});
export type SourceControlChangeRequestUpdateInput =
  typeof SourceControlChangeRequestUpdateInput.Type;

export const SourceControlChangeRequestCloseInput = Schema.Struct({
  cwd: TrimmedNonEmptyString,
  reference: TrimmedNonEmptyString,
});
export type SourceControlChangeRequestCloseInput = typeof SourceControlChangeRequestCloseInput.Type;

export const SourceControlRepositoryCloneUrls = Schema.Struct({
  nameWithOwner: TrimmedNonEmptyString,
  url: TrimmedNonEmptyString,
  sshUrl: TrimmedNonEmptyString,
});
export type SourceControlRepositoryCloneUrls = typeof SourceControlRepositoryCloneUrls.Type;

export const SourceControlRepositoryVisibility = Schema.Literals(["private", "public"]);
export type SourceControlRepositoryVisibility = typeof SourceControlRepositoryVisibility.Type;

export const SourceControlCloneProtocol = Schema.Literals(["auto", "ssh", "https"]);
export type SourceControlCloneProtocol = typeof SourceControlCloneProtocol.Type;

export const SourceControlRepositoryInfo = Schema.Struct({
  provider: SourceControlProviderKind,
  nameWithOwner: TrimmedNonEmptyString,
  url: TrimmedNonEmptyString,
  sshUrl: TrimmedNonEmptyString,
});
export type SourceControlRepositoryInfo = typeof SourceControlRepositoryInfo.Type;

export const SourceControlRepositoryLookupInput = Schema.Struct({
  provider: SourceControlProviderKind,
  repository: TrimmedNonEmptyString,
  cwd: Schema.optional(TrimmedNonEmptyString),
});
export type SourceControlRepositoryLookupInput = typeof SourceControlRepositoryLookupInput.Type;

export const SourceControlCloneRepositoryInput = Schema.Struct({
  provider: Schema.optional(SourceControlProviderKind),
  repository: Schema.optional(TrimmedNonEmptyString),
  remoteUrl: Schema.optional(TrimmedNonEmptyString),
  destinationPath: TrimmedNonEmptyString,
  protocol: Schema.optional(SourceControlCloneProtocol),
});
export type SourceControlCloneRepositoryInput = typeof SourceControlCloneRepositoryInput.Type;

export const SourceControlCloneRepositoryResult = Schema.Struct({
  cwd: TrimmedNonEmptyString,
  remoteUrl: TrimmedNonEmptyString,
  repository: Schema.NullOr(SourceControlRepositoryInfo),
});
export type SourceControlCloneRepositoryResult = typeof SourceControlCloneRepositoryResult.Type;

export const SourceControlPublishRepositoryInput = Schema.Struct({
  cwd: TrimmedNonEmptyString,
  provider: SourceControlProviderKind,
  repository: TrimmedNonEmptyString,
  visibility: SourceControlRepositoryVisibility,
  remoteName: Schema.optional(TrimmedNonEmptyString),
  protocol: Schema.optional(SourceControlCloneProtocol),
});
export type SourceControlPublishRepositoryInput = typeof SourceControlPublishRepositoryInput.Type;

export const SourceControlPublishStatus = Schema.Literals(["pushed", "remote_added"]);
export type SourceControlPublishStatus = typeof SourceControlPublishStatus.Type;

export const SourceControlPublishRepositoryResult = Schema.Struct({
  repository: SourceControlRepositoryInfo,
  remoteName: TrimmedNonEmptyString,
  remoteUrl: TrimmedNonEmptyString,
  branch: TrimmedNonEmptyString,
  upstreamBranch: Schema.optional(TrimmedNonEmptyString),
  status: SourceControlPublishStatus,
});
export type SourceControlPublishRepositoryResult = typeof SourceControlPublishRepositoryResult.Type;

export const SourceControlDiscoveryStatus = Schema.Literals(["available", "missing"]);
export type SourceControlDiscoveryStatus = typeof SourceControlDiscoveryStatus.Type;

export const SourceControlProviderAuthStatus = Schema.Literals([
  "authenticated",
  "unauthenticated",
  "unknown",
]);
export type SourceControlProviderAuthStatus = typeof SourceControlProviderAuthStatus.Type;

export const SourceControlProviderAuth = Schema.Struct({
  status: SourceControlProviderAuthStatus,
  account: Schema.Option(TrimmedNonEmptyString),
  host: Schema.Option(TrimmedNonEmptyString),
  detail: Schema.Option(TrimmedNonEmptyString),
});
export type SourceControlProviderAuth = typeof SourceControlProviderAuth.Type;

const SourceControlDiscoverySharedFields = {
  label: TrimmedNonEmptyString,
  executable: Schema.optional(TrimmedNonEmptyString),
  status: SourceControlDiscoveryStatus,
  version: Schema.Option(TrimmedNonEmptyString),
  installHint: TrimmedNonEmptyString,
  detail: Schema.Option(TrimmedNonEmptyString),
} as const;

export const VcsDiscoveryItem = Schema.Struct({
  kind: VcsDriverKind,
  implemented: Schema.Boolean,
  ...SourceControlDiscoverySharedFields,
});
export type VcsDiscoveryItem = typeof VcsDiscoveryItem.Type;

export const SourceControlProviderDiscoveryItem = Schema.Struct({
  kind: SourceControlProviderKind,
  ...SourceControlDiscoverySharedFields,
  auth: SourceControlProviderAuth,
});
export type SourceControlProviderDiscoveryItem = typeof SourceControlProviderDiscoveryItem.Type;

export const SourceControlDiscoveryResult = Schema.Struct({
  versionControlSystems: Schema.Array(VcsDiscoveryItem),
  sourceControlProviders: Schema.Array(SourceControlProviderDiscoveryItem),
});
export type SourceControlDiscoveryResult = typeof SourceControlDiscoveryResult.Type;

export class SourceControlProviderError extends Schema.TaggedErrorClass<SourceControlProviderError>()(
  "SourceControlProviderError",
  {
    provider: SourceControlProviderKind,
    operation: Schema.String,
    detail: Schema.String,
    cause: Schema.optional(Schema.Defect),
  },
) {
  override get message(): string {
    return `Source control provider ${this.provider} failed in ${this.operation}: ${this.detail}`;
  }
}

export class SourceControlRepositoryError extends Schema.TaggedErrorClass<SourceControlRepositoryError>()(
  "SourceControlRepositoryError",
  {
    provider: SourceControlProviderKind,
    operation: Schema.String,
    detail: Schema.String,
    cause: Schema.optional(Schema.Defect),
  },
) {
  override get message(): string {
    return `Source control repository operation ${this.operation} failed for ${this.provider}: ${this.detail}`;
  }
}
