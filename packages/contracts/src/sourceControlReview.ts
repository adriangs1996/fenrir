import { Schema } from "effect";

import {
  AuthSessionId,
  IsoDateTime,
  NonNegativeInt,
  PositiveInt,
  ProjectId,
  ThreadId,
  TrimmedNonEmptyString,
  makeEntityId,
} from "./baseSchemas";
import { ModelSelection, ProviderKind } from "./orchestration";

export const ReviewText = TrimmedNonEmptyString.check(Schema.isMaxLength(100_000));
export type ReviewText = typeof ReviewText.Type;
export const ReviewShortText = TrimmedNonEmptyString.check(Schema.isMaxLength(512));
export type ReviewShortText = typeof ReviewShortText.Type;
export const ReviewNormalizedPath = TrimmedNonEmptyString.check(Schema.isMaxLength(4_096));
export type ReviewNormalizedPath = typeof ReviewNormalizedPath.Type;
export const ReviewFingerprint = TrimmedNonEmptyString.check(Schema.isMaxLength(512));
export type ReviewFingerprint = typeof ReviewFingerprint.Type;

export const ReviewSessionId = makeEntityId("ReviewSessionId");
export type ReviewSessionId = typeof ReviewSessionId.Type;
export const ReviewGroupId = makeEntityId("ReviewGroupId");
export type ReviewGroupId = typeof ReviewGroupId.Type;
export const ReviewFileId = makeEntityId("ReviewFileId");
export type ReviewFileId = typeof ReviewFileId.Type;
export const ReviewChunkId = makeEntityId("ReviewChunkId");
export type ReviewChunkId = typeof ReviewChunkId.Type;
export const ReviewLocalAnnotationThreadId = makeEntityId("ReviewLocalAnnotationThreadId");
export type ReviewLocalAnnotationThreadId = typeof ReviewLocalAnnotationThreadId.Type;
export const ReviewLocalAnnotationReplyId = makeEntityId("ReviewLocalAnnotationReplyId");
export type ReviewLocalAnnotationReplyId = typeof ReviewLocalAnnotationReplyId.Type;
export const ReviewOverviewNoteId = makeEntityId("ReviewOverviewNoteId");
export type ReviewOverviewNoteId = typeof ReviewOverviewNoteId.Type;
export const ReviewAnalysisArtifactId = makeEntityId("ReviewAnalysisArtifactId");
export type ReviewAnalysisArtifactId = typeof ReviewAnalysisArtifactId.Type;
export const GitHubReviewDraftId = makeEntityId("GitHubReviewDraftId");
export type GitHubReviewDraftId = typeof GitHubReviewDraftId.Type;
export const GitHubReviewId = makeEntityId("GitHubReviewId");
export type GitHubReviewId = typeof GitHubReviewId.Type;
export const GitHubReviewThreadId = makeEntityId("GitHubReviewThreadId");
export type GitHubReviewThreadId = typeof GitHubReviewThreadId.Type;
export const GitHubReviewCommentId = makeEntityId("GitHubReviewCommentId");
export type GitHubReviewCommentId = typeof GitHubReviewCommentId.Type;

export const ReviewTabMode = Schema.Literals(["raw", "review"]);
export type ReviewTabMode = typeof ReviewTabMode.Type;
export const ReviewScope = Schema.Literals(["uncommitted", "branch", "combined"]);
export type ReviewScope = typeof ReviewScope.Type;
export const ReviewRawLaneKind = Schema.Literals([
  "ignored",
  "unstaged",
  "staged",
  "committed",
  "inverse-edit",
]);
export type ReviewRawLaneKind = typeof ReviewRawLaneKind.Type;
export const ReviewProgressState = Schema.Literals(["unreviewed", "reviewed", "needs-follow-up"]);
export type ReviewProgressState = typeof ReviewProgressState.Type;
export const ReviewAnalysisProviderKind = Schema.Union([
  ProviderKind,
  Schema.Literal("fenrir-local"),
]);
export type ReviewAnalysisProviderKind = typeof ReviewAnalysisProviderKind.Type;
export const ReviewArtifactProviderKind = Schema.Literals(["fenrir-local", "github"]);
export type ReviewArtifactProviderKind = typeof ReviewArtifactProviderKind.Type;
export const ReviewAnalysisArtifactStatus = Schema.Literals([
  "queued",
  "running",
  "completed",
  "failed",
  "cancelled",
]);
export type ReviewAnalysisArtifactStatus = typeof ReviewAnalysisArtifactStatus.Type;
export const ReviewAnalysisArtifactStaleStatus = Schema.Literals([
  "fresh",
  "stale-target",
  "stale-anchor",
  "stale-content",
  "superseded",
]);
export type ReviewAnalysisArtifactStaleStatus = typeof ReviewAnalysisArtifactStaleStatus.Type;
export const ReviewAnalysisRiskLevel = Schema.Literals(["high", "medium", "low"]);
export type ReviewAnalysisRiskLevel = typeof ReviewAnalysisRiskLevel.Type;
export const ReviewAnalysisStaleReason = Schema.Literals([
  "code-diff-changed",
  "remote-review-context-changed",
  "mode-changed",
  "scope-changed",
  "model-changed",
  "instruction-changed",
]);
export type ReviewAnalysisStaleReason = typeof ReviewAnalysisStaleReason.Type;
export const ReviewDegradedStateReason = Schema.Literals([
  "not-a-repository",
  "git-status-unavailable",
  "diff-unavailable",
  "patch-truncated",
  "provider-unavailable",
  "github-unavailable",
  "offline",
  "permissions-limited",
]);
export type ReviewDegradedStateReason = typeof ReviewDegradedStateReason.Type;
export const ReviewActionBlockedReason = Schema.Literals([
  "no-reviewable-content",
  "session-target-stale",
  "degraded-state",
  "provider-auth-required",
  "provider-unavailable",
  "github-review-read-only",
  "sync-in-progress",
]);
export type ReviewActionBlockedReason = typeof ReviewActionBlockedReason.Type;
export const ReviewLocalNoteAuthorRole = Schema.Literals(["user", "assistant", "system"]);
export type ReviewLocalNoteAuthorRole = typeof ReviewLocalNoteAuthorRole.Type;
export const GitHubReviewDecision = Schema.Literals(["comment", "approve", "request-changes"]);
export type GitHubReviewDecision = typeof GitHubReviewDecision.Type;
export const ReviewGitHubPendingDraftKind = Schema.Literals(["inline-comment", "review-summary"]);
export type ReviewGitHubPendingDraftKind = typeof ReviewGitHubPendingDraftKind.Type;
export const ReviewIgnoreRuleKind = Schema.Literals(["file", "directory"]);
export type ReviewIgnoreRuleKind = typeof ReviewIgnoreRuleKind.Type;
export const ReviewDiffFileChangeKind = Schema.Literals([
  "ignored",
  "text",
  "rename",
  "delete",
  "binary",
  "permission-only",
]);
export type ReviewDiffFileChangeKind = typeof ReviewDiffFileChangeKind.Type;
export const ReviewDiffLineKind = Schema.Literals(["context", "add", "delete"]);
export type ReviewDiffLineKind = typeof ReviewDiffLineKind.Type;

