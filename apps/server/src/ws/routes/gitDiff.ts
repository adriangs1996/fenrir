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
      [WS_METHODS.gitDiffStageWorktreeChanges]: gitDiff.effect(
        WS_METHODS.gitDiffStageWorktreeChanges,
        (input) =>
          gitDiffCore
            .stageWorktreeChanges(input)
            .pipe(Effect.tap(() => refreshGitStatus(input.cwd))),
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
