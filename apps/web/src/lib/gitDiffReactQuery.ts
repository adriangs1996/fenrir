import type {
  CommentGitDiffChangeRequestLinesInput,
  CreateGitDiffIgnoreListInput,
  DiscardGitDiffWorktreeChangesInput,
  DiscardGitDiffWorktreeChangesResult,
  DiffTarget,
  EnvironmentId,
  GitDiffActionResult,
  GitDiffFileSummary,
  GitDiffIgnoreList,
  GitDiffMergeChangeRequestInput,
  LoadGitDiffChangeRequestReviewThreadsInput,
  LoadGitDiffChangeRequestReviewThreadsResult,
  LoadGitDiffChangeRequestChecksResult,
  LoadActiveChangeRequestStackedDiffFileIndexInput,
  LoadActiveChangeRequestStackedDiffFileIndexResult,
  LoadDiffFileInput,
  LoadDiffFileIndexInput,
  LoadDiffFileResult,
  LoadGitDiffRepositoriesInput,
  LoadGitDiffRepositoriesResult,
  LoadStackedDiffFileIndexInput,
  LoadStackedDiffFileIndexResult,
  RevertGitDiffChangeRequestLinesInput,
  RevertGitDiffChangeRequestLinesResult,
  StageGitDiffWorktreeChangesInput,
  StageGitDiffWorktreeChangesResult,
  UnstageGitDiffStagedChangesInput,
  UnstageGitDiffStagedChangesResult,
  UpdateGitDiffIgnoreListInput,
} from "@fenrir/contracts";
import { mutationOptions, queryOptions, type QueryClient } from "@tanstack/react-query";

import { ensureEnvironmentApi } from "../environmentApi";

export type GitDiffTargetKind = "worktree" | "staged";

function gitDiffTargetQueryKey(target: DiffTarget | null) {
  if (!target) {
    return ["none"] as const;
  }
  if (target.kind === "range") {
    return [target.kind, target.baseRef, target.headRef] as const;
  }
  return [target.kind] as const;
}

export const gitDiffQueryKeys = {
  all: ["git-diff"] as const,
  repositories: (environmentId: EnvironmentId | null, workspaceCwd: string | null) =>
    ["git-diff", environmentId, workspaceCwd, "repositories"] as const,
  fileIndex: (
    environmentId: EnvironmentId | null,
    cwd: string | null,
    targetKind: GitDiffTargetKind,
  ) => ["git-diff", environmentId, cwd, "file-index", targetKind] as const,
  file: (
    environmentId: EnvironmentId | null,
    cwd: string | null,
    target: DiffTarget | null,
    path: string | null,
    previousPath: string | null,
  ) =>
    [
      "git-diff",
      environmentId,
      cwd,
      "file",
      ...gitDiffTargetQueryKey(target),
      path,
      previousPath,
    ] as const,
  stackedFileIndex: (
    environmentId: EnvironmentId | null,
    cwd: string | null,
    baseRef: string | null,
    headRef: string | null,
  ) => ["git-diff", environmentId, cwd, "stacked-file-index", baseRef, headRef] as const,
  activeChangeRequestStackedFileIndex: (environmentId: EnvironmentId | null, cwd: string | null) =>
    ["git-diff", environmentId, cwd, "active-change-request-stacked-file-index"] as const,
  ignoreLists: (environmentId: EnvironmentId | null, cwd: string | null) =>
    ["git-diff", environmentId, cwd, "ignore-lists"] as const,
  changeRequestChecks: (
    environmentId: EnvironmentId | null,
    cwd: string | null,
    reference: string | null,
  ) => ["git-diff", environmentId, cwd, "change-request-checks", reference] as const,
  changeRequestReviewThreads: (
    environmentId: EnvironmentId | null,
    cwd: string | null,
    reference: string | null,
  ) => ["git-diff", environmentId, cwd, "change-request-review-threads", reference] as const,
};

