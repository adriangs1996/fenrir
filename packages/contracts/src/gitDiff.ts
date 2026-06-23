import { Effect, Schema } from "effect";
import { NonNegativeInt, PositiveInt, TrimmedNonEmptyString } from "./baseSchemas";
import {
  ChangeRequest,
  ChangeRequestCheck,
  ChangeRequestLineSide,
  ChangeRequestReviewThread,
} from "./sourceControl";

export const DiffTarget = Schema.Union([
  Schema.Struct({
    kind: Schema.Literal("worktree"),
  }),
  Schema.Struct({
    kind: Schema.Literal("staged"),
  }),
  Schema.Struct({
    kind: Schema.Literal("range"),
    baseRef: TrimmedNonEmptyString,
    headRef: TrimmedNonEmptyString,
  }),
  Schema.Struct({
    kind: Schema.Literal("commit"),
    commitRef: TrimmedNonEmptyString,
    parentRef: Schema.NullOr(TrimmedNonEmptyString),
  }),
  Schema.Struct({
    kind: Schema.Literal("stash"),
    ref: TrimmedNonEmptyString,
  }),
]);
export type DiffTarget = typeof DiffTarget.Type;

export const LoadGitDiffRepositoriesInput = Schema.Struct({
  workspaceCwd: TrimmedNonEmptyString,
});
export type LoadGitDiffRepositoriesInput = typeof LoadGitDiffRepositoriesInput.Type;

export const GitDiffRepository = Schema.Struct({
  cwd: TrimmedNonEmptyString,
  relativePath: Schema.String,
  name: TrimmedNonEmptyString,
  isWorkspaceRoot: Schema.Boolean,
});
export type GitDiffRepository = typeof GitDiffRepository.Type;

export const LoadGitDiffRepositoriesResult = Schema.Array(GitDiffRepository);
export type LoadGitDiffRepositoriesResult = typeof LoadGitDiffRepositoriesResult.Type;

export const LoadDiffFileIndexInput = Schema.Struct({
  cwd: TrimmedNonEmptyString,
  target: DiffTarget,
  detectRenames: Schema.Boolean,
  detectCopies: Schema.Boolean,
});
export type LoadDiffFileIndexInput = typeof LoadDiffFileIndexInput.Type;

export const GitDiffHunkSummary = Schema.Struct({
  index: NonNegativeInt,
  header: TrimmedNonEmptyString,
  oldStart: NonNegativeInt,
  oldLines: NonNegativeInt,
  newStart: NonNegativeInt,
  newLines: NonNegativeInt,
});
export type GitDiffHunkSummary = typeof GitDiffHunkSummary.Type;

export const GitDiffFileSummary = Schema.Struct({
  path: TrimmedNonEmptyString,
  previousPath: Schema.NullOr(TrimmedNonEmptyString),
  insertions: NonNegativeInt,
  deletions: NonNegativeInt,
  binary: Schema.Boolean,
  isUntracked: Schema.Boolean.pipe(Schema.withDecodingDefault(Effect.succeed(false))),
  isTooLarge: Schema.Boolean.pipe(Schema.withDecodingDefault(Effect.succeed(false))),
  statsTruncated: Schema.Boolean.pipe(Schema.withDecodingDefault(Effect.succeed(false))),
  hunkCount: NonNegativeInt.pipe(Schema.withDecodingDefault(Effect.succeed(0))),
  hunks: Schema.Array(GitDiffHunkSummary).pipe(Schema.withDecodingDefault(Effect.succeed([]))),
});
export type GitDiffFileSummary = typeof GitDiffFileSummary.Type;

export const LoadDiffFileIndexResult = Schema.Array(GitDiffFileSummary);
export type LoadDiffFileIndexResult = typeof LoadDiffFileIndexResult.Type;

