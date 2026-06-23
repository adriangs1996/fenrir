import * as Rpc from "effect/unstable/rpc/Rpc";

import { GitCommandError } from "../git";
import {
  AmendGitDiffStagedChangesInput,
  AmendGitDiffStagedChangesResult,
  CommentGitDiffChangeRequestLinesInput,
  CreateGitDiffIgnoreListInput,
  CreateGitDiffReviewNoteInput,
  CreateGitDiffStashInput,
  CreateGitDiffStashResult,
  DeleteGitDiffIgnoreListInput,
  DeleteGitDiffReviewNoteInput,
  DiscardGitDiffWorktreeChangesInput,
  DiscardGitDiffWorktreeChangesResult,
  DiscardGitDiffWorktreeHunkInput,
  DiscardGitDiffWorktreeHunkResult,
  GitDiffActionResult,
  GitDiffChangeRequestReferenceInput,
  GitDiffCommitActionResult,
  GitDiffCommitReferenceInput,
  GitDiffMergeChangeRequestInput,
  GitDiffOperationActionInput,
  GitDiffOperationActionResult,
  GitDiffReviewNote,
  GitDiffStashReferenceInput,
  LoadActiveChangeRequestStackedDiffFileIndexInput,
  LoadActiveChangeRequestStackedDiffFileIndexResult,
  LoadDiffFileInput,
  LoadDiffFileIndexInput,
  LoadDiffFileIndexResult,
  LoadDiffFileResult,
  LoadGitDiffChangeSignatureInput,
  LoadGitDiffChangeSignatureResult,
  LoadGitDiffChangeRequestChecksInput,
  LoadGitDiffChangeRequestChecksResult,
  LoadGitDiffChangeRequestReviewThreadsInput,
  LoadGitDiffChangeRequestReviewThreadsResult,
  LoadGitDiffHistoryInput,
  LoadGitDiffHistoryResult,
  LoadGitDiffIgnoreListsInput,
  LoadGitDiffIgnoreListsResult,
  LoadGitDiffOperationInput,
  LoadGitDiffOperationResult,
  LoadGitDiffRepositoriesInput,
  LoadGitDiffRepositoriesResult,
  LoadGitDiffReviewNotesInput,
  LoadGitDiffReviewNotesResult,
  LoadGitDiffReviewSessionInput,
  LoadGitDiffReviewSessionResult,
  LoadGitDiffStashesInput,
  LoadGitDiffStashesResult,
  LoadStackedDiffFileIndexInput,
  LoadStackedDiffFileIndexResult,
  RequestGitDiffReviewNavigationInput,
  RevertGitDiffChangeRequestLinesInput,
  RevertGitDiffChangeRequestLinesResult,
  StageGitDiffWorktreeChangesInput,
  StageGitDiffWorktreeChangesResult,
  UnstageGitDiffStagedChangesInput,
  UnstageGitDiffStagedChangesResult,
  UpdateGitDiffIgnoreListInput,
  UpdateGitDiffReviewSessionInput,
} from "../gitDiff";
import { WS_METHODS } from "./methods";

export const WsGitDiffLoadFileIndexRpc = Rpc.make(WS_METHODS.gitDiffLoadFileIndex, {
  payload: LoadDiffFileIndexInput,
  success: LoadDiffFileIndexResult,
  error: GitCommandError,
});