export const gitDiffMutationKeys = {
  createIgnoreList: (environmentId: EnvironmentId | null, cwd: string | null) =>
    ["git-diff", "mutation", "create-ignore-list", environmentId, cwd] as const,
  updateIgnoreList: (environmentId: EnvironmentId | null, cwd: string | null) =>
    ["git-diff", "mutation", "update-ignore-list", environmentId, cwd] as const,
  deleteIgnoreList: (environmentId: EnvironmentId | null, cwd: string | null) =>
    ["git-diff", "mutation", "delete-ignore-list", environmentId, cwd] as const,
  stageWorktreeChanges: (environmentId: EnvironmentId | null, cwd: string | null) =>
    ["git-diff", "mutation", "stage-worktree-changes", environmentId, cwd] as const,
  unstageStagedChanges: (environmentId: EnvironmentId | null, cwd: string | null) =>
    ["git-diff", "mutation", "unstage-staged-changes", environmentId, cwd] as const,
  discardWorktreeChanges: (environmentId: EnvironmentId | null, cwd: string | null) =>
    ["git-diff", "mutation", "discard-worktree-changes", environmentId, cwd] as const,
  closeChangeRequest: (environmentId: EnvironmentId | null, cwd: string | null) =>
    ["git-diff", "mutation", "close-change-request", environmentId, cwd] as const,
  mergeChangeRequest: (environmentId: EnvironmentId | null, cwd: string | null) =>
    ["git-diff", "mutation", "merge-change-request", environmentId, cwd] as const,
  commentChangeRequestLines: (environmentId: EnvironmentId | null, cwd: string | null) =>
    ["git-diff", "mutation", "comment-change-request-lines", environmentId, cwd] as const,
  revertChangeRequestLines: (environmentId: EnvironmentId | null, cwd: string | null) =>
    ["git-diff", "mutation", "revert-change-request-lines", environmentId, cwd] as const,
};

export function gitDiffRepositoriesQueryOptions(input: {
  readonly environmentId: EnvironmentId | null;
  readonly workspaceCwd: string | null;
}) {
  return queryOptions({
    queryKey: gitDiffQueryKeys.repositories(input.environmentId, input.workspaceCwd),
    queryFn: async (): Promise<LoadGitDiffRepositoriesResult> => {
      if (!input.environmentId || !input.workspaceCwd) {
        throw new Error("Git repositories are unavailable.");
      }
      const request: LoadGitDiffRepositoriesInput = {
        workspaceCwd: input.workspaceCwd,
      };
      return ensureEnvironmentApi(input.environmentId).gitDiff.listRepositories(request);
    },
    enabled: input.environmentId !== null && input.workspaceCwd !== null,
    staleTime: 30_000,
    refetchOnWindowFocus: false,
    refetchOnReconnect: true,
  });
}

export function gitDiffFileIndexQueryOptions(input: {
  readonly environmentId: EnvironmentId | null;
  readonly cwd: string | null;
  readonly targetKind: GitDiffTargetKind;
}) {
  return queryOptions({
    queryKey: gitDiffQueryKeys.fileIndex(input.environmentId, input.cwd, input.targetKind),
    queryFn: async (): Promise<readonly GitDiffFileSummary[]> => {
      if (!input.environmentId || !input.cwd) {
        throw new Error("Git diff file index is unavailable.");
      }
      const request: LoadDiffFileIndexInput = {
        cwd: input.cwd,
        target: { kind: input.targetKind },
        detectRenames: true,
        detectCopies: true,
      };
      return ensureEnvironmentApi(input.environmentId).gitDiff.loadFileIndex(request);
    },
    enabled: input.environmentId !== null && input.cwd !== null,
    staleTime: 2_000,
    refetchOnWindowFocus: false,
    refetchOnReconnect: true,
  });
}

