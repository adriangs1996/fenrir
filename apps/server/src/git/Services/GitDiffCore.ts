import {
  GitCommandError,
  type CommentGitDiffChangeRequestLinesInput,
  type CreateGitDiffIgnoreListInput,
  type DeleteGitDiffIgnoreListInput,
  type GitDiffActionResult,
  type GitDiffChangeRequestReferenceInput,
  type GitDiffMergeChangeRequestInput,
  type LoadActiveChangeRequestStackedDiffFileIndexInput,
  type LoadActiveChangeRequestStackedDiffFileIndexResult,
  type LoadDiffFileInput,
  type LoadDiffFileResult,
  type LoadDiffFileIndexInput,
  type LoadDiffFileIndexResult,
  type LoadGitDiffChangeRequestChecksInput,
  type LoadGitDiffChangeRequestChecksResult,
  type LoadGitDiffChangeRequestReviewThreadsInput,
  type LoadGitDiffChangeRequestReviewThreadsResult,
  type LoadGitDiffIgnoreListsInput,
  type LoadGitDiffIgnoreListsResult,
  type LoadGitDiffRepositoriesInput,
  type LoadGitDiffRepositoriesResult,
  type LoadStackedDiffFileIndexInput,
  type LoadStackedDiffFileIndexResult,
  type RevertGitDiffChangeRequestLinesInput,
  type RevertGitDiffChangeRequestLinesResult,
  type StageGitDiffWorktreeChangesInput,
  type StageGitDiffWorktreeChangesResult,
  type UpdateGitDiffIgnoreListInput,
} from "@fenrir/contracts";
import { Context } from "effect";
import type { Effect } from "effect";

export interface GitDiffCoreShape {
  readonly listRepositories: (
    input: LoadGitDiffRepositoriesInput,
  ) => Effect.Effect<LoadGitDiffRepositoriesResult, GitCommandError>;
  readonly loadDiffFile: (
    input: LoadDiffFileInput,
  ) => Effect.Effect<LoadDiffFileResult, GitCommandError>;
  readonly loadDiffFileIndex: (
    input: LoadDiffFileIndexInput,
  ) => Effect.Effect<LoadDiffFileIndexResult, GitCommandError>;
  readonly loadActiveChangeRequestStackedDiffFileIndex: (
    input: LoadActiveChangeRequestStackedDiffFileIndexInput,
  ) => Effect.Effect<LoadActiveChangeRequestStackedDiffFileIndexResult, GitCommandError>;
  readonly loadStackedDiffFileIndex: (
    input: LoadStackedDiffFileIndexInput,
  ) => Effect.Effect<LoadStackedDiffFileIndexResult, GitCommandError>;
  readonly loadIgnoreLists: (
    input: LoadGitDiffIgnoreListsInput,
  ) => Effect.Effect<LoadGitDiffIgnoreListsResult, GitCommandError>;
  readonly createIgnoreList: (
    input: CreateGitDiffIgnoreListInput,
  ) => Effect.Effect<LoadGitDiffIgnoreListsResult, GitCommandError>;
  readonly updateIgnoreList: (
    input: UpdateGitDiffIgnoreListInput,
  ) => Effect.Effect<LoadGitDiffIgnoreListsResult, GitCommandError>;
  readonly deleteIgnoreList: (
    input: DeleteGitDiffIgnoreListInput,
  ) => Effect.Effect<LoadGitDiffIgnoreListsResult, GitCommandError>;
  readonly stageWorktreeChanges: (
    input: StageGitDiffWorktreeChangesInput,
  ) => Effect.Effect<StageGitDiffWorktreeChangesResult, GitCommandError>;
  readonly closeChangeRequest: (
    input: GitDiffChangeRequestReferenceInput,
  ) => Effect.Effect<GitDiffActionResult, GitCommandError>;
  readonly mergeChangeRequest: (
    input: GitDiffMergeChangeRequestInput,
  ) => Effect.Effect<GitDiffActionResult, GitCommandError>;
  readonly loadChangeRequestChecks: (
    input: LoadGitDiffChangeRequestChecksInput,
  ) => Effect.Effect<LoadGitDiffChangeRequestChecksResult, GitCommandError>;
  readonly loadChangeRequestReviewThreads: (
    input: LoadGitDiffChangeRequestReviewThreadsInput,
  ) => Effect.Effect<LoadGitDiffChangeRequestReviewThreadsResult, GitCommandError>;
  readonly commentChangeRequestLines: (
    input: CommentGitDiffChangeRequestLinesInput,
  ) => Effect.Effect<GitDiffActionResult, GitCommandError>;
  readonly revertChangeRequestLines: (
    input: RevertGitDiffChangeRequestLinesInput,
  ) => Effect.Effect<RevertGitDiffChangeRequestLinesResult, GitCommandError>;
}

export class GitDiffCore extends Context.Service<GitDiffCore, GitDiffCoreShape>()(
  "fenrir/git/Services/GitDiffCore",
) {}