export const ReviewProgressCounts = Schema.Struct({
  unreviewed: NonNegativeInt,
  reviewed: NonNegativeInt,
  needsFollowUp: NonNegativeInt,
});
export type ReviewProgressCounts = typeof ReviewProgressCounts.Type;

export const ReviewLineRange = Schema.Struct({
  startLine: PositiveInt,
  endLine: PositiveInt,
});
export type ReviewLineRange = typeof ReviewLineRange.Type;

export const ReviewAnchorProvenance = Schema.Struct({
  scope: ReviewScope,
  lane: ReviewRawLaneKind,
});
export type ReviewAnchorProvenance = typeof ReviewAnchorProvenance.Type;

export const ReviewStableAnchor = Schema.Struct({
  normalizedPath: ReviewNormalizedPath,
  provenance: ReviewAnchorProvenance,
  oldRange: Schema.optionalKey(ReviewLineRange),
  newRange: Schema.optionalKey(ReviewLineRange),
  excerpt: ReviewText,
  excerptHash: Schema.optionalKey(ReviewFingerprint),
  patchFingerprint: Schema.optionalKey(ReviewFingerprint),
});
export type ReviewStableAnchor = typeof ReviewStableAnchor.Type;

export const ReviewSessionTarget = Schema.Struct({
  projectId: Schema.optionalKey(ProjectId),
  threadId: Schema.optionalKey(ThreadId),
  cwd: TrimmedNonEmptyString,
  repositoryRoot: TrimmedNonEmptyString,
  repositoryName: Schema.optionalKey(ReviewShortText),
  worktreePath: Schema.NullOr(TrimmedNonEmptyString),
  selectionLabel: Schema.optionalKey(ReviewShortText),
  baseRef: Schema.optionalKey(TrimmedNonEmptyString),
  headRef: Schema.optionalKey(TrimmedNonEmptyString),
  baseCommitOid: Schema.optionalKey(TrimmedNonEmptyString),
  headCommitOid: Schema.optionalKey(TrimmedNonEmptyString),
  pullRequestNumber: Schema.optionalKey(PositiveInt),
  pullRequestUrl: Schema.optionalKey(Schema.String),
});
export type ReviewSessionTarget = typeof ReviewSessionTarget.Type;

export const ReviewSessionSummary = Schema.Struct({
  id: ReviewSessionId,
  mode: ReviewTabMode,
  scope: ReviewScope,
  target: ReviewSessionTarget,
  progressCounts: ReviewProgressCounts,
  fileCount: NonNegativeInt,
  chunkCount: NonNegativeInt,
  localThreadCount: NonNegativeInt,
  overviewNoteCount: NonNegativeInt,
  analysisArtifactCount: NonNegativeInt,
  degradedReasons: Schema.Array(ReviewDegradedStateReason),
  blockedActions: Schema.Array(ReviewActionBlockedReason),
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
});
export type ReviewSessionSummary = typeof ReviewSessionSummary.Type;

export const ReviewGroup = Schema.Struct({
  id: ReviewGroupId,
  sessionId: ReviewSessionId,
  title: ReviewShortText,
  scope: ReviewScope,
  lane: Schema.optionalKey(ReviewRawLaneKind),
  progressState: ReviewProgressState,
  degradedReasons: Schema.Array(ReviewDegradedStateReason),
});
export type ReviewGroup = typeof ReviewGroup.Type;