export function gitDiffFileQueryOptions(input: {
  readonly environmentId: EnvironmentId | null;
  readonly cwd: string | null;
  readonly target: DiffTarget | null;
  readonly path: string | null;
  readonly previousPath: string | null;
  readonly enabled?: boolean;
}) {
  return queryOptions({
    queryKey: gitDiffQueryKeys.file(
      input.environmentId,
      input.cwd,
      input.target,
      input.path,
      input.previousPath,
    ),
    queryFn: async (): Promise<LoadDiffFileResult> => {
      if (!input.environmentId || !input.cwd || !input.target || !input.path) {
        throw new Error("Git diff file is unavailable.");
      }
      const request: LoadDiffFileInput = {
        cwd: input.cwd,
        target: input.target,
        path: input.path,
        previousPath: input.previousPath,
        detectRenames: true,
        detectCopies: true,
      };
      return ensureEnvironmentApi(input.environmentId).gitDiff.loadFile(request);
    },
    enabled:
      input.enabled !== false &&
      input.environmentId !== null &&
      input.cwd !== null &&
      input.target !== null &&
      input.path !== null,
    staleTime: 2_000,
    refetchOnWindowFocus: false,
    refetchOnReconnect: true,
  });
}

export function gitDiffStackedFileIndexQueryOptions(input: {
  readonly environmentId: EnvironmentId | null;
  readonly cwd: string | null;
  readonly baseRef: string | null;
  readonly headRef: string | null;
}) {
  return queryOptions({
    queryKey: gitDiffQueryKeys.stackedFileIndex(
      input.environmentId,
      input.cwd,
      input.baseRef,
      input.headRef,
    ),
    queryFn: async (): Promise<LoadStackedDiffFileIndexResult> => {
      if (!input.environmentId || !input.cwd || !input.baseRef || !input.headRef) {
        throw new Error("Git diff stack is unavailable.");
      }
      const request: LoadStackedDiffFileIndexInput = {
        cwd: input.cwd,
        baseRef: input.baseRef,
        headRef: input.headRef,
        detectRenames: true,
        detectCopies: true,
      };
      return ensureEnvironmentApi(input.environmentId).gitDiff.loadStackedFileIndex(request);
    },
    enabled:
      input.environmentId !== null &&
      input.cwd !== null &&
      input.baseRef !== null &&
      input.headRef !== null &&
      input.baseRef !== input.headRef,
    staleTime: 2_000,
    refetchOnWindowFocus: false,
    refetchOnReconnect: true,
  });
}

export function gitDiffActiveChangeRequestStackedFileIndexQueryOptions(input: {
  readonly environmentId: EnvironmentId | null;
  readonly cwd: string | null;
}) {
  return queryOptions({
    queryKey: gitDiffQueryKeys.activeChangeRequestStackedFileIndex(input.environmentId, input.cwd),
    queryFn: async (): Promise<LoadActiveChangeRequestStackedDiffFileIndexResult> => {
      if (!input.environmentId || !input.cwd) {
        throw new Error("Active pull request diff stack is unavailable.");
      }
      const request: LoadActiveChangeRequestStackedDiffFileIndexInput = {
        cwd: input.cwd,
        detectRenames: true,
        detectCopies: true,
      };
      return ensureEnvironmentApi(
        input.environmentId,
      ).gitDiff.loadActiveChangeRequestStackedFileIndex(request);
    },
    enabled: input.environmentId !== null && input.cwd !== null,
    staleTime: 2_000,
    refetchOnWindowFocus: false,
    refetchOnReconnect: true,
  });
}

export function gitDiffIgnoreListsQueryOptions(input: {
  readonly environmentId: EnvironmentId | null;
  readonly cwd: string | null;
}) {
  return queryOptions({
    queryKey: gitDiffQueryKeys.ignoreLists(input.environmentId, input.cwd),
    queryFn: async (): Promise<readonly GitDiffIgnoreList[]> => {
      if (!input.environmentId || !input.cwd) {
        throw new Error("Git diff ignore lists are unavailable.");
      }
      return ensureEnvironmentApi(input.environmentId).gitDiff.loadIgnoreLists({ cwd: input.cwd });
    },
    enabled: input.environmentId !== null && input.cwd !== null,
    staleTime: 5_000,
    refetchOnWindowFocus: false,
    refetchOnReconnect: true,
  });
}

