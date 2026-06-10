/**
 * GitWorkflowService - Effect service contract for VCS-routed Git workflows.
 *
 * Fronts GitManager/GitCore behind the VCS driver registry so callers can
 * issue workflow operations without knowing the underlying VCS kind.
 *
 * @module GitWorkflowService
 */
import * as Context from "effect/Context";
import type * as Effect from "effect/Effect";

import type {
  GitCommandError,
  GitManagerServiceError,
  GitPreparePullRequestThreadInput,
  GitPreparePullRequestThreadResult,
  GitPullRequestRefInput,
  GitResolvePullRequestResult,
  GitRunStackedActionInput,
  GitRunStackedActionResult,
  VcsCreateRefInput,
  VcsCreateRefResult,
  VcsCreateWorktreeInput,
  VcsCreateWorktreeResult,
  VcsListRefsInput,
  VcsListRefsResult,
  VcsPullResult,
  VcsRemoveWorktreeInput,
  VcsStatusInput,
  VcsStatusLocalResult,
  VcsStatusRemoteResult,
  VcsStatusResult,
  VcsSwitchRefInput,
  VcsSwitchRefResult,
} from "@fenrir/contracts";
import type { GitRunStackedActionOptions } from "./GitManager.ts";

export interface GitWorkflowServiceShape {
  readonly status: (
    input: VcsStatusInput,
  ) => Effect.Effect<VcsStatusResult, GitManagerServiceError>;
  readonly localStatus: (
    input: VcsStatusInput,
  ) => Effect.Effect<VcsStatusLocalResult, GitManagerServiceError>;
  readonly remoteStatus: (
    input: VcsStatusInput,
  ) => Effect.Effect<VcsStatusRemoteResult | null, GitManagerServiceError>;
  readonly invalidateLocalStatus: (cwd: string) => Effect.Effect<void, never>;
  readonly invalidateRemoteStatus: (cwd: string) => Effect.Effect<void, never>;
  readonly invalidateStatus: (cwd: string) => Effect.Effect<void, never>;
  readonly pullCurrentBranch: (cwd: string) => Effect.Effect<VcsPullResult, GitCommandError>;
  readonly runStackedAction: (
    input: GitRunStackedActionInput,
    options?: GitRunStackedActionOptions,
  ) => Effect.Effect<GitRunStackedActionResult, GitManagerServiceError>;
  readonly resolvePullRequest: (
    input: GitPullRequestRefInput,
  ) => Effect.Effect<GitResolvePullRequestResult, GitManagerServiceError>;
  readonly preparePullRequestThread: (
    input: GitPreparePullRequestThreadInput,
  ) => Effect.Effect<GitPreparePullRequestThreadResult, GitManagerServiceError>;
  readonly listRefs: (input: VcsListRefsInput) => Effect.Effect<VcsListRefsResult, GitCommandError>;
  readonly createWorktree: (
    input: VcsCreateWorktreeInput,
  ) => Effect.Effect<VcsCreateWorktreeResult, GitCommandError>;
  readonly removeWorktree: (input: VcsRemoveWorktreeInput) => Effect.Effect<void, GitCommandError>;
  readonly createRef: (
    input: VcsCreateRefInput,
  ) => Effect.Effect<VcsCreateRefResult, GitCommandError>;
  readonly switchRef: (
    input: VcsSwitchRefInput,
  ) => Effect.Effect<VcsSwitchRefResult, GitCommandError>;
  readonly renameBranch: (input: {
    readonly cwd: string;
    readonly oldBranch: string;
    readonly newBranch: string;
  }) => Effect.Effect<{ readonly branch: string }, GitManagerServiceError>;
}

export class GitWorkflowService extends Context.Service<
  GitWorkflowService,
  GitWorkflowServiceShape
>()("fenrir/git/GitWorkflowService") {}