export const ReviewFile = Schema.Struct({
  id: ReviewFileId,
  sessionId: ReviewSessionId,
  groupId: ReviewGroupId,
  normalizedPath: ReviewNormalizedPath,
  displayPath: ReviewNormalizedPath,
  progressState: ReviewProgressState,
});
export type ReviewFile = typeof ReviewFile.Type;

export const ReviewChunk = Schema.Struct({
  id: ReviewChunkId,
  sessionId: ReviewSessionId,
  groupId: ReviewGroupId,
  fileId: ReviewFileId,
  anchor: ReviewStableAnchor,
  progressState: ReviewProgressState,
});
export type ReviewChunk = typeof ReviewChunk.Type;

export const ReviewLocalNoteAuthorSnapshot = Schema.Struct({
  authSessionId: AuthSessionId,
  subject: ReviewShortText,
  role: ReviewLocalNoteAuthorRole,
  clientLabel: Schema.optionalKey(ReviewShortText),
  deviceLabel: Schema.optionalKey(ReviewShortText),
});
export type ReviewLocalNoteAuthorSnapshot = typeof ReviewLocalNoteAuthorSnapshot.Type;

export const ReviewLocalAnnotationThread = Schema.Struct({
  id: ReviewLocalAnnotationThreadId,
  sessionId: ReviewSessionId,
  groupId: ReviewGroupId,
  fileId: ReviewFileId,
  chunkId: Schema.optionalKey(ReviewChunkId),
  anchor: ReviewStableAnchor,
  body: ReviewText,
  progressState: ReviewProgressState,
  isResolved: Schema.Boolean,
  isOutdated: Schema.Boolean,
  isSuggestedResolved: Schema.Boolean,
  viewerCanEdit: Schema.Boolean,
  author: ReviewLocalNoteAuthorSnapshot,
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
});
export type ReviewLocalAnnotationThread = typeof ReviewLocalAnnotationThread.Type;

export const ReviewLocalAnnotationReply = Schema.Struct({
  id: ReviewLocalAnnotationReplyId,
  threadId: ReviewLocalAnnotationThreadId,
  sessionId: ReviewSessionId,
  body: ReviewText,
  viewerCanEdit: Schema.Boolean,
  author: ReviewLocalNoteAuthorSnapshot,
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
});
export type ReviewLocalAnnotationReply = typeof ReviewLocalAnnotationReply.Type;

export const ReviewOverviewNote = Schema.Struct({
  id: ReviewOverviewNoteId,
  sessionId: ReviewSessionId,
  title: Schema.optionalKey(ReviewShortText),
  body: ReviewText,
  progressState: ReviewProgressState,
  viewerCanEdit: Schema.Boolean,
  author: ReviewLocalNoteAuthorSnapshot,
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
});
export type ReviewOverviewNote = typeof ReviewOverviewNote.Type;

export const ReviewAnalysisSemanticGroupId = TrimmedNonEmptyString.check(Schema.isMaxLength(128));
export type ReviewAnalysisSemanticGroupId = typeof ReviewAnalysisSemanticGroupId.Type;

export const ReviewAnalysisChecklistItemId = TrimmedNonEmptyString.check(Schema.isMaxLength(128));
export type ReviewAnalysisChecklistItemId = typeof ReviewAnalysisChecklistItemId.Type;

export const ReviewAnalysisTargetRef = Schema.Struct({
  groupId: ReviewGroupId,
  lane: ReviewRawLaneKind,
  fileId: Schema.optionalKey(ReviewFileId),
  chunkId: Schema.optionalKey(ReviewChunkId),
  normalizedPath: Schema.optionalKey(ReviewNormalizedPath),
});
export type ReviewAnalysisTargetRef = typeof ReviewAnalysisTargetRef.Type;

export const ReviewAnalysisChecklistItem = Schema.Struct({
  id: ReviewAnalysisChecklistItemId,
  title: ReviewShortText,
  detail: Schema.optionalKey(ReviewText),
  targetRefs: Schema.Array(ReviewAnalysisTargetRef),
});
export type ReviewAnalysisChecklistItem = typeof ReviewAnalysisChecklistItem.Type;

export const ReviewAnalysisRiskFlag = Schema.Struct({
  level: ReviewAnalysisRiskLevel,
  label: ReviewShortText,
  detail: Schema.optionalKey(ReviewText),
  targetRefs: Schema.Array(ReviewAnalysisTargetRef),
});
export type ReviewAnalysisRiskFlag = typeof ReviewAnalysisRiskFlag.Type;

export const ReviewAnalysisSemanticGroup = Schema.Struct({
  id: ReviewAnalysisSemanticGroupId,
  title: ReviewShortText,
  rationale: ReviewText,
  suggestedReviewOrder: PositiveInt,
  needsAttention: Schema.Boolean,
  targetRefs: Schema.Array(ReviewAnalysisTargetRef),
  checklist: Schema.Array(ReviewAnalysisChecklistItem),
  riskFlags: Schema.Array(ReviewAnalysisRiskFlag),
});
export type ReviewAnalysisSemanticGroup = typeof ReviewAnalysisSemanticGroup.Type;