export const LoadGitDiffChangeSignatureInput = Schema.Struct({
  cwd: TrimmedNonEmptyString,
  target: DiffTarget,
});
export type LoadGitDiffChangeSignatureInput = typeof LoadGitDiffChangeSignatureInput.Type;

export const LoadGitDiffChangeSignatureResult = Schema.Struct({
  signature: TrimmedNonEmptyString,
});
export type LoadGitDiffChangeSignatureResult = typeof LoadGitDiffChangeSignatureResult.Type;

export const LoadDiffFileInput = Schema.Struct({
  cwd: TrimmedNonEmptyString,
  target: DiffTarget,
  path: TrimmedNonEmptyString,
  previousPath: Schema.NullOr(TrimmedNonEmptyString),
  detectRenames: Schema.Boolean,
  detectCopies: Schema.Boolean,
});
export type LoadDiffFileInput = typeof LoadDiffFileInput.Type;

export const GitDiffFileContent = Schema.Struct({
  path: TrimmedNonEmptyString,
  contents: Schema.String,
});
export type GitDiffFileContent = typeof GitDiffFileContent.Type;

export const LoadDiffFileResult = Schema.Struct({
  path: TrimmedNonEmptyString,
  previousPath: Schema.NullOr(TrimmedNonEmptyString),
  oldFile: Schema.NullOr(GitDiffFileContent),
  newFile: Schema.NullOr(GitDiffFileContent),
  patch: Schema.String,
  patchTruncated: Schema.Boolean.pipe(Schema.withDecodingDefault(Effect.succeed(false))),
  oldFileTooLarge: Schema.Boolean.pipe(Schema.withDecodingDefault(Effect.succeed(false))),
  newFileTooLarge: Schema.Boolean.pipe(Schema.withDecodingDefault(Effect.succeed(false))),
});
export type LoadDiffFileResult = typeof LoadDiffFileResult.Type;

export const LoadStackedDiffFileIndexInput = Schema.Struct({
  cwd: TrimmedNonEmptyString,
  baseRef: TrimmedNonEmptyString,
  headRef: TrimmedNonEmptyString,
  detectRenames: Schema.Boolean,
  detectCopies: Schema.Boolean,
});
export type LoadStackedDiffFileIndexInput = typeof LoadStackedDiffFileIndexInput.Type;

export const GitDiffStackStep = Schema.Struct({
  index: PositiveInt,
  branchName: TrimmedNonEmptyString,
  baseRef: TrimmedNonEmptyString,
  headRef: TrimmedNonEmptyString,
  changeRequest: Schema.optionalKey(ChangeRequest),
  files: Schema.Array(GitDiffFileSummary),
});
export type GitDiffStackStep = typeof GitDiffStackStep.Type;

export const LoadStackedDiffFileIndexResult = Schema.Struct({
  baseRef: TrimmedNonEmptyString,
  headRef: TrimmedNonEmptyString,
  steps: Schema.Array(GitDiffStackStep),
});
export type LoadStackedDiffFileIndexResult = typeof LoadStackedDiffFileIndexResult.Type;

export const GitDiffCommit = Schema.Struct({
  sha: TrimmedNonEmptyString,
  shortSha: TrimmedNonEmptyString,
  parentSha: Schema.NullOr(TrimmedNonEmptyString),
  subject: TrimmedNonEmptyString,
  authorName: TrimmedNonEmptyString,
  authorEmail: TrimmedNonEmptyString,
  authoredAt: TrimmedNonEmptyString,
});
export type GitDiffCommit = typeof GitDiffCommit.Type;

export const LoadGitDiffHistoryInput = Schema.Struct({
  cwd: TrimmedNonEmptyString,
  limit: Schema.optionalKey(PositiveInt.check(Schema.isLessThanOrEqualTo(200))),
});
export type LoadGitDiffHistoryInput = typeof LoadGitDiffHistoryInput.Type;

export const LoadGitDiffHistoryResult = Schema.Array(GitDiffCommit);
export type LoadGitDiffHistoryResult = typeof LoadGitDiffHistoryResult.Type;

