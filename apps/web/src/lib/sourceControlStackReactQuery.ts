import type {
  EnvironmentId,
  SourceControlStackCreateEntryInput,
  SourceControlStackDropEntryInput,
  SourceControlStackGetSnapshotInput,
  SourceControlStackMutationResult,
  SourceControlStackPublishInput,
  SourceControlStackRenameEntryInput,
  SourceControlStackReorderInput,
  SourceControlStackRestackInput,
  SourceControlStackSnapshot,
  SourceControlStackSplitEntryInput,
  SourceControlStackSquashEntryInput,
  SourceControlStackSwitchEntryInput,
  SourceControlStackSyncInput,
  ThreadId,
} from "@fenrir/contracts";
import { mutationOptions, queryOptions, type QueryClient } from "@tanstack/react-query";

import { ensureEnvironmentApi } from "../environmentApi";
import { invalidateGitQueries } from "./gitReactQuery";

export const sourceControlStackQueryKeys = {
  all: ["source-control-stack"] as const,
  snapshot: (environmentId: EnvironmentId | null, threadId: ThreadId | null) =>
    ["source-control-stack", environmentId, threadId] as const,
};

export function sourceControlStackSnapshotQueryOptions(input: {
  environmentId: EnvironmentId | null;
  threadId: ThreadId | null;
  selectedHeadRefName?: string;
}) {
  return queryOptions({
    queryKey: sourceControlStackQueryKeys.snapshot(input.environmentId, input.threadId),
    queryFn: async () => {
      if (!input.environmentId || !input.threadId) {
        throw new Error("Source-control stack is unavailable.");
      }
      const request: SourceControlStackGetSnapshotInput = {
        threadId: input.threadId,
        ...(input.selectedHeadRefName ? { selectedHeadRefName: input.selectedHeadRefName } : {}),
      };
      return ensureEnvironmentApi(input.environmentId).sourceControl.stack.getSnapshot(
        request,
      ) as Promise<SourceControlStackSnapshot>;
    },
    enabled: input.environmentId !== null && input.threadId !== null,
    staleTime: 5_000,
  });
}

export function invalidateSourceControlStackQueries(
  queryClient: QueryClient,
  input?: { readonly environmentId?: EnvironmentId | null; readonly threadId?: ThreadId | null },
) {
  if (input?.environmentId !== undefined && input.threadId !== undefined) {
    return queryClient.invalidateQueries({
      queryKey: sourceControlStackQueryKeys.snapshot(input.environmentId, input.threadId),
    });
  }
  return queryClient.invalidateQueries({ queryKey: sourceControlStackQueryKeys.all });
}

type StackMutationInput =
  | SourceControlStackCreateEntryInput
  | SourceControlStackSwitchEntryInput
  | SourceControlStackRenameEntryInput
  | SourceControlStackDropEntryInput
  | SourceControlStackReorderInput
  | SourceControlStackRestackInput
  | SourceControlStackSyncInput
  | SourceControlStackSquashEntryInput
  | SourceControlStackSplitEntryInput
  | SourceControlStackPublishInput;

export function sourceControlStackMutationOptions<TInput extends StackMutationInput>(input: {
  environmentId: EnvironmentId | null;
  cwd: string | null;
  queryClient: QueryClient;
  mutationKey: readonly unknown[];
  run: (api: ReturnType<typeof ensureEnvironmentApi>, request: TInput) => Promise<unknown>;
}) {
  return mutationOptions({
    mutationKey: input.mutationKey,
    mutationFn: async (request: TInput) => {
      if (!input.environmentId) {
        throw new Error("Source-control stack mutation is unavailable.");
      }
      return input.run(
        ensureEnvironmentApi(input.environmentId),
        request,
      ) as Promise<SourceControlStackMutationResult>;
    },
    onSettled: async (_result, _error, request) => {
      await Promise.all([
        invalidateSourceControlStackQueries(input.queryClient, {
          environmentId: input.environmentId,
          threadId: request.threadId,
        }),
        invalidateGitQueries(input.queryClient, {
          environmentId: input.environmentId,
          cwd: input.cwd,
        }),
      ]);
    },
  });
}