export const ReviewAnalysisMetadata = Schema.Struct({
  mode: ReviewTabMode,
  scope: ReviewScope,
  target: ReviewSessionTarget,
  modelSelection: Schema.optionalKey(ModelSelection),
  instruction: Schema.optionalKey(ReviewText),
  codeDiffFingerprint: ReviewFingerprint,
  remoteContextFingerprint: ReviewFingerprint,
  fileCount: NonNegativeInt,
  semanticGroupCount: NonNegativeInt,
  remoteThreadCount: NonNegativeInt,
  remoteGeneralCommentCount: NonNegativeInt,
});
export type ReviewAnalysisMetadata = typeof ReviewAnalysisMetadata.Type;

export const ReviewAnalysisStaleMetadata = Schema.Struct({
  comparedAt: IsoDateTime,
  invalidatedBy: Schema.Array(ReviewAnalysisStaleReason),
  currentCodeDiffFingerprint: ReviewFingerprint,
  currentRemoteContextFingerprint: ReviewFingerprint,
  generatedMode: ReviewTabMode,
  currentMode: ReviewTabMode,
  generatedScope: ReviewScope,
  currentScope: ReviewScope,
  generatedModelSelection: Schema.optionalKey(ModelSelection),
  currentModelSelection: Schema.optionalKey(ModelSelection),
  generatedInstruction: Schema.optionalKey(ReviewText),
});
export type ReviewAnalysisStaleMetadata = typeof ReviewAnalysisStaleMetadata.Type;

export const ReviewAnalysisArtifact = Schema.Struct({
  id: ReviewAnalysisArtifactId,
  sessionId: ReviewSessionId,
  provider: ReviewAnalysisProviderKind,
  status: ReviewAnalysisArtifactStatus,
  staleStatus: ReviewAnalysisArtifactStaleStatus,
  summaryMarkdown: Schema.optionalKey(ReviewText),
  checklist: Schema.optionalKey(Schema.Array(ReviewAnalysisChecklistItem)),
  semanticGroups: Schema.optionalKey(Schema.Array(ReviewAnalysisSemanticGroup)),
  riskFlags: Schema.optionalKey(Schema.Array(ReviewAnalysisRiskFlag)),
  metadata: Schema.optionalKey(ReviewAnalysisMetadata),
  staleMetadata: Schema.optionalKey(ReviewAnalysisStaleMetadata),
  fileId: Schema.optionalKey(ReviewFileId),
  chunkId: Schema.optionalKey(ReviewChunkId),
  requestedAt: IsoDateTime,
  completedAt: Schema.optionalKey(IsoDateTime),
  failureMessage: Schema.optionalKey(ReviewText),
  supersededByArtifactId: Schema.optionalKey(ReviewAnalysisArtifactId),
});
export type ReviewAnalysisArtifact = typeof ReviewAnalysisArtifact.Type;

export const GitHubReviewComment = Schema.Struct({
  id: GitHubReviewCommentId,
  threadId: GitHubReviewThreadId,
  path: ReviewNormalizedPath,
  body: ReviewText,
  anchor: ReviewStableAnchor,
  authorLogin: ReviewShortText,
  authorAvatarUrl: Schema.optionalKey(Schema.String),
  isPending: Schema.Boolean,
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
});
export type GitHubReviewComment = typeof GitHubReviewComment.Type;

export const GitHubReviewThread = Schema.Struct({
  id: GitHubReviewThreadId,
  path: ReviewNormalizedPath,
  anchor: ReviewStableAnchor,
  isResolved: Schema.Boolean,
  isOutdated: Schema.Boolean,
  comments: Schema.Array(GitHubReviewComment),
});
export type GitHubReviewThread = typeof GitHubReviewThread.Type;

export const GitHubReviewGeneralComment = Schema.Struct({
  id: GitHubReviewCommentId,
  body: ReviewText,
  authorLogin: ReviewShortText,
  authorAvatarUrl: Schema.optionalKey(Schema.String),
  isPending: Schema.Boolean,
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
});
export type GitHubReviewGeneralComment = typeof GitHubReviewGeneralComment.Type;

const GitHubReviewSharedFields = {
  pullRequestNumber: PositiveInt,
  decision: GitHubReviewDecision,
  body: Schema.optionalKey(ReviewText),
  threads: Schema.Array(GitHubReviewThread),
  updatedAt: IsoDateTime,
};

export const GitHubReviewDraft = Schema.Struct({
  id: GitHubReviewDraftId,
  state: Schema.Literal("pending"),
  createdAt: IsoDateTime,
  ...GitHubReviewSharedFields,
});
export type GitHubReviewDraft = typeof GitHubReviewDraft.Type;

export const GitHubSubmittedReview = Schema.Struct({
  id: GitHubReviewId,
  state: Schema.Literal("submitted"),
  authorLogin: ReviewShortText,
  authorAvatarUrl: Schema.optionalKey(Schema.String),
  createdAt: IsoDateTime,
  submittedAt: IsoDateTime,
  ...GitHubReviewSharedFields,
});
export type GitHubSubmittedReview = typeof GitHubSubmittedReview.Type;

export const GitHubReviewReadModel = Schema.Union([GitHubReviewDraft, GitHubSubmittedReview]);
export type GitHubReviewReadModel = typeof GitHubReviewReadModel.Type;