export const LoadActiveChangeRequestStackedDiffFileIndexInput = Schema.Struct({
  cwd: TrimmedNonEmptyString,
  detectRenames: Schema.Boolean,
  detectCopies: Schema.Boolean,
});
export type LoadActiveChangeRequestStackedDiffFileIndexInput =
  typeof LoadActiveChangeRequestStackedDiffFileIndexInput.Type;

export const LoadActiveChangeRequestStackedDiffFileIndexResult = Schema.Struct({
  activeChangeRequest: Schema.NullOr(ChangeRequest),
  baseRef: Schema.NullOr(TrimmedNonEmptyString),
  headRef: Schema.NullOr(TrimmedNonEmptyString),
  steps: Schema.Array(GitDiffStackStep),
});
export type LoadActiveChangeRequestStackedDiffFileIndexResult =
  typeof LoadActiveChangeRequestStackedDiffFileIndexResult.Type;

export const GitDiffIgnoreList = Schema.Struct({
  id: TrimmedNonEmptyString,
  name: TrimmedNonEmptyString,
  filePaths: Schema.Array(TrimmedNonEmptyString),
});
export type GitDiffIgnoreList = typeof GitDiffIgnoreList.Type;

export const GitDiffReviewNoteSource = Schema.Literals(["agent", "ai", "user"]);
export type GitDiffReviewNoteSource = typeof GitDiffReviewNoteSource.Type;

export const GitDiffReviewNoteSide = Schema.Literals(["additions", "deletions"]);
export type GitDiffReviewNoteSide = typeof GitDiffReviewNoteSide.Type;

export const GitDiffReviewNote = Schema.Struct({
  id: TrimmedNonEmptyString,
  targetKey: TrimmedNonEmptyString,
  path: TrimmedNonEmptyString,
  previousPath: Schema.NullOr(TrimmedNonEmptyString),
  side: GitDiffReviewNoteSide,
  line: PositiveInt,
  startLine: Schema.optionalKey(PositiveInt),
  hunkIndex: Schema.optionalKey(NonNegativeInt),
  body: TrimmedNonEmptyString.check(Schema.isMaxLength(20_000)),
  source: GitDiffReviewNoteSource,
  author: Schema.optionalKey(TrimmedNonEmptyString),
  createdAt: TrimmedNonEmptyString,
  updatedAt: TrimmedNonEmptyString,
});
export type GitDiffReviewNote = typeof GitDiffReviewNote.Type;

export const GitDiffReviewSessionFile = Schema.Struct({
  path: TrimmedNonEmptyString,
  previousPath: Schema.NullOr(TrimmedNonEmptyString),
  insertions: NonNegativeInt,
  deletions: NonNegativeInt,
  binary: Schema.Boolean,
  isUntracked: Schema.Boolean,
  hunkCount: NonNegativeInt,
  hunks: Schema.Array(GitDiffHunkSummary),
});
export type GitDiffReviewSessionFile = typeof GitDiffReviewSessionFile.Type;

export const GitDiffReviewSessionSelection = Schema.Struct({
  path: TrimmedNonEmptyString,
  previousPath: Schema.NullOr(TrimmedNonEmptyString),
  hunkIndex: Schema.NullOr(NonNegativeInt),
  side: Schema.NullOr(GitDiffReviewNoteSide),
  line: Schema.NullOr(PositiveInt),
  startLine: Schema.NullOr(PositiveInt),
});
export type GitDiffReviewSessionSelection = typeof GitDiffReviewSessionSelection.Type;

