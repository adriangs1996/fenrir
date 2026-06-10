import * as Rpc from "effect/unstable/rpc/Rpc";

import { GitCommandError } from "../git";
import {
  CommentGitDiffChangeRequestLinesInput,
  CreateGitDiffIgnoreListInput,
  DeleteGitDiffIgnoreListInput,
  GitDiffActionResult,
  GitDiffChangeRequestReferenceInput,
  GitDiffMergeChangeRequestInput,
  LoadActiveChangeRequestStackedDiffFileIndexInput,
  LoadActiveChangeRequestStackedDiffFileIndexResult,
  LoadDiffFileInput,
  LoadDiffFileIndexInput,
  LoadDiffFileIndexResult,
  LoadDiffFileResult,
  LoadGitDiffChangeRequestChecksInput,
  LoadGitDiffChangeRequestChecksResult,
  LoadGitDiffChangeRequestReviewThreadsInput,
  LoadGitDiffChangeRequestReviewThreadsResult,
  LoadGitDiffIgnoreListsInput,
  LoadGitDiffIgnoreListsResult,
  LoadGitDiffRepositoriesInput,
  LoadGitDiffRepositoriesResult,
  LoadStackedDiffFileIndexInput,
  LoadStackedDiffFileIndexResult,
  RevertGitDiffChangeRequestLinesInput,
  RevertGitDiffChangeRequestLinesResult,
  StageGitDiffWorktreeChangesInput,
  StageGitDiffWorktreeChangesResult,
  UpdateGitDiffIgnoreListInput,
} from "../gitDiff";
import { WS_METHODS } from "./methods";

export const WsGitDiffLoadFileIndexRpc = Rpc.make(WS_METHODS.gitDiffLoadFileIndex, {
  payload: LoadDiffFileIndexInput,
  success: LoadDiffFileIndexResult,
  error: GitCommandError,
});

export const WsGitDiffListRepositoriesRpc = Rpc.make(WS_METHODS.gitDiffListRepositories, {
  payload: LoadGitDiffRepositoriesInput,
  success: LoadGitDiffRepositoriesResult,
  error: GitCommandError,
});

export const WsGitDiffLoadFileRpc = Rpc.make(WS_METHODS.gitDiffLoadFile, {
  payload: LoadDiffFileInput,
  success: LoadDiffFileResult,
  error: GitCommandError,
});

export const WsGitDiffLoadStackedFileIndexRpc = Rpc.make(WS_METHODS.gitDiffLoadStackedFileIndex, {
  payload: LoadStackedDiffFileIndexInput,
  success: LoadStackedDiffFileIndexResult,
  error: GitCommandError,
});

export const WsGitDiffLoadActiveChangeRequestStackedFileIndexRpc = Rpc.make(
  WS_METHODS.gitDiffLoadActiveChangeRequestStackedFileIndex,
  {
    payload: LoadActiveChangeRequestStackedDiffFileIndexInput,
    success: LoadActiveChangeRequestStackedDiffFileIndexResult,
    error: GitCommandError,
  },
);

export const WsGitDiffLoadIgnoreListsRpc = Rpc.make(WS_METHODS.gitDiffLoadIgnoreLists, {
  payload: LoadGitDiffIgnoreListsInput,
  success: LoadGitDiffIgnoreListsResult,
  error: GitCommandError,
});

export const WsGitDiffCreateIgnoreListRpc = Rpc.make(WS_METHODS.gitDiffCreateIgnoreList, {
  payload: CreateGitDiffIgnoreListInput,
  success: LoadGitDiffIgnoreListsResult,
  error: GitCommandError,
});

export const WsGitDiffUpdateIgnoreListRpc = Rpc.make(WS_METHODS.gitDiffUpdateIgnoreList, {
  payload: UpdateGitDiffIgnoreListInput,
  success: LoadGitDiffIgnoreListsResult,
  error: GitCommandError,
});

export const WsGitDiffDeleteIgnoreListRpc = Rpc.make(WS_METHODS.gitDiffDeleteIgnoreList, {
  payload: DeleteGitDiffIgnoreListInput,
  success: LoadGitDiffIgnoreListsResult,
  error: GitCommandError,
});

export const WsGitDiffStageWorktreeChangesRpc = Rpc.make(WS_METHODS.gitDiffStageWorktreeChanges, {
  payload: StageGitDiffWorktreeChangesInput,
  success: StageGitDiffWorktreeChangesResult,
  error: GitCommandError,
});

export const WsGitDiffCloseChangeRequestRpc = Rpc.make(WS_METHODS.gitDiffCloseChangeRequest, {
  payload: GitDiffChangeRequestReferenceInput,
  success: GitDiffActionResult,
  error: GitCommandError,
});

export const WsGitDiffMergeChangeRequestRpc = Rpc.make(WS_METHODS.gitDiffMergeChangeRequest, {
  payload: GitDiffMergeChangeRequestInput,
  success: GitDiffActionResult,
  error: GitCommandError,
});

export const WsGitDiffLoadChangeRequestChecksRpc = Rpc.make(
  WS_METHODS.gitDiffLoadChangeRequestChecks,
  {
    payload: LoadGitDiffChangeRequestChecksInput,
    success: LoadGitDiffChangeRequestChecksResult,
    error: GitCommandError,
  },
);

export const WsGitDiffLoadChangeRequestReviewThreadsRpc = Rpc.make(
  WS_METHODS.gitDiffLoadChangeRequestReviewThreads,
  {
    payload: LoadGitDiffChangeRequestReviewThreadsInput,
    success: LoadGitDiffChangeRequestReviewThreadsResult,
    error: GitCommandError,
  },
);

export const WsGitDiffCommentChangeRequestLinesRpc = Rpc.make(
  WS_METHODS.gitDiffCommentChangeRequestLines,
  {
    payload: CommentGitDiffChangeRequestLinesInput,
    success: GitDiffActionResult,
    error: GitCommandError,
  },
);

export const WsGitDiffRevertChangeRequestLinesRpc = Rpc.make(
  WS_METHODS.gitDiffRevertChangeRequestLines,
  {
    payload: RevertGitDiffChangeRequestLinesInput,
    success: RevertGitDiffChangeRequestLinesResult,
    error: GitCommandError,
  },
);