export const GitHubReviewSnapshot = Schema.Struct({
  provider: Schema.Literal("github"),
  pullRequestNumber: PositiveInt,
  writable: Schema.Boolean,
  draft: Schema.NullOr(GitHubReviewDraft),
  pendingDrafts: Schema.Array(
    Schema.Struct({
      id: GitHubReviewDraftId,
      draftKind: ReviewGitHubPendingDraftKind,
      anchor: Schema.NullOr(ReviewStableAnchor),
      body: ReviewText,
      isOutdated: Schema.Boolean,
      submitAction: Schema.NullOr(GitHubReviewDecision),
      createdAt: IsoDateTime,
      updatedAt: IsoDateTime,
    }),
  ),
  threads: Schema.Array(GitHubReviewThread),
  generalComments: Schema.Array(GitHubReviewGeneralComment),
  reviews: Schema.Array(GitHubSubmittedReview),
});
export type GitHubReviewSnapshot = typeof GitHubReviewSnapshot.Type;

export const ReviewGitHubPendingDraft = Schema.Struct({
  id: GitHubReviewDraftId,
  sessionId: ReviewSessionId,
  authSessionId: AuthSessionId,
  draftKind: ReviewGitHubPendingDraftKind,
  anchor: Schema.NullOr(ReviewStableAnchor),
  body: ReviewText,
  isOutdated: Schema.Boolean,
  submitAction: Schema.NullOr(GitHubReviewDecision),
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
});
export type ReviewGitHubPendingDraft = typeof ReviewGitHubPendingDraft.Type;

export const ReviewIgnoreRule = Schema.Struct({
  checkoutPath: TrimmedNonEmptyString,
  ruleKind: ReviewIgnoreRuleKind,
  normalizedPath: ReviewNormalizedPath,
  matchPath: ReviewNormalizedPath,
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
});
export type ReviewIgnoreRule = typeof ReviewIgnoreRule.Type;

export const ReviewDiffMetadataCard = Schema.Struct({
  kind: ReviewDiffFileChangeKind,
  title: ReviewShortText,
  summaryLines: Schema.Array(ReviewShortText),
});
export type ReviewDiffMetadataCard = typeof ReviewDiffMetadataCard.Type;

export const ReviewDiffIgnoreRuleRef = Schema.Struct({
  ruleKind: ReviewIgnoreRuleKind,
  normalizedPath: ReviewNormalizedPath,
  matchPath: ReviewNormalizedPath,
});
export type ReviewDiffIgnoreRuleRef = typeof ReviewDiffIgnoreRuleRef.Type;

export const ReviewDiffFileEntry = Schema.Struct({
  sessionId: ReviewSessionId,
  groupId: ReviewGroupId,
  fileId: ReviewFileId,
  lane: ReviewRawLaneKind,
  provenance: ReviewAnchorProvenance,
  normalizedPath: ReviewNormalizedPath,
  displayPath: ReviewNormalizedPath,
  previousPath: Schema.optionalKey(ReviewNormalizedPath),
  changeKind: ReviewDiffFileChangeKind,
  insertions: NonNegativeInt,
  deletions: NonNegativeInt,
  chunkCount: NonNegativeInt,
  metadata: Schema.optionalKey(ReviewDiffMetadataCard),
  ignoreRule: Schema.optionalKey(ReviewDiffIgnoreRuleRef),
});
export type ReviewDiffFileEntry = typeof ReviewDiffFileEntry.Type;

export const ReviewDiffLane = Schema.Struct({
  sessionId: ReviewSessionId,
  groupId: ReviewGroupId,
  kind: ReviewRawLaneKind,
  title: ReviewShortText,
  fileCount: NonNegativeInt,
  files: Schema.Array(ReviewDiffFileEntry),
});
export type ReviewDiffLane = typeof ReviewDiffLane.Type;

export const ReviewDiffSnapshot = Schema.Struct({
  sessionId: ReviewSessionId,
  scope: ReviewScope,
  target: ReviewSessionTarget,
  generatedAt: IsoDateTime,
  lanes: Schema.Array(ReviewDiffLane),
});
export type ReviewDiffSnapshot = typeof ReviewDiffSnapshot.Type;

export const ReviewDiffChunkLine = Schema.Struct({
  kind: ReviewDiffLineKind,
  text: Schema.String,
  oldLineNumber: Schema.optionalKey(PositiveInt),
  newLineNumber: Schema.optionalKey(PositiveInt),
});
export type ReviewDiffChunkLine = typeof ReviewDiffChunkLine.Type;

export const ReviewDiffChunk = Schema.Struct({
  chunkId: ReviewChunkId,
  anchor: ReviewStableAnchor,
  header: ReviewShortText,
  lines: Schema.Array(ReviewDiffChunkLine),
});
export type ReviewDiffChunk = typeof ReviewDiffChunk.Type;

export const ReviewDiffFilePatch = Schema.Struct({
  sessionId: ReviewSessionId,
  groupId: ReviewGroupId,
  fileId: ReviewFileId,
  scope: ReviewScope,
  lane: ReviewRawLaneKind,
  provenance: ReviewAnchorProvenance,
  normalizedPath: ReviewNormalizedPath,
  displayPath: ReviewNormalizedPath,
  previousPath: Schema.optionalKey(ReviewNormalizedPath),
  changeKind: ReviewDiffFileChangeKind,
  insertions: NonNegativeInt,
  deletions: NonNegativeInt,
  metadata: Schema.optionalKey(ReviewDiffMetadataCard),
  ignoreRule: Schema.optionalKey(ReviewDiffIgnoreRuleRef),
  chunks: Schema.Array(ReviewDiffChunk),
});
export type ReviewDiffFilePatch = typeof ReviewDiffFilePatch.Type;