export function gitDiffChangeRequestChecksQueryOptions(input: {
  readonly environmentId: EnvironmentId | null;
  readonly cwd: string | null;
  readonly reference: string | null;
  readonly enabled?: boolean;
}) {
  return queryOptions({
    queryKey: gitDiffQueryKeys.changeRequestChecks(input.environmentId, input.cwd, input.reference),
    queryFn: async (): Promise<LoadGitDiffChangeRequestChecksResult> => {
      if (!input.environmentId || !input.cwd || !input.reference) {
        throw new Error("Pull request checks are unavailable.");
      }
      return ensureEnvironmentApi(input.environmentId).gitDiff.loadChangeRequestChecks({
        cwd: input.cwd,
        reference: input.reference,
      });
    },
    enabled:
      input.enabled !== false &&
      input.environmentId !== null &&
      input.cwd !== null &&
      input.reference !== null,
    staleTime: 2_000,
    refetchInterval: input.enabled === false ? false : 5_000,
    refetchOnWindowFocus: true,
    refetchOnReconnect: true,
  });
}

export function gitDiffChangeRequestReviewThreadsQueryOptions(input: {
  readonly environmentId: EnvironmentId | null;
  readonly cwd: string | null;
  readonly reference: string | null;
  readonly enabled?: boolean;
}) {
  return queryOptions({
    queryKey: gitDiffQueryKeys.changeRequestReviewThreads(
      input.environmentId,
      input.cwd,
      input.reference,
    ),
    queryFn: async (): Promise<LoadGitDiffChangeRequestReviewThreadsResult> => {
      if (!input.environmentId || !input.cwd || !input.reference) {
        throw new Error("Pull request review comments are unavailable.");
      }
      const request: LoadGitDiffChangeRequestReviewThreadsInput = {
        cwd: input.cwd,
        reference: input.reference,
      };
      return ensureEnvironmentApi(input.environmentId).gitDiff.loadChangeRequestReviewThreads(
        request,
      );
    },
    enabled:
      input.enabled !== false &&
      input.environmentId !== null &&
      input.cwd !== null &&
      input.reference !== null,
    staleTime: 2_000,
    refetchInterval: input.enabled === false ? false : 5_000,
    refetchOnWindowFocus: true,
    refetchOnReconnect: true,
  });
}

export function gitDiffCreateIgnoreListMutationOptions(input: {
  readonly environmentId: EnvironmentId | null;
  readonly cwd: string | null;
  readonly queryClient: QueryClient;
}) {
  return mutationOptions({
    mutationKey: gitDiffMutationKeys.createIgnoreList(input.environmentId, input.cwd),
    mutationFn: async (args: Omit<CreateGitDiffIgnoreListInput, "cwd">) => {
      if (!input.environmentId || !input.cwd) {
        throw new Error("Git diff ignore lists are unavailable.");
      }
      return ensureEnvironmentApi(input.environmentId).gitDiff.createIgnoreList({
        cwd: input.cwd,
        ...args,
      });
    },
    onSettled: async () => {
      await invalidateGitDiffQueries(input.queryClient, input);
    },
  });
}

export function gitDiffUpdateIgnoreListMutationOptions(input: {
  readonly environmentId: EnvironmentId | null;
  readonly cwd: string | null;
  readonly queryClient: QueryClient;
}) {
  return mutationOptions({
    mutationKey: gitDiffMutationKeys.updateIgnoreList(input.environmentId, input.cwd),
    mutationFn: async (args: Omit<UpdateGitDiffIgnoreListInput, "cwd">) => {
      if (!input.environmentId || !input.cwd) {
        throw new Error("Git diff ignore lists are unavailable.");
      }
      return ensureEnvironmentApi(input.environmentId).gitDiff.updateIgnoreList({
        cwd: input.cwd,
        ...args,
      });
    },
    onSettled: async () => {
      await invalidateGitDiffQueries(input.queryClient, input);
    },
  });
}

