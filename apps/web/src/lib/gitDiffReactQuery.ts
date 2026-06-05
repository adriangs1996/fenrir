import type {
  DiffTarget,
  EnvironmentId,
  GitDiffFileSummary,
  LoadDiffFileInput,
  LoadDiffFileIndexInput,
  LoadDiffFileResult,
  LoadStackedDiffFileIndexInput,
  LoadStackedDiffFileIndexResult,
} from "@fenrir/contracts";
import { queryOptions, type QueryClient } from "@tanstack/react-query";

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
};

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