export const ReviewSessionSnapshot = Schema.Struct({
  summary: ReviewSessionSummary,
  groups: Schema.Array(ReviewGroup),
  files: Schema.Array(ReviewFile),
  chunks: Schema.Array(ReviewChunk),
  localThreads: Schema.Array(ReviewLocalAnnotationThread),
  localReplies: Schema.Array(ReviewLocalAnnotationReply),
  overviewNotes: Schema.Array(ReviewOverviewNote),
  analysisArtifacts: Schema.Array(ReviewAnalysisArtifact),
  github: Schema.NullOr(GitHubReviewSnapshot),
});
export type ReviewSessionSnapshot = typeof ReviewSessionSnapshot.Type;

export const ReviewGetSessionInput = Schema.Struct({
  sessionId: ReviewSessionId,
});
export type ReviewGetSessionInput = typeof ReviewGetSessionInput.Type;

export const ReviewPullRequestOverride = Schema.Struct({
  provider: Schema.Literal("github"),
  number: PositiveInt,
  url: Schema.String,
});
export type ReviewPullRequestOverride = typeof ReviewPullRequestOverride.Type;

export const ReviewGetOrCreateSessionInput = Schema.Struct({
  threadId: ThreadId,
  baseBranchOverride: Schema.optionalKey(TrimmedNonEmptyString),
  pullRequestOverride: Schema.optionalKey(ReviewPullRequestOverride),
  mode: Schema.optionalKey(ReviewTabMode),
  scope: Schema.optionalKey(ReviewScope),
});
export type ReviewGetOrCreateSessionInput = typeof ReviewGetOrCreateSessionInput.Type;

export const ReviewSetModeInput = Schema.Struct({
  sessionId: ReviewSessionId,
  mode: ReviewTabMode,
});
export type ReviewSetModeInput = typeof ReviewSetModeInput.Type;

export const ReviewSetScopeInput = Schema.Struct({
  sessionId: ReviewSessionId,
  scope: ReviewScope,
});
export type ReviewSetScopeInput = typeof ReviewSetScopeInput.Type;

export const ReviewSetProgressInput = Schema.Struct({
  sessionId: ReviewSessionId,
  fileId: Schema.optionalKey(ReviewFileId),
  chunkId: Schema.optionalKey(ReviewChunkId),
  threadId: Schema.optionalKey(ReviewLocalAnnotationThreadId),
  overviewNoteId: Schema.optionalKey(ReviewOverviewNoteId),
  progressState: ReviewProgressState,
});
export type ReviewSetProgressInput = typeof ReviewSetProgressInput.Type;

export const ReviewCreateLocalAnnotationThreadInput = Schema.Struct({
  sessionId: ReviewSessionId,
  groupId: ReviewGroupId,
  fileId: ReviewFileId,
  chunkId: Schema.optionalKey(ReviewChunkId),
  anchor: ReviewStableAnchor,
  body: ReviewText,
  progressState: Schema.optionalKey(ReviewProgressState),
  author: ReviewLocalNoteAuthorSnapshot,
});
export type ReviewCreateLocalAnnotationThreadInput =
  typeof ReviewCreateLocalAnnotationThreadInput.Type;

export const ReviewCreateLocalAnnotationReplyInput = Schema.Struct({
  sessionId: ReviewSessionId,
  threadId: ReviewLocalAnnotationThreadId,
  body: ReviewText,
  author: ReviewLocalNoteAuthorSnapshot,
});
export type ReviewCreateLocalAnnotationReplyInput =
  typeof ReviewCreateLocalAnnotationReplyInput.Type;

export const ReviewUpdateLocalAnnotationThreadInput = Schema.Struct({
  sessionId: ReviewSessionId,
  threadId: ReviewLocalAnnotationThreadId,
  body: ReviewText,
});
export type ReviewUpdateLocalAnnotationThreadInput =
  typeof ReviewUpdateLocalAnnotationThreadInput.Type;

export const ReviewUpdateLocalAnnotationReplyInput = Schema.Struct({
  sessionId: ReviewSessionId,
  replyId: ReviewLocalAnnotationReplyId,
  body: ReviewText,
});
export type ReviewUpdateLocalAnnotationReplyInput =
  typeof ReviewUpdateLocalAnnotationReplyInput.Type;

export const ReviewDeleteLocalAnnotationThreadInput = Schema.Struct({
  sessionId: ReviewSessionId,
  threadId: ReviewLocalAnnotationThreadId,
});
export type ReviewDeleteLocalAnnotationThreadInput =
  typeof ReviewDeleteLocalAnnotationThreadInput.Type;

export const ReviewDeleteLocalAnnotationReplyInput = Schema.Struct({
  sessionId: ReviewSessionId,
  replyId: ReviewLocalAnnotationReplyId,
});
export type ReviewDeleteLocalAnnotationReplyInput =
  typeof ReviewDeleteLocalAnnotationReplyInput.Type;

export const ReviewSetLocalThreadResolvedInput = Schema.Struct({
  sessionId: ReviewSessionId,
  threadId: ReviewLocalAnnotationThreadId,
  resolved: Schema.Boolean,
});
export type ReviewSetLocalThreadResolvedInput = typeof ReviewSetLocalThreadResolvedInput.Type;

