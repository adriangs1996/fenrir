import type {
  ReviewApplyRawMutationInput,
  ReviewDiffFileEntry,
  ReviewChunkId,
  ReviewFileId,
  ReviewProgressState,
  ReviewRawLaneKind,
  SourceControlStackEntry,
  SourceControlStackCreateEntryInput,
  SourceControlStackSwitchEntryInput,
  SourceControlStackRestackInput,
  SourceControlStackSyncInput,
  SourceControlStackPublishInput,
  SourceControlStackContinueOperationInput,
  SourceControlStackAbortOperationInput,
  SourceControlStackEntryId,
  SourceControlStackMutationResult,
  SourceControlStackOperationId,
  SourceControlStackStreamEvent,
} from "@fenrir/contracts";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useParams } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";

import { SidebarInset } from "~/components/ui/sidebar";
import { ensureEnvironmentApi } from "~/environmentApi";
import {
  sourceControlReviewDiffSnapshotQueryOptions,
  sourceControlReviewFilePatchQueryOptions,
  sourceControlReviewGetOrCreateSessionQueryOptions,
  sourceControlReviewQueryKeys,
  sourceControlReviewRawMutationOptions,
  sourceControlReviewSessionSnapshotQueryOptions,
} from "~/lib/sourceControlReviewReactQuery";
import {
  sourceControlStackQueryKeys,
  sourceControlStackSnapshotQueryOptions,
} from "~/lib/sourceControlStackReactQuery";
import { selectProjectByRef, selectThreadByRef, useStore } from "~/store";
import { resolveThreadRouteRef } from "~/threadRoutes";
import { GitDiffWorkbenchShell } from "./GitDiffWorkbenchShell";
import type { DiffViewMode } from "./stackUiState";
import { RAW_LANE_ORDER } from "./stackUiState";

function errorMessage(error: unknown): string {
  if (typeof error === "object" && error !== null && "message" in error) {
    const message = error.message;
    return typeof message === "string" ? message : "Operation failed.";
  }
  return "Operation failed.";
}

function isRefreshConflict(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "_tag" in error &&
    error._tag === "ReviewMutationConflictError"
  );
}

