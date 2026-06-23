import type {
  AmendGitDiffStagedChangesInput,
  AmendGitDiffStagedChangesResult,
  CommentGitDiffChangeRequestLinesInput,
  CreateGitDiffIgnoreListInput,
  CreateGitDiffReviewNoteInput,
  CreateGitDiffStashInput,
  CreateGitDiffStashResult,
  DeleteGitDiffReviewNoteInput,
  DiscardGitDiffWorktreeChangesInput,
  DiscardGitDiffWorktreeChangesResult,
  DiscardGitDiffWorktreeHunkInput,
  DiscardGitDiffWorktreeHunkResult,
  DiffTarget,
  EnvironmentId,
  GitDiffActionResult,
  GitDiffCommitActionResult,
  GitDiffCommitReferenceInput,
  GitDiffCommit,
  GitDiffFileSummary,
  GitDiffIgnoreList,
  GitDiffMergeChangeRequestInput,
  GitDiffOperationActionInput,
  GitDiffOperationActionResult,
  GitDiffReviewNote,
  GitDiffStash,
  GitDiffStashReferenceInput,
  LoadGitDiffChangeRequestReviewThreadsInput,
  LoadGitDiffChangeRequestReviewThreadsResult,
  LoadGitDiffChangeRequestChecksResult,
  LoadGitDiffHistoryInput,
  LoadGitDiffOperationResult,
  LoadActiveChangeRequestStackedDiffFileIndexInput,
  LoadActiveChangeRequestStackedDiffFileIndexResult,
  LoadDiffFileInput,
  LoadDiffFileIndexInput,
  LoadDiffFileResult,
  LoadGitDiffChangeSignatureResult,
  LoadGitDiffRepositoriesInput,
  LoadGitDiffRepositoriesResult,
  LoadGitDiffReviewNotesInput,
  LoadGitDiffReviewNotesResult,
  LoadGitDiffReviewSessionResult,
  LoadGitDiffStashesInput,
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
  if (target.kind === "commit") {
    return [target.kind, target.commitRef, target.parentRef] as const;
  }
  if (target.kind === "stash") {
    return [target.kind, target.ref] as const;
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
  targetFileIndex: (
    environmentId: EnvironmentId | null,
    cwd: string | null,
    target: DiffTarget | null,
  ) => ["git-diff", environmentId, cwd, "file-index", ...gitDiffTargetQueryKey(target)] as const,
  changeSignature: (
    environmentId: EnvironmentId | null,
    cwd: string | null,
    target: DiffTarget | null,
  ) =>
    ["git-diff", environmentId, cwd, "change-signature", ...gitDiffTargetQueryKey(target)] as const,
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
  history: (environmentId: EnvironmentId | null, cwd: string | null) =>
    ["git-diff", environmentId, cwd, "history"] as const,
  operation: (environmentId: EnvironmentId | null, cwd: string | null) =>
    ["git-diff", environmentId, cwd, "operation"] as const,
  ignoreLists: (environmentId: EnvironmentId | null, cwd: string | null) =>
    ["git-diff", environmentId, cwd, "ignore-lists"] as const,
  reviewNotes: (
    environmentId: EnvironmentId | null,
    cwd: string | null,
    target: DiffTarget | null,
  ) => ["git-diff", environmentId, cwd, "review-notes", ...gitDiffTargetQueryKey(target)] as const,
  reviewSession: (environmentId: EnvironmentId | null, cwd: string | null) =>
    ["git-diff", environmentId, cwd, "review-session"] as const,
  stashes: (environmentId: EnvironmentId | null, cwd: string | null) =>
    ["git-diff", environmentId, cwd, "stashes"] as const,
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
  createReviewNote: (environmentId: EnvironmentId | null, cwd: string | null) =>
    ["git-diff", "mutation", "create-review-note", environmentId, cwd] as const,
  deleteReviewNote: (environmentId: EnvironmentId | null, cwd: string | null) =>
    ["git-diff", "mutation", "delete-review-note", environmentId, cwd] as const,
  updateReviewSession: (environmentId: EnvironmentId | null, cwd: string | null) =>
    ["git-diff", "mutation", "update-review-session", environmentId, cwd] as const,
  requestReviewNavigation: (environmentId: EnvironmentId | null, cwd: string | null) =>
    ["git-diff", "mutation", "request-review-navigation", environmentId, cwd] as const,
  stageWorktreeChanges: (environmentId: EnvironmentId | null, cwd: string | null) =>
    ["git-diff", "mutation", "stage-worktree-changes", environmentId, cwd] as const,
  unstageStagedChanges: (environmentId: EnvironmentId | null, cwd: string | null) =>
    ["git-diff", "mutation", "unstage-staged-changes", environmentId, cwd] as const,
  discardWorktreeChanges: (environmentId: EnvironmentId | null, cwd: string | null) =>
    ["git-diff", "mutation", "discard-worktree-changes", environmentId, cwd] as const,
  discardWorktreeHunk: (environmentId: EnvironmentId | null, cwd: string | null) =>
    ["git-diff", "mutation", "discard-worktree-hunk", environmentId, cwd] as const,
  amendStagedChanges: (environmentId: EnvironmentId | null, cwd: string | null) =>
    ["git-diff", "mutation", "amend-staged-changes", environmentId, cwd] as const,
  revertCommit: (environmentId: EnvironmentId | null, cwd: string | null) =>
    ["git-diff", "mutation", "revert-commit", environmentId, cwd] as const,
  cherryPickCommit: (environmentId: EnvironmentId | null, cwd: string | null) =>
    ["git-diff", "mutation", "cherry-pick-commit", environmentId, cwd] as const,
  continueOperation: (environmentId: EnvironmentId | null, cwd: string | null) =>
    ["git-diff", "mutation", "continue-operation", environmentId, cwd] as const,
  abortOperation: (environmentId: EnvironmentId | null, cwd: string | null) =>
    ["git-diff", "mutation", "abort-operation", environmentId, cwd] as const,
  createStash: (environmentId: EnvironmentId | null, cwd: string | null) =>
    ["git-diff", "mutation", "create-stash", environmentId, cwd] as const,
  applyStash: (environmentId: EnvironmentId | null, cwd: string | null) =>
    ["git-diff", "mutation", "apply-stash", environmentId, cwd] as const,
  popStash: (environmentId: EnvironmentId | null, cwd: string | null) =>
    ["git-diff", "mutation", "pop-stash", environmentId, cwd] as const,
  dropStash: (environmentId: EnvironmentId | null, cwd: string | null) =>
    ["git-diff", "mutation", "drop-stash", environmentId, cwd] as const,
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

export function gitDiffTargetFileIndexQueryOptions(input: {
  readonly environmentId: EnvironmentId | null;
  readonly cwd: string | null;
  readonly target: DiffTarget | null;
  readonly enabled?: boolean;
}) {
  return queryOptions({
    queryKey: gitDiffQueryKeys.targetFileIndex(input.environmentId, input.cwd, input.target),
    queryFn: async (): Promise<readonly GitDiffFileSummary[]> => {
      if (!input.environmentId || !input.cwd || !input.target) {
        throw new Error("Git diff file index is unavailable.");
      }
      const request: LoadDiffFileIndexInput = {
        cwd: input.cwd,
        target: input.target,
        detectRenames: true,
        detectCopies: true,
      };
      return ensureEnvironmentApi(input.environmentId).gitDiff.loadFileIndex(request);
    },
    enabled:
      input.enabled !== false &&
      input.environmentId !== null &&
      input.cwd !== null &&
      input.target !== null,
    staleTime: 2_000,
    refetchOnWindowFocus: false,
    refetchOnReconnect: true,
  });
}

export function gitDiffChangeSignatureQueryOptions(input: {
  readonly environmentId: EnvironmentId | null;
  readonly cwd: string | null;
  readonly target: DiffTarget | null;
  readonly enabled?: boolean;
}) {
  return queryOptions({
    queryKey: gitDiffQueryKeys.changeSignature(input.environmentId, input.cwd, input.target),
    queryFn: async (): Promise<LoadGitDiffChangeSignatureResult> => {
      if (!input.environmentId || !input.cwd || !input.target) {
        throw new Error("Git diff change signature is unavailable.");
      }
      return ensureEnvironmentApi(input.environmentId).gitDiff.loadChangeSignature({
        cwd: input.cwd,
        target: input.target,
      });
    },
    enabled:
      input.enabled !== false &&
      input.environmentId !== null &&
      input.cwd !== null &&
      input.target !== null,
    staleTime: 500,
    refetchInterval: 1_000,
    refetchOnWindowFocus: true,
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

export function gitDiffHistoryQueryOptions(input: {
  readonly environmentId: EnvironmentId | null;
  readonly cwd: string | null;
  readonly limit?: number;
}) {
  return queryOptions({
    queryKey: gitDiffQueryKeys.history(input.environmentId, input.cwd),
    queryFn: async (): Promise<readonly GitDiffCommit[]> => {
      if (!input.environmentId || !input.cwd) {
        throw new Error("Git history is unavailable.");
      }
      const request: LoadGitDiffHistoryInput = {
        cwd: input.cwd,
        ...(input.limit !== undefined ? { limit: input.limit } : {}),
      };
      return ensureEnvironmentApi(input.environmentId).gitDiff.loadHistory(request);
    },
    enabled: input.environmentId !== null && input.cwd !== null,
    staleTime: 5_000,
    refetchOnWindowFocus: false,
    refetchOnReconnect: true,
  });
}

export function gitDiffOperationQueryOptions(input: {
  readonly environmentId: EnvironmentId | null;
  readonly cwd: string | null;
}) {
  return queryOptions({
    queryKey: gitDiffQueryKeys.operation(input.environmentId, input.cwd),
    queryFn: async (): Promise<LoadGitDiffOperationResult> => {
      if (!input.environmentId || !input.cwd) {
        throw new Error("Git operation state is unavailable.");
      }
      return ensureEnvironmentApi(input.environmentId).gitDiff.loadOperation({ cwd: input.cwd });
    },
    enabled: input.environmentId !== null && input.cwd !== null,
    staleTime: 1_000,
    refetchInterval: (query) => (query.state.data?.operation ? 2_000 : false),
    refetchOnWindowFocus: true,
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

export function gitDiffReviewNotesQueryOptions(input: {
  readonly environmentId: EnvironmentId | null;
  readonly cwd: string | null;
  readonly target: DiffTarget | null;
  readonly enabled?: boolean;
}) {
  return queryOptions({
    queryKey: gitDiffQueryKeys.reviewNotes(input.environmentId, input.cwd, input.target),
    queryFn: async (): Promise<LoadGitDiffReviewNotesResult> => {
      if (!input.environmentId || !input.cwd || !input.target) {
        throw new Error("Git diff review notes are unavailable.");
      }
      const request: LoadGitDiffReviewNotesInput = {
        cwd: input.cwd,
        target: input.target,
      };
      return ensureEnvironmentApi(input.environmentId).gitDiff.loadReviewNotes(request);
    },
    enabled:
      input.enabled !== false &&
      input.environmentId !== null &&
      input.cwd !== null &&
      input.target !== null,
    staleTime: 2_000,
    refetchOnWindowFocus: false,
    refetchOnReconnect: true,
  });
}

export function gitDiffReviewSessionQueryOptions(input: {
  readonly environmentId: EnvironmentId | null;
  readonly cwd: string | null;
  readonly enabled?: boolean;
}) {
  return queryOptions({
    queryKey: gitDiffQueryKeys.reviewSession(input.environmentId, input.cwd),
    queryFn: async (): Promise<LoadGitDiffReviewSessionResult> => {
      if (!input.environmentId || !input.cwd) {
        throw new Error("Git diff review session is unavailable.");
      }
      return ensureEnvironmentApi(input.environmentId).gitDiff.loadReviewSession({
        cwd: input.cwd,
      });
    },
    enabled: input.enabled !== false && input.environmentId !== null && input.cwd !== null,
    staleTime: 500,
    refetchOnWindowFocus: true,
    refetchOnReconnect: true,
  });
}

export function gitDiffStashesQueryOptions(input: {
  readonly environmentId: EnvironmentId | null;
  readonly cwd: string | null;
}) {
  return queryOptions({
    queryKey: gitDiffQueryKeys.stashes(input.environmentId, input.cwd),
    queryFn: async (): Promise<readonly GitDiffStash[]> => {
      if (!input.environmentId || !input.cwd) {
        throw new Error("Git stashes are unavailable.");
      }
      const request: LoadGitDiffStashesInput = {
        cwd: input.cwd,
      };
      return ensureEnvironmentApi(input.environmentId).gitDiff.loadStashes(request);
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

async function invalidateGitDiffReviewNotesQueries(
  queryClient: QueryClient,
  input: {
    readonly environmentId: EnvironmentId | null;
    readonly cwd: string | null;
    readonly target?: DiffTarget | null;
  },
) {
  if (input.target !== undefined) {
    await queryClient.invalidateQueries({
      queryKey: gitDiffQueryKeys.reviewNotes(input.environmentId, input.cwd, input.target),
    });
    return;
  }

  await queryClient.invalidateQueries({
    queryKey: ["git-diff", input.environmentId, input.cwd, "review-notes"],
  });
}

export function gitDiffCreateReviewNoteMutationOptions(input: {
  readonly environmentId: EnvironmentId | null;
  readonly cwd: string | null;
  readonly queryClient: QueryClient;
}) {
  return mutationOptions({
    mutationKey: gitDiffMutationKeys.createReviewNote(input.environmentId, input.cwd),
    mutationFn: async (
      args: Omit<CreateGitDiffReviewNoteInput, "cwd">,
    ): Promise<GitDiffReviewNote> => {
      if (!input.environmentId || !input.cwd) {
        throw new Error("Git diff review notes are unavailable.");
      }
      return ensureEnvironmentApi(input.environmentId).gitDiff.createReviewNote({
        cwd: input.cwd,
        ...args,
      });
    },
    onSettled: async (_data, _error, args) => {
      await invalidateGitDiffReviewNotesQueries(input.queryClient, {
        environmentId: input.environmentId,
        cwd: input.cwd,
        target: args?.target ?? null,
      });
      await invalidateGitDiffQueries(input.queryClient, input);
    },
  });
}

export function gitDiffDeleteReviewNoteMutationOptions(input: {
  readonly environmentId: EnvironmentId | null;
  readonly cwd: string | null;
  readonly queryClient: QueryClient;
}) {
  return mutationOptions({
    mutationKey: gitDiffMutationKeys.deleteReviewNote(input.environmentId, input.cwd),
    mutationFn: async (id: string): Promise<GitDiffActionResult> => {
      if (!input.environmentId || !input.cwd) {
        throw new Error("Git diff review notes are unavailable.");
      }
      const request: DeleteGitDiffReviewNoteInput = {
        cwd: input.cwd,
        id,
      };
      return ensureEnvironmentApi(input.environmentId).gitDiff.deleteReviewNote(request);
    },
    onSettled: async () => {
      await invalidateGitDiffReviewNotesQueries(input.queryClient, {
        environmentId: input.environmentId,
        cwd: input.cwd,
      });
      await invalidateGitDiffQueries(input.queryClient, input);
    },
  });
}

export function gitDiffUpdateReviewSessionMutationOptions(input: {
  readonly environmentId: EnvironmentId | null;
  readonly cwd: string | null;
  readonly queryClient: QueryClient;
}) {
  return mutationOptions({
    mutationKey: gitDiffMutationKeys.updateReviewSession(input.environmentId, input.cwd),
    mutationFn: async (
      args: Omit<UpdateGitDiffReviewSessionInput, "cwd">,
    ): Promise<GitDiffActionResult> => {
      if (!input.environmentId || !input.cwd) {
        throw new Error("Git diff review session is unavailable.");
      }
      return ensureEnvironmentApi(input.environmentId).gitDiff.updateReviewSession({
        cwd: input.cwd,
        ...args,
      });
    },
    onSettled: async () => {
      await input.queryClient.invalidateQueries({
        queryKey: gitDiffQueryKeys.reviewSession(input.environmentId, input.cwd),
      });
    },
  });
}

export function gitDiffRequestReviewNavigationMutationOptions(input: {
  readonly environmentId: EnvironmentId | null;
  readonly cwd: string | null;
}) {
  return mutationOptions({
    mutationKey: gitDiffMutationKeys.requestReviewNavigation(input.environmentId, input.cwd),
    mutationFn: async (
      args: Omit<RequestGitDiffReviewNavigationInput, "cwd">,
    ): Promise<GitDiffActionResult> => {
      if (!input.environmentId || !input.cwd) {
        throw new Error("Git diff review navigation is unavailable.");
      }
      return ensureEnvironmentApi(input.environmentId).gitDiff.requestReviewNavigation({
        cwd: input.cwd,
        ...args,
      });
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

export function gitDiffDiscardWorktreeHunkMutationOptions(input: {
  readonly environmentId: EnvironmentId | null;
  readonly cwd: string | null;
  readonly queryClient: QueryClient;
}) {
  return mutationOptions({
    mutationKey: gitDiffMutationKeys.discardWorktreeHunk(input.environmentId, input.cwd),
    mutationFn: async (
      args: Omit<DiscardGitDiffWorktreeHunkInput, "cwd">,
    ): Promise<DiscardGitDiffWorktreeHunkResult> => {
      if (!input.environmentId || !input.cwd) {
        throw new Error("Git hunk discard is unavailable.");
      }
      return ensureEnvironmentApi(input.environmentId).gitDiff.discardWorktreeHunk({
        cwd: input.cwd,
        ...args,
      });
    },
    onSettled: async () => {
      await invalidateGitDiffQueries(input.queryClient, input);
    },
  });
}

export function gitDiffAmendStagedChangesMutationOptions(input: {
  readonly environmentId: EnvironmentId | null;
  readonly cwd: string | null;
  readonly queryClient: QueryClient;
}) {
  return mutationOptions({
    mutationKey: gitDiffMutationKeys.amendStagedChanges(input.environmentId, input.cwd),
    mutationFn: async (
      args: Omit<AmendGitDiffStagedChangesInput, "cwd">,
    ): Promise<AmendGitDiffStagedChangesResult> => {
      if (!input.environmentId || !input.cwd) {
        throw new Error("Git amend is unavailable.");
      }
      return ensureEnvironmentApi(input.environmentId).gitDiff.amendStagedChanges({
        cwd: input.cwd,
        ...args,
      });
    },
    onSettled: async () => {
      await invalidateGitDiffQueries(input.queryClient, input);
    },
  });
}

export function gitDiffRevertCommitMutationOptions(input: {
  readonly environmentId: EnvironmentId | null;
  readonly cwd: string | null;
  readonly queryClient: QueryClient;
}) {
  return mutationOptions({
    mutationKey: gitDiffMutationKeys.revertCommit(input.environmentId, input.cwd),
    mutationFn: async (
      args: Omit<GitDiffCommitReferenceInput, "cwd">,
    ): Promise<GitDiffCommitActionResult> => {
      if (!input.environmentId || !input.cwd) {
        throw new Error("Git revert is unavailable.");
      }
      return ensureEnvironmentApi(input.environmentId).gitDiff.revertCommit({
        cwd: input.cwd,
        ...args,
      });
    },
    onSettled: async () => {
      await invalidateGitDiffQueries(input.queryClient, input);
    },
  });
}

export function gitDiffCherryPickCommitMutationOptions(input: {
  readonly environmentId: EnvironmentId | null;
  readonly cwd: string | null;
  readonly queryClient: QueryClient;
}) {
  return mutationOptions({
    mutationKey: gitDiffMutationKeys.cherryPickCommit(input.environmentId, input.cwd),
    mutationFn: async (
      args: Omit<GitDiffCommitReferenceInput, "cwd">,
    ): Promise<GitDiffCommitActionResult> => {
      if (!input.environmentId || !input.cwd) {
        throw new Error("Git cherry-pick is unavailable.");
      }
      return ensureEnvironmentApi(input.environmentId).gitDiff.cherryPickCommit({
        cwd: input.cwd,
        ...args,
      });
    },
    onSettled: async () => {
      await invalidateGitDiffQueries(input.queryClient, input);
    },
  });
}

export function gitDiffContinueOperationMutationOptions(input: {
  readonly environmentId: EnvironmentId | null;
  readonly cwd: string | null;
  readonly queryClient: QueryClient;
}) {
  return mutationOptions({
    mutationKey: gitDiffMutationKeys.continueOperation(input.environmentId, input.cwd),
    mutationFn: async (
      args: Omit<GitDiffOperationActionInput, "cwd"> = {},
    ): Promise<GitDiffOperationActionResult> => {
      if (!input.environmentId || !input.cwd) {
        throw new Error("Git operation continue is unavailable.");
      }
      return ensureEnvironmentApi(input.environmentId).gitDiff.continueOperation({
        cwd: input.cwd,
        ...args,
      });
    },
    onSettled: async () => {
      await invalidateGitDiffQueries(input.queryClient, input);
    },
  });
}

export function gitDiffAbortOperationMutationOptions(input: {
  readonly environmentId: EnvironmentId | null;
  readonly cwd: string | null;
  readonly queryClient: QueryClient;
}) {
  return mutationOptions({
    mutationKey: gitDiffMutationKeys.abortOperation(input.environmentId, input.cwd),
    mutationFn: async (
      args: Omit<GitDiffOperationActionInput, "cwd"> = {},
    ): Promise<GitDiffOperationActionResult> => {
      if (!input.environmentId || !input.cwd) {
        throw new Error("Git operation abort is unavailable.");
      }
      return ensureEnvironmentApi(input.environmentId).gitDiff.abortOperation({
        cwd: input.cwd,
        ...args,
      });
    },
    onSettled: async () => {
      await invalidateGitDiffQueries(input.queryClient, input);
    },
  });
}

export function gitDiffCreateStashMutationOptions(input: {
  readonly environmentId: EnvironmentId | null;
  readonly cwd: string | null;
  readonly queryClient: QueryClient;
}) {
  return mutationOptions({
    mutationKey: gitDiffMutationKeys.createStash(input.environmentId, input.cwd),
    mutationFn: async (
      args: Omit<CreateGitDiffStashInput, "cwd">,
    ): Promise<CreateGitDiffStashResult> => {
      if (!input.environmentId || !input.cwd) {
        throw new Error("Git stash creation is unavailable.");
      }
      return ensureEnvironmentApi(input.environmentId).gitDiff.createStash({
        cwd: input.cwd,
        ...args,
      });
    },
    onSettled: async () => {
      await invalidateGitDiffQueries(input.queryClient, input);
    },
  });
}

export function gitDiffApplyStashMutationOptions(input: {
  readonly environmentId: EnvironmentId | null;
  readonly cwd: string | null;
  readonly queryClient: QueryClient;
}) {
  return mutationOptions({
    mutationKey: gitDiffMutationKeys.applyStash(input.environmentId, input.cwd),
    mutationFn: async (args: Omit<GitDiffStashReferenceInput, "cwd">) => {
      if (!input.environmentId || !input.cwd) {
        throw new Error("Git stash apply is unavailable.");
      }
      return ensureEnvironmentApi(input.environmentId).gitDiff.applyStash({
        cwd: input.cwd,
        ...args,
      });
    },
    onSettled: async () => {
      await invalidateGitDiffQueries(input.queryClient, input);
    },
  });
}

export function gitDiffPopStashMutationOptions(input: {
  readonly environmentId: EnvironmentId | null;
  readonly cwd: string | null;
  readonly queryClient: QueryClient;
}) {
  return mutationOptions({
    mutationKey: gitDiffMutationKeys.popStash(input.environmentId, input.cwd),
    mutationFn: async (args: Omit<GitDiffStashReferenceInput, "cwd">) => {
      if (!input.environmentId || !input.cwd) {
        throw new Error("Git stash pop is unavailable.");
      }
      return ensureEnvironmentApi(input.environmentId).gitDiff.popStash({
        cwd: input.cwd,
        ...args,
      });
    },
    onSettled: async () => {
      await invalidateGitDiffQueries(input.queryClient, input);
    },
  });
}

export function gitDiffDropStashMutationOptions(input: {
  readonly environmentId: EnvironmentId | null;
  readonly cwd: string | null;
  readonly queryClient: QueryClient;
}) {
  return mutationOptions({
    mutationKey: gitDiffMutationKeys.dropStash(input.environmentId, input.cwd),
    mutationFn: async (args: Omit<GitDiffStashReferenceInput, "cwd">) => {
      if (!input.environmentId || !input.cwd) {
        throw new Error("Git stash drop is unavailable.");
      }
      return ensureEnvironmentApi(input.environmentId).gitDiff.dropStash({
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