export function gitDiffDeleteIgnoreListMutationOptions(input: {
  readonly environmentId: EnvironmentId | null;
  readonly cwd: string | null;
  readonly queryClient: QueryClient;
}) {
  return mutationOptions({
    mutationKey: gitDiffMutationKeys.deleteIgnoreList(input.environmentId, input.cwd),
    mutationFn: async (id: string) => {
      if (!input.environmentId || !input.cwd) {
        throw new Error("Git diff ignore lists are unavailable.");
      }
      return ensureEnvironmentApi(input.environmentId).gitDiff.deleteIgnoreList({
        cwd: input.cwd,
        id,
      });
    },
    onSettled: async () => {
      await invalidateGitDiffQueries(input.queryClient, input);
    },
  });
}

export function gitDiffStageWorktreeChangesMutationOptions(input: {
  readonly environmentId: EnvironmentId | null;
  readonly cwd: string | null;
  readonly queryClient: QueryClient;
}) {
  return mutationOptions({
    mutationKey: gitDiffMutationKeys.stageWorktreeChanges(input.environmentId, input.cwd),
    mutationFn: async (
      args: Omit<StageGitDiffWorktreeChangesInput, "cwd">,
    ): Promise<StageGitDiffWorktreeChangesResult> => {
      if (!input.environmentId || !input.cwd) {
        throw new Error("Git staging is unavailable.");
      }
      return ensureEnvironmentApi(input.environmentId).gitDiff.stageWorktreeChanges({
        cwd: input.cwd,
        ...args,
      });
    },
    onSettled: async () => {
      await invalidateGitDiffQueries(input.queryClient, input);
    },
  });
}

export function gitDiffUnstageStagedChangesMutationOptions(input: {
  readonly environmentId: EnvironmentId | null;
  readonly cwd: string | null;
  readonly queryClient: QueryClient;
}) {
  return mutationOptions({
    mutationKey: gitDiffMutationKeys.unstageStagedChanges(input.environmentId, input.cwd),
    mutationFn: async (
      args: Omit<UnstageGitDiffStagedChangesInput, "cwd">,
    ): Promise<UnstageGitDiffStagedChangesResult> => {
      if (!input.environmentId || !input.cwd) {
        throw new Error("Git unstaging is unavailable.");
      }
      return ensureEnvironmentApi(input.environmentId).gitDiff.unstageStagedChanges({
        cwd: input.cwd,
        ...args,
      });
    },
    onSettled: async () => {
      await invalidateGitDiffQueries(input.queryClient, input);
    },
  });
}

export function gitDiffDiscardWorktreeChangesMutationOptions(input: {
  readonly environmentId: EnvironmentId | null;
  readonly cwd: string | null;
  readonly queryClient: QueryClient;
}) {
  return mutationOptions({
    mutationKey: gitDiffMutationKeys.discardWorktreeChanges(input.environmentId, input.cwd),
    mutationFn: async (
      args: Omit<DiscardGitDiffWorktreeChangesInput, "cwd">,
    ): Promise<DiscardGitDiffWorktreeChangesResult> => {
      if (!input.environmentId || !input.cwd) {
        throw new Error("Git discard is unavailable.");
      }
      return ensureEnvironmentApi(input.environmentId).gitDiff.discardWorktreeChanges({
        cwd: input.cwd,
        ...args,
      });
    },
    onSettled: async () => {
      await invalidateGitDiffQueries(input.queryClient, input);
    },
  });
}

