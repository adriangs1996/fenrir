import type {
  EnvironmentId,
  ReviewApplyRawMutationInput,
  ReviewApplyRawMutationResult,
  ReviewDiffFilePatch,
  ReviewDiffSnapshot,
  ReviewGetFilePatchInput,
  ReviewGetOrCreateSessionInput,
  ReviewRawLaneKind,
  ReviewSessionId,
  ReviewSessionSnapshot,
  ReviewSessionSummary,
} from "@fenrir/contracts";
import { mutationOptions, queryOptions, type QueryClient } from "@tanstack/react-query";

import { ensureEnvironmentApi } from "../environmentApi";
import { invalidateGitQueries } from "./gitReactQuery";

export const sourceControlReviewQueryKeys = {
  all: ["source-control-review"] as const,
  session: (environmentId: EnvironmentId | null, sessionId: ReviewSessionId | null) =>
    ["source-control-review", environmentId, sessionId] as const,
  diff: (environmentId: EnvironmentId | null, sessionId: ReviewSessionId | null) =>
    ["source-control-review", environmentId, sessionId, "diff"] as const,
  filePatch: (
    environmentId: EnvironmentId | null,
    sessionId: ReviewSessionId | null,
    lane: ReviewRawLaneKind | null,
    normalizedPath: string | null,
  ) =>
    [
      "source-control-review",
      environmentId,
      sessionId,
      "file-patch",
      lane,
      normalizedPath,
    ] as const,
};

export function sourceControlReviewGetOrCreateSessionQueryOptions(input: {
  environmentId: EnvironmentId | null;
  request: ReviewGetOrCreateSessionInput | null;
}) {
  return queryOptions({
    queryKey: [
      "source-control-review",
      input.environmentId,
      "get-or-create",
      input.request?.threadId ?? null,
      input.request?.mode ?? null,
      input.request?.scope ?? null,
    ] as const,
    queryFn: async () => {
      if (!input.environmentId || !input.request) {
        throw new Error("Source-control review session is unavailable.");
      }
      return ensureEnvironmentApi(input.environmentId).sourceControl.review.getOrCreateSession(
        input.request,
      ) as Promise<ReviewSessionSummary>;
    },
    enabled: input.environmentId !== null && input.request !== null,
    staleTime: 10_000,
  });
}

export function sourceControlReviewSessionSnapshotQueryOptions(input: {
  environmentId: EnvironmentId | null;
  sessionId: ReviewSessionId | null;
}) {
  return queryOptions({
    queryKey: sourceControlReviewQueryKeys.session(input.environmentId, input.sessionId),
    queryFn: async () => {
      if (!input.environmentId || !input.sessionId) {
        throw new Error("Source-control review snapshot is unavailable.");
      }
      return ensureEnvironmentApi(input.environmentId).sourceControl.review.getSessionSnapshot({
        sessionId: input.sessionId,
      }) as Promise<ReviewSessionSnapshot>;
    },
    enabled: input.environmentId !== null && input.sessionId !== null,
    staleTime: 5_000,
  });
}

export function sourceControlReviewDiffSnapshotQueryOptions(input: {
  environmentId: EnvironmentId | null;
  sessionId: ReviewSessionId | null;
}) {
  return queryOptions({
    queryKey: sourceControlReviewQueryKeys.diff(input.environmentId, input.sessionId),
    queryFn: async () => {
      if (!input.environmentId || !input.sessionId) {
        throw new Error("Source-control review diff is unavailable.");
      }
      return ensureEnvironmentApi(input.environmentId).sourceControl.review.getDiffSnapshot({
        sessionId: input.sessionId,
      }) as Promise<ReviewDiffSnapshot>;
    },
    enabled: input.environmentId !== null && input.sessionId !== null,
    staleTime: 5_000,
  });
}

export function sourceControlReviewFilePatchQueryOptions(input: {
  environmentId: EnvironmentId | null;
  sessionId: ReviewSessionId | null;
  lane: ReviewRawLaneKind | null;
  normalizedPath: string | null;
}) {
  return queryOptions({
    queryKey: sourceControlReviewQueryKeys.filePatch(
      input.environmentId,
      input.sessionId,
      input.lane,
      input.normalizedPath,
    ),
    queryFn: async () => {
      if (!input.environmentId || !input.sessionId || !input.lane || !input.normalizedPath) {
        throw new Error("Source-control review patch is unavailable.");
      }
      const request: ReviewGetFilePatchInput = {
        sessionId: input.sessionId,
        lane: input.lane,
        normalizedPath: input.normalizedPath,
      };
      return ensureEnvironmentApi(input.environmentId).sourceControl.review.getFilePatch(
        request,
      ) as Promise<ReviewDiffFilePatch | null>;
    },
    enabled:
      input.environmentId !== null &&
      input.sessionId !== null &&
      input.lane !== null &&
      input.normalizedPath !== null,
    staleTime: 5_000,
  });
}

export function sourceControlReviewRawMutationOptions(input: {
  environmentId: EnvironmentId | null;
  cwd: string | null;
  queryClient: QueryClient;
}) {
  return mutationOptions({
    mutationKey: ["source-control-review", input.environmentId, "raw-mutation"] as const,
    mutationFn: async (request: ReviewApplyRawMutationInput) => {
      if (!input.environmentId) {
        throw new Error("Source-control review mutation is unavailable.");
      }
      return ensureEnvironmentApi(input.environmentId).sourceControl.review.applyRawMutation(
        request,
      ) as Promise<ReviewApplyRawMutationResult>;
    },
    onSettled: async (_result, _error, request) => {
      await Promise.all([
        input.queryClient.invalidateQueries({
          queryKey: sourceControlReviewQueryKeys.session(input.environmentId, request.sessionId),
        }),
        input.queryClient.invalidateQueries({
          queryKey: sourceControlReviewQueryKeys.diff(input.environmentId, request.sessionId),
        }),
        input.queryClient.invalidateQueries({
          queryKey: ["source-control-review", input.environmentId, request.sessionId, "file-patch"],
        }),
        invalidateGitQueries(input.queryClient, {
          environmentId: input.environmentId,
          cwd: input.cwd,
        }),
      ]);
    },
  });
}
