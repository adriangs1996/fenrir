import { Effect, Layer } from "effect";

import { GitCore } from "../../git/Services/GitCore.ts";
import { GitManager } from "../../git/Services/GitManager.ts";
import {
  SourceControlWorkflows,
  type SourceControlWorkflowsShape,
} from "../Services/SourceControlWorkflows.ts";

const makeSourceControlWorkflows = Effect.gen(function* () {
  const gitCore = yield* GitCore;
  const gitManager = yield* GitManager;

  const pullCurrentBranch: SourceControlWorkflowsShape["pullCurrentBranch"] = (cwd) =>
    gitCore.pullCurrentBranch(cwd);
  const createWorktree: SourceControlWorkflowsShape["createWorktree"] = (input) =>
    gitCore.createWorktree(input);
  const removeWorktree: SourceControlWorkflowsShape["removeWorktree"] = (input) =>
    gitCore.removeWorktree(input);
  const renameBranch: SourceControlWorkflowsShape["renameBranch"] = (input) =>
    gitCore.renameBranch(input);
  const createBranch: SourceControlWorkflowsShape["createBranch"] = (input) =>
    gitCore.createBranch(input);
  const checkoutBranch: SourceControlWorkflowsShape["checkoutBranch"] = (input) =>
    gitCore.checkoutBranch(input);
  const initRepo: SourceControlWorkflowsShape["initRepo"] = (input) => gitCore.initRepo(input);
  const runStackedAction: SourceControlWorkflowsShape["runStackedAction"] = (input, options) =>
    gitManager.runStackedAction(input, options);
  const resolvePullRequest: SourceControlWorkflowsShape["resolvePullRequest"] = (input) =>
    gitManager.resolvePullRequest(input);
  const preparePullRequestThread: SourceControlWorkflowsShape["preparePullRequestThread"] = (
    input,
  ) => gitManager.preparePullRequestThread(input);

  return SourceControlWorkflows.of({
    pullCurrentBranch,
    createWorktree,
    removeWorktree,
    renameBranch,
    createBranch,
    checkoutBranch,
    initRepo,
    runStackedAction,
    resolvePullRequest,
    preparePullRequestThread,
  });
});

export const SourceControlWorkflowsLive = Layer.effect(
  SourceControlWorkflows,
  makeSourceControlWorkflows,
);
