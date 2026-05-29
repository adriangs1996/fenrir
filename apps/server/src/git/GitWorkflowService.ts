import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import {
  GitCommandError,
  GitManagerError,
  type GitManagerServiceError,
  type GitPreparePullRequestThreadInput,
  type GitPreparePullRequestThreadResult,
  type GitPullRequestRefInput,
  type GitResolvePullRequestResult,
  type GitRunStackedActionInput,
  type GitRunStackedActionResult,
  type VcsCreateRefInput,
  type VcsCreateRefResult,
  type VcsCreateWorktreeInput,
  type VcsCreateWorktreeResult,
  type VcsListRefsInput,
  type VcsListRefsResult,
  type VcsPullResult,
  type VcsRemoveWorktreeInput,
  type VcsStatusInput,
  type VcsStatusLocalResult,
  type VcsStatusRemoteResult,
  type VcsStatusResult,
  type VcsSwitchRefInput,
  type VcsSwitchRefResult,
} from "@fenrir/contracts";
import { GitCore } from "./Services/GitCore.ts";
import { GitManager, type GitRunStackedActionOptions } from "./Services/GitManager.ts";
import { VcsDriverRegistry } from "../vcs/VcsDriverRegistry.ts";

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

const unsupportedGitWorkflow = (operation: string, cwd: string, detail: string) =>
  new GitManagerError({
    operation,
    detail: `${detail} (${cwd})`,
  });

const unsupportedGitCommand = (operation: string, cwd: string, detail: string) =>
  new GitCommandError({
    operation,
    command: "vcs-route",
    cwd,
    detail,
  });

function nonRepositoryLocalStatus(): VcsStatusLocalResult {
  return {
    isRepo: false,
    hasPrimaryRemote: false,
    isDefaultRef: false,
    refName: null,
    hasWorkingTreeChanges: false,
    workingTree: {
      files: [],
      insertions: 0,
      deletions: 0,
    },
  };
}

function nonRepositoryStatus(): VcsStatusResult {
  return {
    ...nonRepositoryLocalStatus(),
    hasUpstream: false,
    aheadCount: 0,
    behindCount: 0,
    aheadOfDefaultCount: 0,
    pr: null,
  };
}

function nonRepositoryListRefs(): VcsListRefsResult {
  return {
    refs: [],
    isRepo: false,
    hasPrimaryRemote: false,
    nextCursor: null,
    totalCount: 0,
  };
}

function toVcsStatusLocal(input: {
  readonly isRepo: boolean;
  readonly hostingProvider?: VcsStatusLocalResult["sourceControlProvider"];
  readonly hasOriginRemote: boolean;
  readonly isDefaultBranch: boolean;
  readonly branch: string | null;
  readonly hasWorkingTreeChanges: boolean;
  readonly workingTree: VcsStatusLocalResult["workingTree"];
}): VcsStatusLocalResult {
  return {
    isRepo: input.isRepo,
    ...(input.hostingProvider ? { sourceControlProvider: input.hostingProvider } : {}),
    hasPrimaryRemote: input.hasOriginRemote,
    isDefaultRef: input.isDefaultBranch,
    refName: input.branch,
    hasWorkingTreeChanges: input.hasWorkingTreeChanges,
    workingTree: input.workingTree,
  };
}

function toVcsStatusRemote(input: {
  readonly hasUpstream: boolean;
  readonly aheadCount: number;
  readonly behindCount: number;
  readonly aheadOfDefaultCount?: number | undefined;
  readonly pr: null | {
    readonly number: number;
    readonly title: string;
    readonly url: string;
    readonly baseBranch: string;
    readonly headBranch: string;
    readonly state: "open" | "closed" | "merged";
  };
}): VcsStatusRemoteResult {
  return {
    hasUpstream: input.hasUpstream,
    aheadCount: input.aheadCount,
    behindCount: input.behindCount,
    ...(input.aheadOfDefaultCount === undefined
      ? {}
      : { aheadOfDefaultCount: input.aheadOfDefaultCount }),
    pr:
      input.pr === null
        ? null
        : {
            number: input.pr.number,
            title: input.pr.title,
            url: input.pr.url,
            baseRef: input.pr.baseBranch,
            headRef: input.pr.headBranch,
            state: input.pr.state,
          },
  };
}