export const GitDiffReviewSessionSnapshot = Schema.Struct({
  cwd: TrimmedNonEmptyString,
  target: DiffTarget,
  targetKey: TrimmedNonEmptyString,
  title: TrimmedNonEmptyString,
  selectedPath: Schema.NullOr(TrimmedNonEmptyString),
  selectedHunkIndex: Schema.NullOr(NonNegativeInt),
  selectedLines: Schema.NullOr(GitDiffReviewSessionSelection),
  files: Schema.Array(GitDiffReviewSessionFile),
  updatedAt: TrimmedNonEmptyString,
});
export type GitDiffReviewSessionSnapshot = typeof GitDiffReviewSessionSnapshot.Type;

export const UpdateGitDiffReviewSessionInput = GitDiffReviewSessionSnapshot;
export type UpdateGitDiffReviewSessionInput = typeof UpdateGitDiffReviewSessionInput.Type;

export const LoadGitDiffReviewSessionInput = Schema.Struct({
  cwd: TrimmedNonEmptyString,
});
export type LoadGitDiffReviewSessionInput = typeof LoadGitDiffReviewSessionInput.Type;

export const LoadGitDiffReviewSessionResult = Schema.Struct({
  session: Schema.NullOr(GitDiffReviewSessionSnapshot),
});
export type LoadGitDiffReviewSessionResult = typeof LoadGitDiffReviewSessionResult.Type;

export const RequestGitDiffReviewNavigationInput = Schema.Struct({
  cwd: TrimmedNonEmptyString,
  path: TrimmedNonEmptyString,
  hunkIndex: Schema.optionalKey(NonNegativeInt),
  side: Schema.optionalKey(GitDiffReviewNoteSide),
  line: Schema.optionalKey(PositiveInt),
});
export type RequestGitDiffReviewNavigationInput = typeof RequestGitDiffReviewNavigationInput.Type;

export const LoadGitDiffIgnoreListsInput = Schema.Struct({
  cwd: TrimmedNonEmptyString,
});
export type LoadGitDiffIgnoreListsInput = typeof LoadGitDiffIgnoreListsInput.Type;

export const LoadGitDiffIgnoreListsResult = Schema.Array(GitDiffIgnoreList);
export type LoadGitDiffIgnoreListsResult = typeof LoadGitDiffIgnoreListsResult.Type;

export const LoadGitDiffReviewNotesInput = Schema.Struct({
  cwd: TrimmedNonEmptyString,
  target: DiffTarget,
});
export type LoadGitDiffReviewNotesInput = typeof LoadGitDiffReviewNotesInput.Type;

export const LoadGitDiffReviewNotesResult = Schema.Array(GitDiffReviewNote);
export type LoadGitDiffReviewNotesResult = typeof LoadGitDiffReviewNotesResult.Type;

export const CreateGitDiffIgnoreListInput = Schema.Struct({
  cwd: TrimmedNonEmptyString,
  name: TrimmedNonEmptyString,
});
export type CreateGitDiffIgnoreListInput = typeof CreateGitDiffIgnoreListInput.Type;

export const CreateGitDiffReviewNoteInput = Schema.Struct({
  cwd: TrimmedNonEmptyString,
  target: DiffTarget,
  path: TrimmedNonEmptyString,
  previousPath: Schema.NullOr(TrimmedNonEmptyString),
  side: GitDiffReviewNoteSide,
  line: PositiveInt,
  startLine: Schema.optionalKey(PositiveInt),
  hunkIndex: Schema.optionalKey(NonNegativeInt),
  body: TrimmedNonEmptyString.check(Schema.isMaxLength(20_000)),
  source: GitDiffReviewNoteSource,
  author: Schema.optionalKey(TrimmedNonEmptyString),
});
export type CreateGitDiffReviewNoteInput = typeof CreateGitDiffReviewNoteInput.Type;

export const DeleteGitDiffIgnoreListInput = Schema.Struct({
  cwd: TrimmedNonEmptyString,
  id: TrimmedNonEmptyString,
});
export type DeleteGitDiffIgnoreListInput = typeof DeleteGitDiffIgnoreListInput.Type;

