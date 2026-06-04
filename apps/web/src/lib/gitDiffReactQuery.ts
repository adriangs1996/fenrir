import type { EnvironmentId, GitDiffFileSummary, LoadDiffFileIndexInput } from "@fenrir/contracts";
import { queryOptions, type QueryClient } from "@tanstack/react-query";

import { ensureEnvironmentApi } from "../environmentApi";

export type GitDiffTargetKind = "worktree" | "staged";

export const gitDiffQueryKeys = {
  all: ["git-diff"] as const,
  fileIndex: (
    environmentId: EnvironmentId | null,
    cwd: string | null,
    targetKind: GitDiffTargetKind,
  ) => ["git-diff", environmentId, cwd, "file-index", targetKind] as const,
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

export function invalidateGitDiffQueries(
  queryClient: QueryClient,
  input?: { readonly environmentId?: EnvironmentId | null; readonly cwd?: string | null },
) {
  const environmentId = input?.environmentId ?? null;
  const cwd = input?.cwd ?? null;
  if (cwd !== null) {
    return Promise.all([
      queryClient.invalidateQueries({
        queryKey: gitDiffQueryKeys.fileIndex(environmentId, cwd, "worktree"),
      }),
      queryClient.invalidateQueries({
        queryKey: gitDiffQueryKeys.fileIndex(environmentId, cwd, "staged"),
      }),
    ]);
  }

  return queryClient.invalidateQueries({ queryKey: gitDiffQueryKeys.all });
}
