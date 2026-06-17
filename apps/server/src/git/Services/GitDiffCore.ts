import {
  GitCommandError,
  type AmendGitDiffStagedChangesInput,
  type AmendGitDiffStagedChangesResult,
  type CommentGitDiffChangeRequestLinesInput,
  type CreateGitDiffIgnoreListInput,
  type CreateGitDiffStashInput,
  type CreateGitDiffStashResult,
  type DeleteGitDiffIgnoreListInput,
  type DiscardGitDiffWorktreeChangesInput,
  type DiscardGitDiffWorktreeChangesResult,
  type GitDiffActionResult,
  type GitDiffChangeRequestReferenceInput,
  type GitDiffCommitActionResult,
  type GitDiffCommitReferenceInput,
  type GitDiffMergeChangeRequestInput,
  type GitDiffOperationActionInput,
  type GitDiffOperationActionResult,
  type GitDiffStashReferenceInput,
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
  type LoadGitDiffHistoryInput,
  type LoadGitDiffHistoryResult,
  type LoadGitDiffIgnoreListsInput,
  type LoadGitDiffIgnoreListsResult,
  type LoadGitDiffOperationInput,
  type LoadGitDiffOperationResult,
  type LoadGitDiffRepositoriesInput,
  type LoadGitDiffRepositoriesResult,
  type LoadGitDiffStashesInput,
  type LoadGitDiffStashesResult,
  type LoadStackedDiffFileIndexInput,
  type LoadStackedDiffFileIndexResult,
  type RevertGitDiffChangeRequestLinesInput,
  type RevertGitDiffChangeRequestLinesResult,
  type StageGitDiffWorktreeChangesInput,
  type StageGitDiffWorktreeChangesResult,
  type UnstageGitDiffStagedChangesInput,
  type UnstageGitDiffStagedChangesResult,
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
  readonly loadHistory: (
    input: LoadGitDiffHistoryInput,
  ) => Effect.Effect<LoadGitDiffHistoryResult, GitCommandError>;
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
  readonly unstageStagedChanges: (
    input: UnstageGitDiffStagedChangesInput,
  ) => Effect.Effect<UnstageGitDiffStagedChangesResult, GitCommandError>;
  readonly discardWorktreeChanges: (
    input: DiscardGitDiffWorktreeChangesInput,
  ) => Effect.Effect<DiscardGitDiffWorktreeChangesResult, GitCommandError>;
  readonly amendStagedChanges: (
    input: AmendGitDiffStagedChangesInput,
  ) => Effect.Effect<AmendGitDiffStagedChangesResult, GitCommandError>;
  readonly revertCommit: (
    input: GitDiffCommitReferenceInput,
  ) => Effect.Effect<GitDiffCommitActionResult, GitCommandError>;
  readonly cherryPickCommit: (
    input: GitDiffCommitReferenceInput,
  ) => Effect.Effect<GitDiffCommitActionResult, GitCommandError>;
  readonly loadOperation: (
    input: LoadGitDiffOperationInput,
  ) => Effect.Effect<LoadGitDiffOperationResult, GitCommandError>;
  readonly continueOperation: (
    input: GitDiffOperationActionInput,
  ) => Effect.Effect<GitDiffOperationActionResult, GitCommandError>;
  readonly abortOperation: (
    input: GitDiffOperationActionInput,
  ) => Effect.Effect<GitDiffOperationActionResult, GitCommandError>;
  readonly loadStashes: (
    input: LoadGitDiffStashesInput,
  ) => Effect.Effect<LoadGitDiffStashesResult, GitCommandError>;
  readonly createStash: (
    input: CreateGitDiffStashInput,
  ) => Effect.Effect<CreateGitDiffStashResult, GitCommandError>;
  readonly applyStash: (
    input: GitDiffStashReferenceInput,
  ) => Effect.Effect<GitDiffActionResult, GitCommandError>;
  readonly popStash: (
    input: GitDiffStashReferenceInput,
  ) => Effect.Effect<GitDiffActionResult, GitCommandError>;
  readonly dropStash: (
    input: GitDiffStashReferenceInput,
  ) => Effect.Effect<GitDiffActionResult, GitCommandError>;
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
