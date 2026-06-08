import { Schema } from "effect";
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

export const GitDiffFileSummary = Schema.Struct({
  path: TrimmedNonEmptyString,
  previousPath: Schema.NullOr(TrimmedNonEmptyString),
  insertions: NonNegativeInt,
  deletions: NonNegativeInt,
  binary: Schema.Boolean,
});
export type GitDiffFileSummary = typeof GitDiffFileSummary.Type;

export const LoadDiffFileIndexResult = Schema.Array(GitDiffFileSummary);
export type LoadDiffFileIndexResult = typeof LoadDiffFileIndexResult.Type;

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

export const LoadGitDiffIgnoreListsInput = Schema.Struct({
  cwd: TrimmedNonEmptyString,
});
export type LoadGitDiffIgnoreListsInput = typeof LoadGitDiffIgnoreListsInput.Type;

export const LoadGitDiffIgnoreListsResult = Schema.Array(GitDiffIgnoreList);
export type LoadGitDiffIgnoreListsResult = typeof LoadGitDiffIgnoreListsResult.Type;

export const CreateGitDiffIgnoreListInput = Schema.Struct({
  cwd: TrimmedNonEmptyString,
  name: TrimmedNonEmptyString,
});
export type CreateGitDiffIgnoreListInput = typeof CreateGitDiffIgnoreListInput.Type;

export const DeleteGitDiffIgnoreListInput = Schema.Struct({
  cwd: TrimmedNonEmptyString,
  id: TrimmedNonEmptyString,
});
export type DeleteGitDiffIgnoreListInput = typeof DeleteGitDiffIgnoreListInput.Type;

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