export const DeleteGitDiffReviewNoteInput = Schema.Struct({
  cwd: TrimmedNonEmptyString,
  id: TrimmedNonEmptyString,
});
export type DeleteGitDiffReviewNoteInput = typeof DeleteGitDiffReviewNoteInput.Type;

export const UpdateGitDiffIgnoreListInput = Schema.Struct({
  cwd: TrimmedNonEmptyString,
  id: TrimmedNonEmptyString,
  name: Schema.optionalKey(TrimmedNonEmptyString),
  filePaths: Schema.optionalKey(Schema.Array(TrimmedNonEmptyString)),
});
export type UpdateGitDiffIgnoreListInput = typeof UpdateGitDiffIgnoreListInput.Type;

export const StageGitDiffWorktreeChangesInput = Schema.Struct({
  cwd: TrimmedNonEmptyString,
  filePaths: Schema.Array(TrimmedNonEmptyString),
  ignoredFilePaths: Schema.Array(TrimmedNonEmptyString),
});
export type StageGitDiffWorktreeChangesInput = typeof StageGitDiffWorktreeChangesInput.Type;

export const StageGitDiffWorktreeChangesResult = Schema.Struct({
  stagedFilePaths: Schema.Array(TrimmedNonEmptyString),
  ignoredFilePaths: Schema.Array(TrimmedNonEmptyString),
});
export type StageGitDiffWorktreeChangesResult = typeof StageGitDiffWorktreeChangesResult.Type;

export const UnstageGitDiffStagedChangesInput = Schema.Struct({
  cwd: TrimmedNonEmptyString,
  filePaths: Schema.Array(TrimmedNonEmptyString),
});
export type UnstageGitDiffStagedChangesInput = typeof UnstageGitDiffStagedChangesInput.Type;

export const UnstageGitDiffStagedChangesResult = Schema.Struct({
  unstagedFilePaths: Schema.Array(TrimmedNonEmptyString),
});
export type UnstageGitDiffStagedChangesResult = typeof UnstageGitDiffStagedChangesResult.Type;

export const DiscardGitDiffWorktreeChangesInput = Schema.Struct({
  cwd: TrimmedNonEmptyString,
  filePaths: Schema.Array(TrimmedNonEmptyString),
});
export type DiscardGitDiffWorktreeChangesInput = typeof DiscardGitDiffWorktreeChangesInput.Type;

export const DiscardGitDiffWorktreeChangesResult = Schema.Struct({
  discardedFilePaths: Schema.Array(TrimmedNonEmptyString),
});
export type DiscardGitDiffWorktreeChangesResult = typeof DiscardGitDiffWorktreeChangesResult.Type;

export const DiscardGitDiffWorktreeHunkInput = Schema.Struct({
  cwd: TrimmedNonEmptyString,
  path: TrimmedNonEmptyString,
  hunk: GitDiffHunkSummary,
});
export type DiscardGitDiffWorktreeHunkInput = typeof DiscardGitDiffWorktreeHunkInput.Type;

export const DiscardGitDiffWorktreeHunkResult = Schema.Struct({
  discardedFilePath: TrimmedNonEmptyString,
  hunk: GitDiffHunkSummary,
});
export type DiscardGitDiffWorktreeHunkResult = typeof DiscardGitDiffWorktreeHunkResult.Type;

export const AmendGitDiffStagedChangesInput = Schema.Struct({
  cwd: TrimmedNonEmptyString,
  filePaths: Schema.optionalKey(Schema.Array(TrimmedNonEmptyString)),
  commitMessage: Schema.optionalKey(TrimmedNonEmptyString.check(Schema.isMaxLength(10_000))),
});
export type AmendGitDiffStagedChangesInput = typeof AmendGitDiffStagedChangesInput.Type;

export const AmendGitDiffStagedChangesResult = Schema.Struct({
  commitSha: TrimmedNonEmptyString,
});
export type AmendGitDiffStagedChangesResult = typeof AmendGitDiffStagedChangesResult.Type;