export function gitDiffCloseChangeRequestMutationOptions(input: {
  readonly environmentId: EnvironmentId | null;
  readonly cwd: string | null;
  readonly queryClient: QueryClient;
}) {
  return mutationOptions({
    mutationKey: gitDiffMutationKeys.closeChangeRequest(input.environmentId, input.cwd),
    mutationFn: async (reference: string): Promise<GitDiffActionResult> => {
      if (!input.environmentId || !input.cwd) {
        throw new Error("Pull request actions are unavailable.");
      }
      return ensureEnvironmentApi(input.environmentId).gitDiff.closeChangeRequest({
        cwd: input.cwd,
        reference,
      });
    },
    onSettled: async () => {
      await invalidateGitDiffQueries(input.queryClient, input);
    },
  });
}

export function gitDiffMergeChangeRequestMutationOptions(input: {
  readonly environmentId: EnvironmentId | null;
  readonly cwd: string | null;
  readonly queryClient: QueryClient;
}) {
  return mutationOptions({
    mutationKey: gitDiffMutationKeys.mergeChangeRequest(input.environmentId, input.cwd),
    mutationFn: async (
      args: Omit<GitDiffMergeChangeRequestInput, "cwd">,
    ): Promise<GitDiffActionResult> => {
      if (!input.environmentId || !input.cwd) {
        throw new Error("Pull request actions are unavailable.");
      }
      return ensureEnvironmentApi(input.environmentId).gitDiff.mergeChangeRequest({
        cwd: input.cwd,
        ...args,
      });
    },
    onSettled: async () => {
      await invalidateGitDiffQueries(input.queryClient, input);
    },
  });
}

export function gitDiffCommentChangeRequestLinesMutationOptions(input: {
  readonly environmentId: EnvironmentId | null;
  readonly cwd: string | null;
  readonly queryClient: QueryClient;
}) {
  return mutationOptions({
    mutationKey: gitDiffMutationKeys.commentChangeRequestLines(input.environmentId, input.cwd),
    mutationFn: async (
      args: Omit<CommentGitDiffChangeRequestLinesInput, "cwd">,
    ): Promise<GitDiffActionResult> => {
      if (!input.environmentId || !input.cwd) {
        throw new Error("Pull request line comments are unavailable.");
      }
      return ensureEnvironmentApi(input.environmentId).gitDiff.commentChangeRequestLines({
        cwd: input.cwd,
        ...args,
      });
    },
    onSettled: async () => {
      await invalidateGitDiffQueries(input.queryClient, input);
    },
  });
}

export function gitDiffRevertChangeRequestLinesMutationOptions(input: {
  readonly environmentId: EnvironmentId | null;
  readonly cwd: string | null;
  readonly queryClient: QueryClient;
}) {
  return mutationOptions({
    mutationKey: gitDiffMutationKeys.revertChangeRequestLines(input.environmentId, input.cwd),
    mutationFn: async (
      args: Omit<RevertGitDiffChangeRequestLinesInput, "cwd">,
    ): Promise<RevertGitDiffChangeRequestLinesResult> => {
      if (!input.environmentId || !input.cwd) {
        throw new Error("Pull request line revert is unavailable.");
      }
      return ensureEnvironmentApi(input.environmentId).gitDiff.revertChangeRequestLines({
        cwd: input.cwd,
        ...args,
      });
    },
    onSettled: async () => {
      await invalidateGitDiffQueries(input.queryClient, input);
    },
  });
}

export function invalidateGitDiffQueries(
  queryClient: QueryClient,
  input?: { readonly environmentId?: EnvironmentId | null; readonly cwd?: string | null },
) {
  const environmentId = input?.environmentId ?? null;
  const cwd = input?.cwd ?? null;
  if (cwd !== null) {
    return queryClient.invalidateQueries({ queryKey: ["git-diff", environmentId, cwd] });
  }

  return queryClient.invalidateQueries({ queryKey: gitDiffQueryKeys.all });
}