export const ReviewUpsertOverviewNoteInput = Schema.Struct({
  sessionId: ReviewSessionId,
  noteId: Schema.optionalKey(ReviewOverviewNoteId),
  title: Schema.optionalKey(ReviewShortText),
  body: ReviewText,
  progressState: Schema.optionalKey(ReviewProgressState),
  author: ReviewLocalNoteAuthorSnapshot,
});
export type ReviewUpsertOverviewNoteInput = typeof ReviewUpsertOverviewNoteInput.Type;

export const ReviewDeleteOverviewNoteInput = Schema.Struct({
  sessionId: ReviewSessionId,
  noteId: ReviewOverviewNoteId,
});
export type ReviewDeleteOverviewNoteInput = typeof ReviewDeleteOverviewNoteInput.Type;

export const ReviewGetGitHubSnapshotInput = Schema.Struct({
  sessionId: ReviewSessionId,
});
export type ReviewGetGitHubSnapshotInput = typeof ReviewGetGitHubSnapshotInput.Type;

export const ReviewGetDiffSnapshotInput = Schema.Struct({
  sessionId: ReviewSessionId,
});
export type ReviewGetDiffSnapshotInput = typeof ReviewGetDiffSnapshotInput.Type;

export const ReviewGetFilePatchInput = Schema.Struct({
  sessionId: ReviewSessionId,
  lane: ReviewRawLaneKind,
  normalizedPath: ReviewNormalizedPath,
});
export type ReviewGetFilePatchInput = typeof ReviewGetFilePatchInput.Type;

export const ReviewGetChunkPayloadInput = Schema.Struct({
  sessionId: ReviewSessionId,
  lane: ReviewRawLaneKind,
  normalizedPath: ReviewNormalizedPath,
  chunkId: ReviewChunkId,
});
export type ReviewGetChunkPayloadInput = typeof ReviewGetChunkPayloadInput.Type;

export const ReviewChunkPayload = Schema.Struct({
  sessionId: ReviewSessionId,
  groupId: ReviewGroupId,
  fileId: ReviewFileId,
  lane: ReviewRawLaneKind,
  normalizedPath: ReviewNormalizedPath,
  chunkId: ReviewChunkId,
  anchor: ReviewStableAnchor,
  rawPatch: Schema.String,
});
export type ReviewChunkPayload = typeof ReviewChunkPayload.Type;

export const ReviewUpsertGitHubDraftInput = Schema.Struct({
  sessionId: ReviewSessionId,
  draftId: Schema.optionalKey(GitHubReviewDraftId),
  draftKind: ReviewGitHubPendingDraftKind,
  chunkId: Schema.optionalKey(ReviewChunkId),
  body: ReviewText,
  submitAction: Schema.optionalKey(GitHubReviewDecision),
});
export type ReviewUpsertGitHubDraftInput = typeof ReviewUpsertGitHubDraftInput.Type;

export const ReviewDeleteGitHubDraftInput = Schema.Struct({
  sessionId: ReviewSessionId,
  draftId: GitHubReviewDraftId,
});
export type ReviewDeleteGitHubDraftInput = typeof ReviewDeleteGitHubDraftInput.Type;

export const ReviewReplyToGitHubThreadInput = Schema.Struct({
  sessionId: ReviewSessionId,
  threadId: GitHubReviewThreadId,
  body: ReviewText,
});
export type ReviewReplyToGitHubThreadInput = typeof ReviewReplyToGitHubThreadInput.Type;

export const ReviewSubmitGitHubDraftInput = Schema.Struct({
  sessionId: ReviewSessionId,
  decision: GitHubReviewDecision,
  body: Schema.optionalKey(ReviewText),
});
export type ReviewSubmitGitHubDraftInput = typeof ReviewSubmitGitHubDraftInput.Type;

export const ReviewRefreshProviderDataInput = Schema.Struct({
  sessionId: ReviewSessionId,
});
export type ReviewRefreshProviderDataInput = typeof ReviewRefreshProviderDataInput.Type;

export const ReviewGenerateAnalysisInput = Schema.Struct({
  sessionId: ReviewSessionId,
  force: Schema.optionalKey(Schema.Boolean),
  instruction: Schema.optionalKey(ReviewText),
});
export type ReviewGenerateAnalysisInput = typeof ReviewGenerateAnalysisInput.Type;

export const ReviewRawMutationAction = Schema.Literals([
  "stage",
  "unstage",
  "undo",
  "ignore",
  "unignore",
]);
export type ReviewRawMutationAction = typeof ReviewRawMutationAction.Type;

export const ReviewRawMutationTargetKind = Schema.Literals(["file", "chunk", "ignore-rule"]);
export type ReviewRawMutationTargetKind = typeof ReviewRawMutationTargetKind.Type;

export const ReviewRawSelectionTarget = Schema.Struct({
  targetKind: Schema.Literal("file"),
  lane: ReviewRawLaneKind,
  normalizedPath: ReviewNormalizedPath,
});
export type ReviewRawSelectionTarget = typeof ReviewRawSelectionTarget.Type;

export const ReviewRawSelectionChunkTarget = Schema.Struct({
  targetKind: Schema.Literal("chunk"),
  lane: ReviewRawLaneKind,
  normalizedPath: ReviewNormalizedPath,
  chunkId: ReviewChunkId,
});
export type ReviewRawSelectionChunkTarget = typeof ReviewRawSelectionChunkTarget.Type;