function toVcsStatus(
  input: Parameters<typeof toVcsStatusLocal>[0] & Parameters<typeof toVcsStatusRemote>[0],
): VcsStatusResult {
  return {
    ...toVcsStatusLocal(input),
    ...toVcsStatusRemote(input),
  };
}

function toVcsListRefs(input: {
  readonly branches: ReadonlyArray<VcsListRefsResult["refs"][number]>;
  readonly isRepo: boolean;
  readonly hasOriginRemote: boolean;
  readonly nextCursor: number | null;
  readonly totalCount: number;
}): VcsListRefsResult {
  return {
    refs: input.branches,
    isRepo: input.isRepo,
    hasPrimaryRemote: input.hasOriginRemote,
    nextCursor: input.nextCursor,
    totalCount: input.totalCount,
  };
}

export const make = Effect.fn("makeGitWorkflowService")(function* () {
  const registry = yield* VcsDriverRegistry;
  const gitCore = yield* GitCore;
  const gitManager = yield* GitManager;

  const ensureGit = Effect.fn("GitWorkflowService.ensureGit")(function* (
    operation: string,
    cwd: string,
  ) {
    const handle = yield* registry
      .resolve({ cwd })
      .pipe(
        Effect.mapError((error) =>
          unsupportedGitWorkflow(
            operation,
            cwd,
            error instanceof Error ? error.message : String(error),
          ),
        ),
      );
    if (handle.kind !== "git") {
      return yield* unsupportedGitWorkflow(
        operation,
        cwd,
        `The ${operation} workflow currently supports Git repositories only; detected ${handle.kind}.`,
      );
    }
  });

  const ensureGitCommand = Effect.fn("GitWorkflowService.ensureGitCommand")(function* (
    operation: string,
    cwd: string,
  ) {
    const handle = yield* registry
      .resolve({ cwd })
      .pipe(
        Effect.mapError((error) =>
          unsupportedGitCommand(
            operation,
            cwd,
            error instanceof Error ? error.message : String(error),
          ),
        ),
      );
    if (handle.kind !== "git") {
      return yield* unsupportedGitCommand(
        operation,
        cwd,
        `The ${operation} command currently supports Git repositories only; detected ${handle.kind}.`,
      );
    }
  });

  const detectGitRepositoryForStatus = Effect.fn("GitWorkflowService.detectGitRepositoryForStatus")(
    function* (operation: string, cwd: string) {
      const handle = yield* registry
        .detect({ cwd })
        .pipe(
          Effect.mapError((error) =>
            unsupportedGitWorkflow(
              operation,
              cwd,
              error instanceof Error ? error.message : String(error),
            ),
          ),
        );
      if (!handle) {
        return false;
      }
      if (handle.kind !== "git") {
        return yield* unsupportedGitWorkflow(
          operation,
          cwd,
          `The ${operation} workflow currently supports Git repositories only; detected ${handle.kind}.`,
        );
      }
      return true;
    },
  );

  const detectGitRepositoryForCommand = Effect.fn(
    "GitWorkflowService.detectGitRepositoryForCommand",
  )(function* (operation: string, cwd: string) {
    const handle = yield* registry
      .detect({ cwd })
      .pipe(
        Effect.mapError((error) =>
          unsupportedGitCommand(
            operation,
            cwd,
            error instanceof Error ? error.message : String(error),
          ),
        ),
      );
    if (!handle) {
      return false;
    }
    if (handle.kind !== "git") {
      return yield* unsupportedGitCommand(
        operation,
        cwd,
        `The ${operation} command currently supports Git repositories only; detected ${handle.kind}.`,
      );
    }
    return true;
  });

  const routeGitManager =
    <Input extends { readonly cwd: string }, Output>(
      operation: string,
      run: (input: Input) => Effect.Effect<Output, GitManagerServiceError>,
    ) =>
    (input: Input) =>
      ensureGit(operation, input.cwd).pipe(Effect.andThen(run(input)));

  return GitWorkflowService.of({
    status: (input) =>
      detectGitRepositoryForStatus("GitWorkflowService.status", input.cwd).pipe(
        Effect.flatMap((isGitRepository) =>
          isGitRepository
            ? gitManager.status(input).pipe(Effect.map(toVcsStatus))
            : Effect.succeed(nonRepositoryStatus()),
        ),
      ),
    localStatus: (input) =>
      detectGitRepositoryForStatus("GitWorkflowService.localStatus", input.cwd).pipe(
        Effect.flatMap((isGitRepository) =>
          isGitRepository
            ? gitManager.localStatus(input).pipe(Effect.map(toVcsStatusLocal))
            : Effect.succeed(nonRepositoryLocalStatus()),
        ),
      ),
    remoteStatus: (input) =>
      detectGitRepositoryForStatus("GitWorkflowService.remoteStatus", input.cwd).pipe(
        Effect.flatMap((isGitRepository) =>
          isGitRepository
            ? gitManager
                .remoteStatus(input)
                .pipe(Effect.map((remote) => (remote === null ? null : toVcsStatusRemote(remote))))
            : Effect.succeed(null),
        ),
      ),
    invalidateLocalStatus: gitManager.invalidateLocalStatus,
    invalidateRemoteStatus: gitManager.invalidateRemoteStatus,
    invalidateStatus: gitManager.invalidateStatus,
    pullCurrentBranch: (cwd) =>
      ensureGitCommand("GitWorkflowService.pullCurrentBranch", cwd).pipe(
        Effect.andThen(gitCore.pullCurrentBranch(cwd)),
        Effect.map((result) => ({
          status: result.status,
          refName: result.branch,
          upstreamRef: result.upstreamBranch,
        })),
      ),
    runStackedAction: (input, options) =>
      ensureGit("GitWorkflowService.runStackedAction", input.cwd).pipe(
        Effect.andThen(gitManager.runStackedAction(input, options)),
      ),
    resolvePullRequest: routeGitManager(
      "GitWorkflowService.resolvePullRequest",
      gitManager.resolvePullRequest,
    ),
    preparePullRequestThread: routeGitManager(
      "GitWorkflowService.preparePullRequestThread",
      gitManager.preparePullRequestThread,
    ),
    listRefs: (input) =>
      detectGitRepositoryForCommand("GitWorkflowService.listRefs", input.cwd).pipe(
        Effect.flatMap((isGitRepository) =>
          isGitRepository
            ? gitCore.listBranches(input).pipe(Effect.map(toVcsListRefs))
            : Effect.succeed(nonRepositoryListRefs()),
        ),
      ),
    createWorktree: (input) =>
      ensureGitCommand("GitWorkflowService.createWorktree", input.cwd).pipe(
        Effect.andThen(
          gitCore
            .createWorktree({
              cwd: input.cwd,
              branch: input.refName,
              ...(input.newRefName ? { newBranch: input.newRefName } : {}),
              path: input.path,
            })
            .pipe(
              Effect.map((result) => ({
                worktree: {
                  path: result.worktree.path,
                  refName: result.worktree.branch,
                },
              })),
            ),
        ),
      ),
    removeWorktree: (input) =>
      ensureGitCommand("GitWorkflowService.removeWorktree", input.cwd).pipe(
        Effect.andThen(gitCore.removeWorktree(input)),
      ),
    createRef: (input) =>
      ensureGitCommand("GitWorkflowService.createRef", input.cwd).pipe(
        Effect.andThen(
          gitCore
            .createBranch({
              cwd: input.cwd,
              branch: input.refName,
              ...(input.switchRef !== undefined ? { checkout: input.switchRef } : {}),
            })
            .pipe(Effect.map((result) => ({ refName: result.branch }))),
        ),
      ),
    switchRef: (input) =>
      ensureGitCommand("GitWorkflowService.switchRef", input.cwd).pipe(
        Effect.andThen(
          Effect.scoped(gitCore.checkoutBranch({ cwd: input.cwd, branch: input.refName })).pipe(
            Effect.map((result) => ({ refName: result.branch })),
          ),
        ),
      ),
    renameBranch: (input) =>
      ensureGit("GitWorkflowService.renameBranch", input.cwd).pipe(
        Effect.andThen(gitCore.renameBranch(input)),
      ),
  });
});

export const layer = Layer.effect(GitWorkflowService, make());
