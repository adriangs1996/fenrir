import { Effect } from "effect";

import { WS_METHODS } from "@fenrir/contracts";

import { GitDiffCore } from "../../git/Services/GitDiffCore";
import { makeRpcDomain } from "../handlers";
import type { RefreshGitStatus } from "../shared";

export const makeGitDiffRoutes = (deps: { readonly refreshGitStatus: RefreshGitStatus }) =>
  Effect.gen(function* () {
    const { refreshGitStatus } = deps;
    const gitDiffCore = yield* GitDiffCore;

    const gitDiff = makeRpcDomain("git-diff");

    return {
      [WS_METHODS.gitDiffListRepositories]: gitDiff.effect(
        WS_METHODS.gitDiffListRepositories,
        (input) => gitDiffCore.listRepositories(input),
      ),
      [WS_METHODS.gitDiffLoadFileIndex]: gitDiff.effect(WS_METHODS.gitDiffLoadFileIndex, (input) =>
        gitDiffCore.loadDiffFileIndex(input),
      ),
      [WS_METHODS.gitDiffLoadChangeSignature]: gitDiff.effect(
        WS_METHODS.gitDiffLoadChangeSignature,
        (input) => gitDiffCore.loadChangeSignature(input),
      ),
      [WS_METHODS.gitDiffLoadFile]: gitDiff.effect(WS_METHODS.gitDiffLoadFile, (input) =>
        gitDiffCore.loadDiffFile(input),
      ),
      [WS_METHODS.gitDiffLoadActiveChangeRequestStackedFileIndex]: gitDiff.effect(
        WS_METHODS.gitDiffLoadActiveChangeRequestStackedFileIndex,
        (input) => gitDiffCore.loadActiveChangeRequestStackedDiffFileIndex(input),
      ),
      [WS_METHODS.gitDiffLoadStackedFileIndex]: gitDiff.effect(
        WS_METHODS.gitDiffLoadStackedFileIndex,
        (input) => gitDiffCore.loadStackedDiffFileIndex(input),
      ),
      [WS_METHODS.gitDiffLoadHistory]: gitDiff.effect(WS_METHODS.gitDiffLoadHistory, (input) =>
        gitDiffCore.loadHistory(input),
      ),
      [WS_METHODS.gitDiffLoadIgnoreLists]: gitDiff.effect(
        WS_METHODS.gitDiffLoadIgnoreLists,
        (input) => gitDiffCore.loadIgnoreLists(input),
      ),
      [WS_METHODS.gitDiffCreateIgnoreList]: gitDiff.effect(
        WS_METHODS.gitDiffCreateIgnoreList,
        (input) => gitDiffCore.createIgnoreList(input),
      ),
      [WS_METHODS.gitDiffUpdateIgnoreList]: gitDiff.effect(
        WS_METHODS.gitDiffUpdateIgnoreList,
        (input) => gitDiffCore.updateIgnoreList(input),
      ),
      [WS_METHODS.gitDiffDeleteIgnoreList]: gitDiff.effect(
        WS_METHODS.gitDiffDeleteIgnoreList,
        (input) => gitDiffCore.deleteIgnoreList(input),
      ),
      [WS_METHODS.gitDiffLoadReviewNotes]: gitDiff.effect(
        WS_METHODS.gitDiffLoadReviewNotes,
        (input) => gitDiffCore.loadReviewNotes(input),
      ),
      [WS_METHODS.gitDiffCreateReviewNote]: gitDiff.effect(
        WS_METHODS.gitDiffCreateReviewNote,
        (input) => gitDiffCore.createReviewNote(input),
      ),
      [WS_METHODS.gitDiffDeleteReviewNote]: gitDiff.effect(
        WS_METHODS.gitDiffDeleteReviewNote,
        (input) => gitDiffCore.deleteReviewNote(input),
      ),
      [WS_METHODS.gitDiffUpdateReviewSession]: gitDiff.effect(
        WS_METHODS.gitDiffUpdateReviewSession,
        (input) => gitDiffCore.updateReviewSession(input),
      ),
      [WS_METHODS.gitDiffLoadReviewSession]: gitDiff.effect(
        WS_METHODS.gitDiffLoadReviewSession,
        (input) => gitDiffCore.loadReviewSession(input),
      ),
      [WS_METHODS.gitDiffRequestReviewNavigation]: gitDiff.effect(
        WS_METHODS.gitDiffRequestReviewNavigation,
        (input) => gitDiffCore.requestReviewNavigation(input),
      ),
      [WS_METHODS.gitDiffStageWorktreeChanges]: gitDiff.effect(
        WS_METHODS.gitDiffStageWorktreeChanges,
        (input) =>
          gitDiffCore
            .stageWorktreeChanges(input)
            .pipe(Effect.tap(() => refreshGitStatus(input.cwd))),
      ),
      [WS_METHODS.gitDiffUnstageStagedChanges]: gitDiff.effect(
        WS_METHODS.gitDiffUnstageStagedChanges,
        (input) =>
          gitDiffCore
            .unstageStagedChanges(input)
            .pipe(Effect.tap(() => refreshGitStatus(input.cwd))),
      ),
      [WS_METHODS.gitDiffDiscardWorktreeChanges]: gitDiff.effect(
        WS_METHODS.gitDiffDiscardWorktreeChanges,
        (input) =>
          gitDiffCore
            .discardWorktreeChanges(input)
            .pipe(Effect.tap(() => refreshGitStatus(input.cwd))),
      ),
      [WS_METHODS.gitDiffDiscardWorktreeHunk]: gitDiff.effect(
        WS_METHODS.gitDiffDiscardWorktreeHunk,
        (input) =>
          gitDiffCore
            .discardWorktreeHunk(input)
            .pipe(Effect.tap(() => refreshGitStatus(input.cwd))),
      ),
      [WS_METHODS.gitDiffAmendStagedChanges]: gitDiff.effect(
        WS_METHODS.gitDiffAmendStagedChanges,
        (input) =>
          gitDiffCore.amendStagedChanges(input).pipe(Effect.tap(() => refreshGitStatus(input.cwd))),
      ),
      [WS_METHODS.gitDiffRevertCommit]: gitDiff.effect(WS_METHODS.gitDiffRevertCommit, (input) =>
        gitDiffCore.revertCommit(input).pipe(Effect.tap(() => refreshGitStatus(input.cwd))),
      ),
      [WS_METHODS.gitDiffCherryPickCommit]: gitDiff.effect(
        WS_METHODS.gitDiffCherryPickCommit,
        (input) =>
          gitDiffCore.cherryPickCommit(input).pipe(Effect.tap(() => refreshGitStatus(input.cwd))),
      ),
      [WS_METHODS.gitDiffLoadOperation]: gitDiff.effect(WS_METHODS.gitDiffLoadOperation, (input) =>
        gitDiffCore.loadOperation(input),
      ),
      [WS_METHODS.gitDiffContinueOperation]: gitDiff.effect(
        WS_METHODS.gitDiffContinueOperation,
        (input) =>
          gitDiffCore.continueOperation(input).pipe(Effect.tap(() => refreshGitStatus(input.cwd))),
      ),
      [WS_METHODS.gitDiffAbortOperation]: gitDiff.effect(
        WS_METHODS.gitDiffAbortOperation,
        (input) =>
          gitDiffCore.abortOperation(input).pipe(Effect.tap(() => refreshGitStatus(input.cwd))),
      ),
      [WS_METHODS.gitDiffLoadStashes]: gitDiff.effect(WS_METHODS.gitDiffLoadStashes, (input) =>
        gitDiffCore.loadStashes(input),
      ),
      [WS_METHODS.gitDiffCreateStash]: gitDiff.effect(WS_METHODS.gitDiffCreateStash, (input) =>
        gitDiffCore.createStash(input).pipe(Effect.tap(() => refreshGitStatus(input.cwd))),
      ),
      [WS_METHODS.gitDiffApplyStash]: gitDiff.effect(WS_METHODS.gitDiffApplyStash, (input) =>
        gitDiffCore.applyStash(input).pipe(Effect.tap(() => refreshGitStatus(input.cwd))),
      ),
      [WS_METHODS.gitDiffPopStash]: gitDiff.effect(WS_METHODS.gitDiffPopStash, (input) =>
        gitDiffCore.popStash(input).pipe(Effect.tap(() => refreshGitStatus(input.cwd))),
      ),
      [WS_METHODS.gitDiffDropStash]: gitDiff.effect(WS_METHODS.gitDiffDropStash, (input) =>
        gitDiffCore.dropStash(input).pipe(Effect.tap(() => refreshGitStatus(input.cwd))),
      ),
      [WS_METHODS.gitDiffCloseChangeRequest]: gitDiff.effect(
        WS_METHODS.gitDiffCloseChangeRequest,
        (input) => gitDiffCore.closeChangeRequest(input),
      ),
      [WS_METHODS.gitDiffMergeChangeRequest]: gitDiff.effect(
        WS_METHODS.gitDiffMergeChangeRequest,
        (input) => gitDiffCore.mergeChangeRequest(input),
      ),
      [WS_METHODS.gitDiffLoadChangeRequestChecks]: gitDiff.effect(
        WS_METHODS.gitDiffLoadChangeRequestChecks,
        (input) => gitDiffCore.loadChangeRequestChecks(input),
      ),
      [WS_METHODS.gitDiffLoadChangeRequestReviewThreads]: gitDiff.effect(
        WS_METHODS.gitDiffLoadChangeRequestReviewThreads,
        (input) => gitDiffCore.loadChangeRequestReviewThreads(input),
      ),
      [WS_METHODS.gitDiffCommentChangeRequestLines]: gitDiff.effect(
        WS_METHODS.gitDiffCommentChangeRequestLines,
        (input) => gitDiffCore.commentChangeRequestLines(input),
      ),
      [WS_METHODS.gitDiffRevertChangeRequestLines]: gitDiff.effect(
        WS_METHODS.gitDiffRevertChangeRequestLines,
        (input) =>
          gitDiffCore
            .revertChangeRequestLines(input)
            .pipe(Effect.tap(() => refreshGitStatus(input.cwd))),
      ),
    };
  });