export const ReviewRawIgnoreRuleTarget = Schema.Struct({
  targetKind: Schema.Literal("ignore-rule"),
  ruleKind: ReviewIgnoreRuleKind,
  normalizedPath: ReviewNormalizedPath,
});
export type ReviewRawIgnoreRuleTarget = typeof ReviewRawIgnoreRuleTarget.Type;

export const ReviewApplyRawMutationInput = Schema.Struct({
  sessionId: ReviewSessionId,
  action: ReviewRawMutationAction,
  target: Schema.Union([
    ReviewRawSelectionTarget,
    ReviewRawSelectionChunkTarget,
    ReviewRawIgnoreRuleTarget,
  ]),
});
export type ReviewApplyRawMutationInput = typeof ReviewApplyRawMutationInput.Type;

export const ReviewRawMutationLaneTransition = Schema.Struct({
  normalizedPath: ReviewNormalizedPath,
  fromLane: Schema.optionalKey(ReviewRawLaneKind),
  toLane: Schema.optionalKey(ReviewRawLaneKind),
});
export type ReviewRawMutationLaneTransition = typeof ReviewRawMutationLaneTransition.Type;

export const ReviewRawMutationSelectionStatus = Schema.Literals(["applied", "outdated"]);
export type ReviewRawMutationSelectionStatus = typeof ReviewRawMutationSelectionStatus.Type;

export const ReviewApplyRawMutationResult = Schema.Struct({
  sessionId: ReviewSessionId,
  action: ReviewRawMutationAction,
  targetKind: ReviewRawMutationTargetKind,
  confirmation: ReviewShortText,
  selectionStatus: ReviewRawMutationSelectionStatus,
  changedPaths: Schema.Array(ReviewNormalizedPath),
  laneTransitions: Schema.Array(ReviewRawMutationLaneTransition),
  generatedInverseEdit: Schema.Boolean,
  refreshRequired: Schema.Boolean,
});
export type ReviewApplyRawMutationResult = typeof ReviewApplyRawMutationResult.Type;

export class ReviewRpcError extends Schema.TaggedErrorClass<ReviewRpcError>()("ReviewRpcError", {
  message: Schema.String,
  cause: Schema.optional(Schema.Defect),
}) {}

export class ReviewMutationConflictError extends Schema.TaggedErrorClass<ReviewMutationConflictError>()(
  "ReviewMutationConflictError",
  {
    reason: Schema.Literal("refresh-needed"),
    message: Schema.String,
    sessionId: ReviewSessionId,
    action: ReviewRawMutationAction,
    targetKind: ReviewRawMutationTargetKind,
    normalizedPath: Schema.optional(ReviewNormalizedPath),
    lane: Schema.optional(ReviewRawLaneKind),
    chunkId: Schema.optional(ReviewChunkId),
  },
) {}

export class ReviewActionBlockedError extends Schema.TaggedErrorClass<ReviewActionBlockedError>()(
  "ReviewActionBlockedError",
  {
    reason: ReviewActionBlockedReason,
    message: Schema.String,
  },
) {}

export const ReviewStreamEvent = Schema.Union([
  Schema.TaggedStruct("sessionSummaryReplaced", {
    summary: ReviewSessionSummary,
  }),
  Schema.TaggedStruct("sessionSnapshotReplaced", {
    snapshot: ReviewSessionSnapshot,
  }),
  Schema.TaggedStruct("localThreadUpserted", {
    thread: ReviewLocalAnnotationThread,
  }),
  Schema.TaggedStruct("localReplyCreated", {
    reply: ReviewLocalAnnotationReply,
  }),
  Schema.TaggedStruct("localThreadDeleted", {
    sessionId: ReviewSessionId,
    threadId: ReviewLocalAnnotationThreadId,
  }),
  Schema.TaggedStruct("localReplyDeleted", {
    sessionId: ReviewSessionId,
    replyId: ReviewLocalAnnotationReplyId,
  }),
  Schema.TaggedStruct("overviewNoteUpserted", {
    note: ReviewOverviewNote,
  }),
  Schema.TaggedStruct("overviewNoteDeleted", {
    sessionId: ReviewSessionId,
    noteId: ReviewOverviewNoteId,
  }),
  Schema.TaggedStruct("progressUpdated", {
    sessionId: ReviewSessionId,
    fileId: Schema.optionalKey(ReviewFileId),
    chunkId: Schema.optionalKey(ReviewChunkId),
    threadId: Schema.optionalKey(ReviewLocalAnnotationThreadId),
    overviewNoteId: Schema.optionalKey(ReviewOverviewNoteId),
    progressState: ReviewProgressState,
  }),
  Schema.TaggedStruct("analysisArtifactUpdated", {
    artifact: ReviewAnalysisArtifact,
  }),
  Schema.TaggedStruct("githubSnapshotUpdated", {
    snapshot: GitHubReviewSnapshot,
  }),
  Schema.TaggedStruct("degradedStateChanged", {
    sessionId: ReviewSessionId,
    reasons: Schema.Array(ReviewDegradedStateReason),
  }),
]);
export type ReviewStreamEvent = typeof ReviewStreamEvent.Type;