export const WsGitDiffLoadChangeSignatureRpc = Rpc.make(WS_METHODS.gitDiffLoadChangeSignature, {
  payload: LoadGitDiffChangeSignatureInput,
  success: LoadGitDiffChangeSignatureResult,
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

export const WsGitDiffLoadHistoryRpc = Rpc.make(WS_METHODS.gitDiffLoadHistory, {
  payload: LoadGitDiffHistoryInput,
  success: LoadGitDiffHistoryResult,
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

export const WsGitDiffLoadReviewNotesRpc = Rpc.make(WS_METHODS.gitDiffLoadReviewNotes, {
  payload: LoadGitDiffReviewNotesInput,
  success: LoadGitDiffReviewNotesResult,
  error: GitCommandError,
});

export const WsGitDiffCreateReviewNoteRpc = Rpc.make(WS_METHODS.gitDiffCreateReviewNote, {
  payload: CreateGitDiffReviewNoteInput,
  success: GitDiffReviewNote,
  error: GitCommandError,
});

export const WsGitDiffDeleteReviewNoteRpc = Rpc.make(WS_METHODS.gitDiffDeleteReviewNote, {
  payload: DeleteGitDiffReviewNoteInput,
  success: GitDiffActionResult,
  error: GitCommandError,
});

export const WsGitDiffUpdateReviewSessionRpc = Rpc.make(WS_METHODS.gitDiffUpdateReviewSession, {
  payload: UpdateGitDiffReviewSessionInput,
  success: GitDiffActionResult,
  error: GitCommandError,
});

export const WsGitDiffLoadReviewSessionRpc = Rpc.make(WS_METHODS.gitDiffLoadReviewSession, {
  payload: LoadGitDiffReviewSessionInput,
  success: LoadGitDiffReviewSessionResult,
  error: GitCommandError,
});

export const WsGitDiffRequestReviewNavigationRpc = Rpc.make(
  WS_METHODS.gitDiffRequestReviewNavigation,
  {
    payload: RequestGitDiffReviewNavigationInput,
    success: GitDiffActionResult,
    error: GitCommandError,
  },
);

export const WsGitDiffStageWorktreeChangesRpc = Rpc.make(WS_METHODS.gitDiffStageWorktreeChanges, {
  payload: StageGitDiffWorktreeChangesInput,
  success: StageGitDiffWorktreeChangesResult,
  error: GitCommandError,
});

export const WsGitDiffUnstageStagedChangesRpc = Rpc.make(WS_METHODS.gitDiffUnstageStagedChanges, {
  payload: UnstageGitDiffStagedChangesInput,
  success: UnstageGitDiffStagedChangesResult,
  error: GitCommandError,
});

export const WsGitDiffDiscardWorktreeChangesRpc = Rpc.make(
  WS_METHODS.gitDiffDiscardWorktreeChanges,
  {
    payload: DiscardGitDiffWorktreeChangesInput,
    success: DiscardGitDiffWorktreeChangesResult,
    error: GitCommandError,
  },
);

export const WsGitDiffDiscardWorktreeHunkRpc = Rpc.make(WS_METHODS.gitDiffDiscardWorktreeHunk, {
  payload: DiscardGitDiffWorktreeHunkInput,
  success: DiscardGitDiffWorktreeHunkResult,
  error: GitCommandError,
});

export const WsGitDiffAmendStagedChangesRpc = Rpc.make(WS_METHODS.gitDiffAmendStagedChanges, {
  payload: AmendGitDiffStagedChangesInput,
  success: AmendGitDiffStagedChangesResult,
  error: GitCommandError,
});

export const WsGitDiffRevertCommitRpc = Rpc.make(WS_METHODS.gitDiffRevertCommit, {
  payload: GitDiffCommitReferenceInput,
  success: GitDiffCommitActionResult,
  error: GitCommandError,
});

export const WsGitDiffCherryPickCommitRpc = Rpc.make(WS_METHODS.gitDiffCherryPickCommit, {
  payload: GitDiffCommitReferenceInput,
  success: GitDiffCommitActionResult,
  error: GitCommandError,
});

export const WsGitDiffLoadOperationRpc = Rpc.make(WS_METHODS.gitDiffLoadOperation, {
  payload: LoadGitDiffOperationInput,
  success: LoadGitDiffOperationResult,
  error: GitCommandError,
});

export const WsGitDiffContinueOperationRpc = Rpc.make(WS_METHODS.gitDiffContinueOperation, {
  payload: GitDiffOperationActionInput,
  success: GitDiffOperationActionResult,
  error: GitCommandError,
});

export const WsGitDiffAbortOperationRpc = Rpc.make(WS_METHODS.gitDiffAbortOperation, {
  payload: GitDiffOperationActionInput,
  success: GitDiffOperationActionResult,
  error: GitCommandError,
});

export const WsGitDiffLoadStashesRpc = Rpc.make(WS_METHODS.gitDiffLoadStashes, {
  payload: LoadGitDiffStashesInput,
  success: LoadGitDiffStashesResult,
  error: GitCommandError,
});

export const WsGitDiffCreateStashRpc = Rpc.make(WS_METHODS.gitDiffCreateStash, {
  payload: CreateGitDiffStashInput,
  success: CreateGitDiffStashResult,
  error: GitCommandError,
});

export const WsGitDiffApplyStashRpc = Rpc.make(WS_METHODS.gitDiffApplyStash, {
  payload: GitDiffStashReferenceInput,
  success: GitDiffActionResult,
  error: GitCommandError,
});

export const WsGitDiffPopStashRpc = Rpc.make(WS_METHODS.gitDiffPopStash, {
  payload: GitDiffStashReferenceInput,
  success: GitDiffActionResult,
  error: GitCommandError,
});

export const WsGitDiffDropStashRpc = Rpc.make(WS_METHODS.gitDiffDropStash, {
  payload: GitDiffStashReferenceInput,
  success: GitDiffActionResult,
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