export function GitDiffWorkbenchRoute() {
  const params = useParams({ from: "/_chat/$environmentId/$threadId/gitdiff" });
  const threadRef = useMemo(() => resolveThreadRouteRef(params), [params]);
  const thread = useStore((state) => selectThreadByRef(state, threadRef));
  const project = useStore((state) =>
    selectProjectByRef(
      state,
      thread
        ? {
            environmentId: thread.environmentId,
            projectId: thread.projectId,
          }
        : null,
    ),
  );
  const environmentId = threadRef?.environmentId ?? null;
  const threadId = threadRef?.threadId ?? null;
  const cwd = thread?.worktreePath ?? project?.cwd ?? null;
  const queryClient = useQueryClient();
  const [selectedLane, setSelectedLane] = useState<ReviewRawLaneKind | null>(null);
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [selectedEntryId, setSelectedEntryId] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<DiffViewMode>("unified");
  const [wrap, setWrap] = useState(true);
  const [staleMessage, setStaleMessage] = useState<string | null>(null);
  const [stackResult, setStackResult] = useState<SourceControlStackMutationResult | null>(null);
  const [stackConflict, setStackConflict] = useState<Extract<
    SourceControlStackStreamEvent,
    { _tag: "operationConflict" }
  > | null>(null);

  const sessionQuery = useQuery(
    sourceControlReviewGetOrCreateSessionQueryOptions({
      environmentId,
      request: threadId
        ? {
            threadId,
            mode: "raw",
            scope: "combined",
          }
        : null,
    }),
  );
  const sessionId = sessionQuery.data?.id ?? null;
  const reviewSnapshotQuery = useQuery(
    sourceControlReviewSessionSnapshotQueryOptions({ environmentId, sessionId }),
  );
  const diffSnapshotQuery = useQuery(
    sourceControlReviewDiffSnapshotQueryOptions({ environmentId, sessionId }),
  );
  const stackSnapshotQuery = useQuery(
    sourceControlStackSnapshotQueryOptions({ environmentId, threadId }),
  );

  const lanes = useMemo(() => {
    const raw = diffSnapshotQuery.data?.lanes ?? [];
    return raw.toSorted(
      (left, right) => RAW_LANE_ORDER.indexOf(left.kind) - RAW_LANE_ORDER.indexOf(right.kind),
    );
  }, [diffSnapshotQuery.data?.lanes]);
  const selectedPatchQuery = useQuery(
    sourceControlReviewFilePatchQueryOptions({
      environmentId,
      sessionId,
      lane: selectedLane,
      normalizedPath: selectedPath,
    }),
  );

  useEffect(() => {
    if (!selectedLane || !lanes.some((lane) => lane.kind === selectedLane && lane.fileCount > 0)) {
      setSelectedLane(lanes.find((lane) => lane.fileCount > 0)?.kind ?? null);
    }
  }, [lanes, selectedLane]);

  useEffect(() => {
    const lane = lanes.find((candidate) => candidate.kind === selectedLane);
    if (!lane) {
      setSelectedPath(null);
      return;
    }
    if (!selectedPath || !lane.files.some((file) => file.normalizedPath === selectedPath)) {
      setSelectedPath(lane.files[0]?.normalizedPath ?? null);
    }
  }, [lanes, selectedLane, selectedPath]);

  useEffect(() => {
    if (!environmentId || !sessionId) return;
    const api = ensureEnvironmentApi(environmentId);
    return api.sourceControl.review.onEvent({ sessionId }, () => {
      void queryClient.invalidateQueries({
        queryKey: sourceControlReviewQueryKeys.session(environmentId, sessionId),
      });
      void queryClient.invalidateQueries({
        queryKey: sourceControlReviewQueryKeys.diff(environmentId, sessionId),
      });
    });
  }, [environmentId, queryClient, sessionId]);

  useEffect(() => {
    if (!environmentId || !threadId) return;
    const api = ensureEnvironmentApi(environmentId);
    return api.sourceControl.stack.onEvent({ threadId }, (event) => {
      const stackEvent = event as SourceControlStackStreamEvent;
      if (stackEvent._tag === "snapshotReplaced") {
        queryClient.setQueryData(
          sourceControlStackQueryKeys.snapshot(environmentId, threadId),
          stackEvent.snapshot,
        );
      } else if (stackEvent._tag === "operationConflict") {
        setStackConflict(stackEvent);
      } else if (stackEvent._tag === "operationCompleted") {
        setStackResult(stackEvent.result);
        setStackConflict(null);
      }
      void queryClient.invalidateQueries({
        queryKey: sourceControlStackQueryKeys.snapshot(environmentId, threadId),
      });
    });
  }, [environmentId, queryClient, threadId]);

  const rawMutation = useMutation({
    ...sourceControlReviewRawMutationOptions({ environmentId, cwd, queryClient }),
    onError: (error) => {
      setStaleMessage(
        isRefreshConflict(error)
          ? "This diff selection is stale. Refresh before applying another mutation."
          : errorMessage(error),
      );
    },
    onSuccess: () => setStaleMessage(null),
  });

  const progressMutation = useMutation({
    mutationFn: async (input: {
      readonly fileId?: ReviewFileId;
      readonly chunkId?: ReviewChunkId;
      readonly progressState: ReviewProgressState;
    }) => {
      if (!environmentId || !sessionId) throw new Error("Review progress is unavailable.");
      await ensureEnvironmentApi(environmentId).sourceControl.review.setProgress({
        sessionId,
        ...(input.fileId ? { fileId: input.fileId } : {}),
        ...(input.chunkId ? { chunkId: input.chunkId } : {}),
        progressState: input.progressState,
      });
    },
    onSettled: async () => {
      await queryClient.invalidateQueries({
        queryKey: sourceControlReviewQueryKeys.session(environmentId, sessionId),
      });
    },
  });

  const stackMutation = useMutation({
    mutationKey: ["source-control-stack", environmentId, "mutation"] as const,
    mutationFn: async (request: StackMutationRequest) => {
      if (!environmentId) throw new Error("Source-control stack mutation is unavailable.");
      const api = ensureEnvironmentApi(environmentId);
      switch (request._kind) {
        case "create":
          return api.sourceControl.stack.createEntry(
            stripKind(request),
          ) as Promise<SourceControlStackMutationResult>;
        case "switch":
          return api.sourceControl.stack.switchEntry(
            stripKind(request),
          ) as Promise<SourceControlStackMutationResult>;
        case "restack":
          return api.sourceControl.stack.restack(
            stripKind(request),
          ) as Promise<SourceControlStackMutationResult>;
        case "sync":
          return api.sourceControl.stack.sync(
            stripKind(request),
          ) as Promise<SourceControlStackMutationResult>;
        case "publish":
          return api.sourceControl.stack.publish(
            stripKind(request),
          ) as Promise<SourceControlStackMutationResult>;
        case "continue":
          return api.sourceControl.stack.continueOperation(
            stripKind(request),
          ) as Promise<SourceControlStackMutationResult>;
        case "abort":
          return api.sourceControl.stack.abortOperation(
            stripKind(request),
          ) as Promise<SourceControlStackMutationResult>;
      }
    },
    onSettled: async () => {
      await queryClient.invalidateQueries({
        queryKey: sourceControlStackQueryKeys.snapshot(environmentId, threadId),
      });
    },
  });

  function runStackMutation(request: StackMutationRequest) {
    stackMutation.mutate(request, {
      onSuccess: (result) => setStackResult(result),
      onError: (error) => {
        const snapshot = stackSnapshotQuery.data;
        if (!snapshot) return;
        setStackResult({
          operationId: "source-control-stack-operation-ui-error" as SourceControlStackOperationId,
          status: "blocked",
          message: errorMessage(error),
          snapshot,
        });
      },
    });
  }

  const handleCreateEntry = () => {
    if (!threadId) return;
    const branchName = window.prompt("Branch name for the new stack entry");
    if (!branchName) return;
    const title = window.prompt("Title", branchName) ?? branchName;
    runStackMutation({
      _kind: "create",
      threadId,
      parentEntryId: selectedEntryId as SourceControlStackEntryId | null,
      position: "below",
      branchName,
      title,
    });
  };

  const handleRefresh = () => {
    setStaleMessage(null);
    if (sessionId) {
      void queryClient.invalidateQueries({
        queryKey: sourceControlReviewQueryKeys.session(environmentId, sessionId),
      });
      void queryClient.invalidateQueries({
        queryKey: sourceControlReviewQueryKeys.diff(environmentId, sessionId),
      });
    }
  };

  if (!thread || !project || !cwd) {
    return (
      <SidebarInset className="h-dvh min-h-0 overflow-hidden bg-background text-foreground">
        <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
          Git Diff Workbench needs an active thread.
        </div>
      </SidebarInset>
    );
  }

  return (
    <SidebarInset className="h-dvh min-h-0 overflow-hidden bg-background text-foreground">
      <GitDiffWorkbenchShell
        cwd={cwd}
        sessionId={sessionId}
        reviewSnapshot={reviewSnapshotQuery.data ?? null}
        stackSnapshot={stackSnapshotQuery.data ?? null}
        lanes={lanes}
        selectedLane={selectedLane}
        selectedPath={selectedPath}
        selectedEntryId={selectedEntryId}
        selectedPatch={selectedPatchQuery.data ?? null}
        patchLoading={selectedPatchQuery.isLoading}
        viewMode={viewMode}
        wrap={wrap}
        rawMutationPending={rawMutation.isPending}
        stackMutationPending={stackMutation.isPending}
        staleMessage={staleMessage}
        stackResult={stackResult}
        stackConflict={stackConflict}
        onSelectLane={(lane) => {
          setSelectedLane(lane);
          setSelectedPath(null);
        }}
        onSelectFile={(file: ReviewDiffFileEntry) => setSelectedPath(file.normalizedPath)}
        onSelectEntry={(entry: SourceControlStackEntry) => setSelectedEntryId(entry.id)}
        onSwitchEntry={(entry) => {
          if (!threadId) return;
          runStackMutation({ _kind: "switch", threadId, entryId: entry.id });
        }}
        onCreateEntry={handleCreateEntry}
        onRestack={() => threadId && runStackMutation({ _kind: "restack", threadId })}
        onSync={() => threadId && runStackMutation({ _kind: "sync", threadId, fetch: true })}
        onPublish={() =>
          threadId &&
          runStackMutation({
            _kind: "publish",
            threadId,
            createMissingChangeRequests: true,
            updateExistingChangeRequests: true,
          })
        }
        onContinueConflict={() =>
          threadId &&
          stackConflict &&
          runStackMutation({
            _kind: "continue",
            threadId,
            operationId: stackConflict.operationId,
          })
        }
        onAbortConflict={() =>
          threadId &&
          stackConflict &&
          runStackMutation({
            _kind: "abort",
            threadId,
            operationId: stackConflict.operationId,
          })
        }
        onRefresh={handleRefresh}
        onRawMutation={(input: ReviewApplyRawMutationInput) => rawMutation.mutate(input)}
        onProgress={(input) => progressMutation.mutate(input)}
        onViewModeChange={setViewMode}
        onWrapChange={setWrap}
      />
    </SidebarInset>
  );
}

type StackMutationRequest =
  | ({ readonly _kind: "create" } & SourceControlStackCreateEntryInput)
  | ({ readonly _kind: "switch" } & SourceControlStackSwitchEntryInput)
  | ({ readonly _kind: "restack" } & SourceControlStackRestackInput)
  | ({ readonly _kind: "sync" } & SourceControlStackSyncInput)
  | ({ readonly _kind: "publish" } & SourceControlStackPublishInput)
  | ({ readonly _kind: "continue" } & SourceControlStackContinueOperationInput)
  | ({ readonly _kind: "abort" } & SourceControlStackAbortOperationInput);

function stripKind<T extends { readonly _kind: string }>(request: T): Omit<T, "_kind"> {
  const { _kind: _ignored, ...rest } = request;
  return rest;
}