export const GitDiffCommitReferenceInput = Schema.Struct({
  cwd: TrimmedNonEmptyString,
  commitRef: TrimmedNonEmptyString,
});
export type GitDiffCommitReferenceInput = typeof GitDiffCommitReferenceInput.Type;

export const GitDiffCommitActionResult = Schema.Struct({
  commitSha: TrimmedNonEmptyString,
});
export type GitDiffCommitActionResult = typeof GitDiffCommitActionResult.Type;

export const GitDiffRepositoryOperationKind = Schema.Literals([
  "merge",
  "rebase",
  "cherry_pick",
  "revert",
]);
export type GitDiffRepositoryOperationKind = typeof GitDiffRepositoryOperationKind.Type;

export const GitDiffRepositoryOperation = Schema.Struct({
  kind: GitDiffRepositoryOperationKind,
  label: TrimmedNonEmptyString,
  headRef: Schema.NullOr(TrimmedNonEmptyString),
  conflictedFilePaths: Schema.Array(TrimmedNonEmptyString),
});
export type GitDiffRepositoryOperation = typeof GitDiffRepositoryOperation.Type;

export const LoadGitDiffOperationInput = Schema.Struct({
  cwd: TrimmedNonEmptyString,
});
export type LoadGitDiffOperationInput = typeof LoadGitDiffOperationInput.Type;

export const LoadGitDiffOperationResult = Schema.Struct({
  operation: Schema.NullOr(GitDiffRepositoryOperation),
});
export type LoadGitDiffOperationResult = typeof LoadGitDiffOperationResult.Type;

export const GitDiffOperationActionInput = Schema.Struct({
  cwd: TrimmedNonEmptyString,
});
export type GitDiffOperationActionInput = typeof GitDiffOperationActionInput.Type;

export const GitDiffOperationActionResult = Schema.Struct({
  status: Schema.Literal("ok"),
  commitSha: Schema.NullOr(TrimmedNonEmptyString),
});
export type GitDiffOperationActionResult = typeof GitDiffOperationActionResult.Type;

export const GitDiffStash = Schema.Struct({
  ref: TrimmedNonEmptyString,
  sha: TrimmedNonEmptyString,
  message: TrimmedNonEmptyString,
  createdAt: TrimmedNonEmptyString,
  branchName: Schema.optionalKey(TrimmedNonEmptyString),
});
export type GitDiffStash = typeof GitDiffStash.Type;

export const LoadGitDiffStashesInput = Schema.Struct({
  cwd: TrimmedNonEmptyString,
});
export type LoadGitDiffStashesInput = typeof LoadGitDiffStashesInput.Type;

export const LoadGitDiffStashesResult = Schema.Array(GitDiffStash);
export type LoadGitDiffStashesResult = typeof LoadGitDiffStashesResult.Type;

export const CreateGitDiffStashInput = Schema.Struct({
  cwd: TrimmedNonEmptyString,
  message: Schema.optionalKey(TrimmedNonEmptyString.check(Schema.isMaxLength(10_000))),
  filePaths: Schema.optionalKey(Schema.Array(TrimmedNonEmptyString)),
});
export type CreateGitDiffStashInput = typeof CreateGitDiffStashInput.Type;

export const CreateGitDiffStashResult = Schema.Struct({
  status: Schema.Literals(["stashed", "skipped_no_changes"]),
  stash: Schema.NullOr(GitDiffStash),
});
export type CreateGitDiffStashResult = typeof CreateGitDiffStashResult.Type;

export const GitDiffStashReferenceInput = Schema.Struct({
  cwd: TrimmedNonEmptyString,
  ref: TrimmedNonEmptyString,
});
export type GitDiffStashReferenceInput = typeof GitDiffStashReferenceInput.Type;

export const GitDiffChangeRequestReferenceInput = Schema.Struct({
  cwd: TrimmedNonEmptyString,
  reference: TrimmedNonEmptyString,
});
export type GitDiffChangeRequestReferenceInput = typeof GitDiffChangeRequestReferenceInput.Type;

export const GitDiffActionResult = Schema.Struct({
  status: Schema.Literal("ok"),
});
export type GitDiffActionResult = typeof GitDiffActionResult.Type;

export const GitDiffMergeChangeRequestInput = Schema.Struct({
  cwd: TrimmedNonEmptyString,
  reference: TrimmedNonEmptyString,
  method: Schema.optionalKey(Schema.Literals(["merge", "squash", "rebase"])),
});
export type GitDiffMergeChangeRequestInput = typeof GitDiffMergeChangeRequestInput.Type;

export const LoadGitDiffChangeRequestChecksInput = GitDiffChangeRequestReferenceInput;
export type LoadGitDiffChangeRequestChecksInput = typeof LoadGitDiffChangeRequestChecksInput.Type;

export const LoadGitDiffChangeRequestChecksResult = Schema.Array(ChangeRequestCheck);
export type LoadGitDiffChangeRequestChecksResult = typeof LoadGitDiffChangeRequestChecksResult.Type;

export const LoadGitDiffChangeRequestReviewThreadsInput = GitDiffChangeRequestReferenceInput;
export type LoadGitDiffChangeRequestReviewThreadsInput =
  typeof LoadGitDiffChangeRequestReviewThreadsInput.Type;

export const LoadGitDiffChangeRequestReviewThreadsResult = Schema.Array(ChangeRequestReviewThread);
export type LoadGitDiffChangeRequestReviewThreadsResult =
  typeof LoadGitDiffChangeRequestReviewThreadsResult.Type;

export const CommentGitDiffChangeRequestLinesInput = Schema.Struct({
  cwd: TrimmedNonEmptyString,
  reference: TrimmedNonEmptyString,
  path: TrimmedNonEmptyString,
  body: TrimmedNonEmptyString.check(Schema.isMaxLength(20_000)),
  side: ChangeRequestLineSide,
  line: PositiveInt,
  startLine: Schema.optionalKey(PositiveInt),
});
export type CommentGitDiffChangeRequestLinesInput =
  typeof CommentGitDiffChangeRequestLinesInput.Type;

export const GitDiffSelectedLineRange = Schema.Struct({
  side: ChangeRequestLineSide,
  start: PositiveInt,
  end: PositiveInt,
});
export type GitDiffSelectedLineRange = typeof GitDiffSelectedLineRange.Type;

export const RevertGitDiffChangeRequestLinesInput = Schema.Struct({
  cwd: TrimmedNonEmptyString,
  reference: TrimmedNonEmptyString,
  baseRef: TrimmedNonEmptyString,
  headRef: TrimmedNonEmptyString,
  path: TrimmedNonEmptyString,
  previousPath: Schema.NullOr(TrimmedNonEmptyString),
  selection: GitDiffSelectedLineRange,
  commitMessage: Schema.optionalKey(TrimmedNonEmptyString.check(Schema.isMaxLength(10_000))),
});
export type RevertGitDiffChangeRequestLinesInput = typeof RevertGitDiffChangeRequestLinesInput.Type;

export const GitDiffPushResult = Schema.Struct({
  status: Schema.Literals(["pushed", "skipped_up_to_date"]),
  branch: TrimmedNonEmptyString,
  upstreamBranch: Schema.optionalKey(TrimmedNonEmptyString),
  setUpstream: Schema.optionalKey(Schema.Boolean),
});
export type GitDiffPushResult = typeof GitDiffPushResult.Type;

export const RevertGitDiffChangeRequestLinesResult = Schema.Struct({
  path: TrimmedNonEmptyString,
  commitSha: TrimmedNonEmptyString,
  push: GitDiffPushResult,
});
export type RevertGitDiffChangeRequestLinesResult =
  typeof RevertGitDiffChangeRequestLinesResult.Type;
