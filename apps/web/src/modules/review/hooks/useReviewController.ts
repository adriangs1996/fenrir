import { scopedThreadKey, scopeThreadRef } from "@fenrir/client-runtime";
import type { EnvironmentId, ThreadId } from "@fenrir/contracts";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useShallow } from "zustand/react/shallow";
import { useComposerDraftStore } from "~/composerDraftStore";
import { openInEmbeddedEditor, openInPreferredEditor } from "~/editorPreferences";
import { readEnvironmentConnection, useSavedEnvironmentRuntimeStore } from "~/environments/runtime";
import { randomUUID } from "~/lib/utils";
import { readLocalApi } from "~/localApi";
import { useEditorStore } from "~/modules/neovim-editor";
import { useServerProviders } from "~/rpc/serverState";
import type {
  GitHubReviewDecision,
  ReviewApplyRawMutationResult,
  ReviewAnalysisTargetRef,
  ReviewAnalysisArtifact,
  ReviewChunkPayload,
  ReviewDiffFilePatch,
  ReviewDiffSnapshot,
  ReviewGetSessionInput,
  ReviewProgressState,
  ReviewRawLaneKind,
  ReviewRawMutationAction,
  ReviewSessionSnapshot,
  ReviewSessionSummary,
  ReviewStreamEvent,
} from "../../../../../../packages/contracts/src/review.ts";
import type { ReviewRawSelectionTarget } from "../rawState";
import type { ReviewRouteState } from "../routeSearch";
import {
  countVisibleLocalThreads,
  countVisibleOverviewNotes,
  deriveReviewProviderAvailability,
  filterVisibleFileIds,
  findChunkPayload,
} from "../state";
import { reviewCacheKeys, useReviewStore } from "../store";
import {
  dedupeReviewContextChunkRefs,
  type ReviewContextAttachmentDraft,
  type ReviewContextChunkRef,
  type ReviewContextChunkSnapshot,
} from "../reviewComposer";

interface UseReviewControllerInput {
  readonly environmentId: EnvironmentId;
  readonly threadId: ThreadId;
  readonly routeKind: "server" | "draft";
  readonly routeState: ReviewRouteState;
  readonly active: boolean;
}

interface RequestHandle {
  readonly requestId: number;
  readonly sessionId: ReviewGetSessionInput["sessionId"];
}

interface AnalysisRequestState {
  readonly status: "idle" | "running" | "error";
  readonly action: "generate" | "refresh" | null;
  readonly error: string | null;
}

function errorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim().length > 0) {
    return error.message;
  }
  return String(error);
}

function defaultAuthorSnapshot() {
  return {
    authSessionId: "auth-session-review-user",
    subject: "Current session",
    role: "user" as const,
    clientLabel: "Fenrir",
  };
}

function headerFromPatch(rawPatch: string): string {
  const header = rawPatch.split("\n", 1)[0]?.trim() ?? "";
  return header.length > 0 ? header : "Diff chunk";
}

export function useReviewController(input: UseReviewControllerInput) {
  const threadKey = useMemo(
    () => scopedThreadKey(scopeThreadRef(input.environmentId, input.threadId)),
    [input.environmentId, input.threadId],
  );
  const runtimeState = useSavedEnvironmentRuntimeStore(
    (state) => state.byId[input.environmentId] ?? null,
  );
  const serverProviders = useServerProviders();
  const rpcClient = readEnvironmentConnection(input.environmentId)?.client ?? null;

  const threadState = useReviewStore(useShallow((state) => state.threads[threadKey]));
  const ensureThread = useReviewStore((state) => state.ensureThread);
  const setRouteState = useReviewStore((state) => state.setRouteState);
  const setSessionStatus = useReviewStore((state) => state.setSessionStatus);
  const setLiveStatus = useReviewStore((state) => state.setLiveStatus);
  const applySessionSummary = useReviewStore((state) => state.applySessionSummary);
  const applySessionSnapshot = useReviewStore((state) => state.applySessionSnapshot);
  const setExplorerLoading = useReviewStore((state) => state.setExplorerLoading);
  const applyDiffSnapshot = useReviewStore((state) => state.applyDiffSnapshot);
  const setExplorerError = useReviewStore((state) => state.setExplorerError);
  const setProviderAvailability = useReviewStore((state) => state.setProviderAvailability);
  const setFilters = useReviewStore((state) => state.setFilters);
  const toggleLaneExpanded = useReviewStore((state) => state.toggleLaneExpanded);
  const toggleFileExpanded = useReviewStore((state) => state.toggleFileExpanded);
  const toggleLocalThreadExpanded = useReviewStore((state) => state.toggleLocalThreadExpanded);
  const toggleGitHubThreadExpanded = useReviewStore((state) => state.toggleGitHubThreadExpanded);
  const toggleArtifactExpanded = useReviewStore((state) => state.toggleArtifactExpanded);
  const setFilePatchLoading = useReviewStore((state) => state.setFilePatchLoading);
  const applyFilePatch = useReviewStore((state) => state.applyFilePatch);
  const setFilePatchError = useReviewStore((state) => state.setFilePatchError);
  const setChunkPayloadLoading = useReviewStore((state) => state.setChunkPayloadLoading);
  const applyChunkPayload = useReviewStore((state) => state.applyChunkPayload);
  const setChunkPayloadError = useReviewStore((state) => state.setChunkPayloadError);

  const snapshotRequestRef = useRef<RequestHandle | null>(null);
  const diffRequestRef = useRef<RequestHandle | null>(null);
  const filePatchRequestsRef = useRef<Set<string>>(new Set());
  const chunkPayloadRequestsRef = useRef<Set<string>>(new Set());
  const subscriptionSessionIdRef = useRef<ReviewGetSessionInput["sessionId"] | null>(null);
  const requestIdRef = useRef(0);
  const [analysisRequest, setAnalysisRequest] = useState<AnalysisRequestState>({
    status: "idle",
    action: null,
    error: null,
  });
  const composerThreadRef = useMemo(
    () => scopeThreadRef(input.environmentId, input.threadId),
    [input.environmentId, input.threadId],
  );

  const nextRequestId = useCallback(() => {
    requestIdRef.current += 1;
    return requestIdRef.current;
  }, []);

  const currentThreadState = threadState ?? useReviewStore.getState().threads[threadKey];

  useEffect(() => {
    ensureThread(
      threadKey,
      {
        environmentId: input.environmentId,
        threadId: input.threadId,
        routeKind: input.routeKind,
      },
      input.routeState,
    );
  }, [
    ensureThread,
    input.environmentId,
    input.routeKind,
    input.routeState,
    input.threadId,
    threadKey,
  ]);

  useEffect(() => {
    setRouteState(threadKey, input.routeState);
  }, [input.routeState, setRouteState, threadKey]);

  useEffect(() => {
    setProviderAvailability(
      threadKey,
      deriveReviewProviderAvailability({
        runtimeState,
        serverProviders,
        github: currentThreadState?.snapshot.github ?? null,
      }),
    );
  }, [
    currentThreadState?.snapshot.github,
    runtimeState,
    serverProviders,
    setProviderAvailability,
    threadKey,
  ]);

  const refreshSessionSnapshot = useCallback(
    async (sessionId: ReviewGetSessionInput["sessionId"]) => {
      if (!rpcClient) {
        return;
      }
      const requestId = nextRequestId();
      snapshotRequestRef.current = { requestId, sessionId };
      try {
        const snapshot = (await rpcClient.review.getSessionSnapshot({
          sessionId,
        } satisfies ReviewGetSessionInput)) as ReviewSessionSnapshot;
        if (
          snapshotRequestRef.current?.requestId !== requestId ||
          snapshotRequestRef.current?.sessionId !== sessionId
        ) {
          return;
        }
        applySessionSnapshot(threadKey, snapshot);
      } catch (error) {
        setSessionStatus(threadKey, "error", errorMessage(error));
      }
    },
    [applySessionSnapshot, nextRequestId, rpcClient, setSessionStatus, threadKey],
  );

  const refreshDiffSnapshot = useCallback(
    async (sessionId: ReviewGetSessionInput["sessionId"]) => {
      if (!rpcClient) {
        return;
      }
      const requestId = nextRequestId();
      diffRequestRef.current = { requestId, sessionId };
      setExplorerLoading(threadKey);
      try {
        const snapshot = (await rpcClient.review.getDiffSnapshot({
          sessionId,
        })) as ReviewDiffSnapshot;
        if (
          diffRequestRef.current?.requestId !== requestId ||
          diffRequestRef.current?.sessionId !== sessionId
        ) {
          return;
        }
        applyDiffSnapshot(threadKey, snapshot);
      } catch (error) {
        setExplorerError(threadKey, errorMessage(error));
      }
    },
    [applyDiffSnapshot, nextRequestId, rpcClient, setExplorerError, setExplorerLoading, threadKey],
  );

  const bootstrapSession = useCallback(async () => {
    if (!rpcClient || input.routeKind !== "server") {
      return;
    }
    setSessionStatus(threadKey, "loading", null);
    setLiveStatus(threadKey, "connecting");
    try {
      const summary = (await rpcClient.review.getOrCreateSession({
        threadId: input.threadId,
        mode: input.routeState.reviewMode,
        scope: input.routeState.reviewScope,
      })) as ReviewSessionSummary;
      applySessionSummary(threadKey, summary);
      await Promise.allSettled([
        refreshSessionSnapshot(summary.id),
        refreshDiffSnapshot(summary.id),
      ]);
    } catch (error) {
      setSessionStatus(threadKey, "error", errorMessage(error));
      setLiveStatus(threadKey, "inactive");
    }
  }, [
    applySessionSummary,
    input.routeKind,
    input.routeState.reviewMode,
    input.routeState.reviewScope,
    input.threadId,
    refreshDiffSnapshot,
    refreshSessionSnapshot,
    rpcClient,
    setLiveStatus,
    setSessionStatus,
    threadKey,
  ]);

  useEffect(() => {
    if (!input.active) {
      setLiveStatus(threadKey, "inactive");
      return;
    }

    if (input.routeKind !== "server") {
      setSessionStatus(threadKey, "unsupported", null);
      setLiveStatus(threadKey, "inactive");
      return;
    }

    if (!rpcClient) {
      setSessionStatus(threadKey, "error", "Environment connection is unavailable.");
      setLiveStatus(threadKey, "inactive");
      return;
    }

    let disposed = false;
    let unsubscribe: () => void = () => {};

    const handleStreamEvent = (event: ReviewStreamEvent) => {
      if (disposed) {
        return;
      }
      setLiveStatus(threadKey, "subscribed");
      switch (event._tag) {
        case "sessionSummaryReplaced":
          applySessionSummary(threadKey, event.summary);
          void refreshDiffSnapshot(event.summary.id);
          return;
        case "sessionSnapshotReplaced":
          applySessionSnapshot(threadKey, event.snapshot);
          void refreshDiffSnapshot(event.snapshot.summary.id);
          return;
        default: {
          const sessionId = subscriptionSessionIdRef.current;
          if (sessionId) {
            void refreshSessionSnapshot(sessionId);
          }
        }
      }
    };

    void bootstrapSession().then(() => {
      if (disposed) {
        return;
      }
      const summary = useReviewStore.getState().threads[threadKey]?.snapshot.summary;
      if (!summary) {
        return;
      }
      subscriptionSessionIdRef.current = summary.id;
      unsubscribe = rpcClient.review.onEvent(
        { sessionId: summary.id },
        (event) => {
          handleStreamEvent(event as ReviewStreamEvent);
        },
        {
          onResubscribe: () => {
            setLiveStatus(threadKey, "resubscribing");
            void refreshSessionSnapshot(summary.id);
            void refreshDiffSnapshot(summary.id);
          },
        },
      );
      setLiveStatus(threadKey, "subscribed");
    });

    return () => {
      disposed = true;
      subscriptionSessionIdRef.current = null;
      unsubscribe();
      setLiveStatus(threadKey, "inactive");
    };
  }, [
    applySessionSnapshot,
    applySessionSummary,
    bootstrapSession,
    input.active,
    input.routeKind,
    refreshDiffSnapshot,
    refreshSessionSnapshot,
    rpcClient,
    setLiveStatus,
    setSessionStatus,
    threadKey,
  ]);

  useEffect(() => {
    if (!input.active || input.routeKind !== "server" || !rpcClient) {
      return;
    }
    const summary = currentThreadState?.snapshot.summary;
    if (!summary?.id) {
      return;
    }

    if (summary.mode !== input.routeState.reviewMode) {
      void rpcClient.review
        .setMode({ sessionId: summary.id, mode: input.routeState.reviewMode })
        .then((nextSummary) => applySessionSummary(threadKey, nextSummary as ReviewSessionSummary))
        .catch((error) => setSessionStatus(threadKey, "error", errorMessage(error)));
    }

    if (summary.scope !== input.routeState.reviewScope) {
      void rpcClient.review
        .setScope({ sessionId: summary.id, scope: input.routeState.reviewScope })
        .then((nextSummary) => {
          applySessionSummary(threadKey, nextSummary as ReviewSessionSummary);
          void refreshDiffSnapshot(summary.id);
        })
        .catch((error) => setSessionStatus(threadKey, "error", errorMessage(error)));
    }
  }, [
    applySessionSummary,
    currentThreadState?.snapshot.summary,
    input.active,
    input.routeKind,
    input.routeState.reviewMode,
    input.routeState.reviewScope,
    refreshDiffSnapshot,
    rpcClient,
    setSessionStatus,
    threadKey,
  ]);

  const selectedFileEntry = currentThreadState?.selection.fileId
    ? (currentThreadState.explorer.fileEntryById[currentThreadState.selection.fileId] ?? null)
    : null;
  const selectedFilePatchKey =
    currentThreadState?.snapshot.summary && selectedFileEntry
      ? reviewCacheKeys.filePatch({
          sessionId: currentThreadState.snapshot.summary.id,
          scope: currentThreadState.snapshot.summary.scope,
          lane: selectedFileEntry.lane,
          normalizedPath: selectedFileEntry.normalizedPath,
        })
      : null;
  const selectedFilePatchEntry =
    selectedFilePatchKey && currentThreadState
      ? (currentThreadState.filePatchCache[selectedFilePatchKey] ?? {
          status: "idle",
          value: null,
          error: null,
        })
      : null;

  useEffect(() => {
    if (
      !input.active ||
      input.routeKind !== "server" ||
      !rpcClient ||
      !currentThreadState?.snapshot.summary ||
      !selectedFileEntry ||
      !selectedFilePatchKey
    ) {
      return;
    }
    if (filePatchRequestsRef.current.has(selectedFilePatchKey)) {
      return;
    }
    const existing = currentThreadState.filePatchCache[selectedFilePatchKey];
    if (existing?.status === "ready" || existing?.status === "loading") {
      return;
    }

    filePatchRequestsRef.current.add(selectedFilePatchKey);
    setFilePatchLoading(threadKey, selectedFilePatchKey);
    void rpcClient.review
      .getFilePatch({
        sessionId: currentThreadState.snapshot.summary.id,
        lane: selectedFileEntry.lane,
        normalizedPath: selectedFileEntry.normalizedPath,
      })
      .then((patch) => {
        applyFilePatch(threadKey, selectedFilePatchKey, patch as ReviewDiffFilePatch | null);
      })
      .catch((error) => {
        setFilePatchError(threadKey, selectedFilePatchKey, errorMessage(error));
      })
      .finally(() => {
        filePatchRequestsRef.current.delete(selectedFilePatchKey);
      });
  }, [
    applyFilePatch,
    currentThreadState,
    input.active,
    input.routeKind,
    rpcClient,
    selectedFileEntry,
    selectedFilePatchKey,
    setFilePatchError,
    setFilePatchLoading,
    threadKey,
  ]);

  const selectedChunkMeta = currentThreadState?.selection.chunkId
    ? (() => {
        const chunk = currentThreadState.snapshot.chunksById[currentThreadState.selection.chunkId];
        if (!chunk) {
          return null;
        }
        const file = currentThreadState.snapshot.filesById[chunk.fileId];
        const group = currentThreadState.snapshot.groupsById[chunk.groupId];
        if (!file || !group?.lane) {
          return null;
        }
        return {
          fileId: chunk.fileId,
          lane: group.lane,
          normalizedPath: file.normalizedPath,
        };
      })()
    : null;
  const selectedChunkPayloadKey =
    currentThreadState?.snapshot.summary &&
    selectedChunkMeta &&
    currentThreadState.selection.chunkId
      ? reviewCacheKeys.chunkPayload({
          sessionId: currentThreadState.snapshot.summary.id,
          scope: currentThreadState.snapshot.summary.scope,
          lane: selectedChunkMeta.lane,
          normalizedPath: selectedChunkMeta.normalizedPath,
          chunkId: currentThreadState.selection.chunkId,
        })
      : null;
  const selectedChunkPayloadEntry =
    selectedChunkPayloadKey && currentThreadState
      ? (currentThreadState.chunkPayloadCache[selectedChunkPayloadKey] ?? {
          status: "idle",
          value: null,
          error: null,
        })
      : null;

  useEffect(() => {
    if (
      !input.active ||
      input.routeKind !== "server" ||
      !rpcClient ||
      !currentThreadState?.snapshot.summary ||
      !currentThreadState.selection.chunkId ||
      !selectedChunkMeta ||
      !selectedChunkPayloadKey
    ) {
      return;
    }
    if (chunkPayloadRequestsRef.current.has(selectedChunkPayloadKey)) {
      return;
    }
    const existing = currentThreadState.chunkPayloadCache[selectedChunkPayloadKey];
    if (existing?.status === "ready" || existing?.status === "loading") {
      return;
    }

    chunkPayloadRequestsRef.current.add(selectedChunkPayloadKey);
    setChunkPayloadLoading(threadKey, selectedChunkPayloadKey);
    void rpcClient.review
      .getChunkPayload({
        sessionId: currentThreadState.snapshot.summary.id,
        lane: selectedChunkMeta.lane,
        normalizedPath: selectedChunkMeta.normalizedPath,
        chunkId: currentThreadState.selection.chunkId,
      })
      .then((payload) => {
        applyChunkPayload(threadKey, selectedChunkPayloadKey, payload as ReviewChunkPayload | null);
      })
      .catch((error) => {
        setChunkPayloadError(threadKey, selectedChunkPayloadKey, errorMessage(error));
      })
      .finally(() => {
        chunkPayloadRequestsRef.current.delete(selectedChunkPayloadKey);
      });
  }, [
    applyChunkPayload,
    currentThreadState,
    input.active,
    input.routeKind,
    rpcClient,
    selectedChunkMeta,
    selectedChunkPayloadKey,
    setChunkPayloadError,
    setChunkPayloadLoading,
    threadKey,
  ]);

  const visibleLaneIds = useMemo(() => {
    if (!currentThreadState) {
      return [];
    }
    return currentThreadState.explorer.laneIds.filter((laneId) => {
      const visibleFileIds = filterVisibleFileIds({
        laneId,
        explorer: currentThreadState.explorer,
        snapshot: currentThreadState.snapshot,
        filters: currentThreadState.filters,
      });
      return visibleFileIds.length > 0;
    });
  }, [currentThreadState]);

  const refresh = useCallback(() => {
    const summary = useReviewStore.getState().threads[threadKey]?.snapshot.summary;
    if (!rpcClient || !summary) {
      return;
    }
    void rpcClient.review
      .refreshProviderData({ sessionId: summary.id })
      .then((snapshot) => applySessionSnapshot(threadKey, snapshot as ReviewSessionSnapshot))
      .catch((error) => setSessionStatus(threadKey, "error", errorMessage(error)))
      .finally(() => {
        void refreshDiffSnapshot(summary.id);
      });
  }, [applySessionSnapshot, refreshDiffSnapshot, rpcClient, setSessionStatus, threadKey]);

  const latestAnalysisArtifact = useMemo<ReviewAnalysisArtifact | null>(() => {
    const artifacts = currentThreadState?.snapshot.analysisArtifactIds
      .map((artifactId) => currentThreadState.snapshot.analysisArtifactsById[artifactId] ?? null)
      .filter((artifact): artifact is ReviewAnalysisArtifact => artifact !== null);
    if (!artifacts || artifacts.length === 0) {
      return null;
    }
    return artifacts.toSorted((left, right) =>
      (right.completedAt ?? right.requestedAt).localeCompare(left.completedAt ?? left.requestedAt),
    )[0]!;
  }, [currentThreadState]);

  const runAnalysis = useCallback(
    async (action: "generate" | "refresh", instruction?: string) => {
      const summary = useReviewStore.getState().threads[threadKey]?.snapshot.summary;
      if (!rpcClient || !summary || input.routeKind !== "server") {
        return;
      }
      setAnalysisRequest({
        status: "running",
        action,
        error: null,
      });
      try {
        await rpcClient.review.generateAnalysis({
          sessionId: summary.id,
          ...(action === "refresh" ? { force: true } : {}),
          ...(instruction !== undefined ? { instruction } : {}),
        });
        setAnalysisRequest({
          status: "idle",
          action: null,
          error: null,
        });
        await refreshSessionSnapshot(summary.id);
      } catch (error) {
        setAnalysisRequest({
          status: "error",
          action,
          error: errorMessage(error),
        });
      }
    },
    [input.routeKind, refreshSessionSnapshot, rpcClient, threadKey],
  );

  const refreshCurrentSession = useCallback(async () => {
    const summary = useReviewStore.getState().threads[threadKey]?.snapshot.summary;
    if (!summary) {
      return;
    }
    await Promise.allSettled([refreshSessionSnapshot(summary.id), refreshDiffSnapshot(summary.id)]);
  }, [refreshDiffSnapshot, refreshSessionSnapshot, threadKey]);

  const mutateNotes = useCallback(
    async (operation: (sessionId: string) => Promise<unknown>) => {
      const summary = useReviewStore.getState().threads[threadKey]?.snapshot.summary;
      if (!rpcClient || !summary || input.routeKind !== "server") {
        throw new Error("Review session is unavailable.");
      }
      await operation(summary.id);
      await refreshSessionSnapshot(summary.id);
    },
    [input.routeKind, refreshSessionSnapshot, rpcClient, threadKey],
  );

  const mutateGitHub = useCallback(
    async (operation: (sessionId: string) => Promise<unknown>) => {
      const summary = useReviewStore.getState().threads[threadKey]?.snapshot.summary;
      if (!rpcClient || !summary || input.routeKind !== "server") {
        throw new Error("Review session is unavailable.");
      }
      await operation(summary.id);
      await refreshSessionSnapshot(summary.id);
    },
    [input.routeKind, refreshSessionSnapshot, rpcClient, threadKey],
  );

  const authorSnapshot = defaultAuthorSnapshot();

  const applyRawMutations = useCallback(
    async (
      action: ReviewRawMutationAction,
      targets: ReadonlyArray<ReviewRawSelectionTarget>,
    ): Promise<readonly ReviewApplyRawMutationResult[]> => {
      const summary = useReviewStore.getState().threads[threadKey]?.snapshot.summary;
      if (!rpcClient || !summary || input.routeKind !== "server") {
        throw new Error("Review session is unavailable.");
      }

      const results: ReviewApplyRawMutationResult[] = [];
      for (const target of targets) {
        const fileEntry =
          useReviewStore.getState().threads[threadKey]?.explorer.fileEntryById[target.fileId];
        const result = (await rpcClient.review.applyRawMutation({
          sessionId: summary.id,
          action,
          target:
            action === "ignore" || action === "unignore"
              ? {
                  targetKind: "ignore-rule",
                  ruleKind:
                    action === "unignore" ? (fileEntry?.ignoreRule?.ruleKind ?? "file") : "file",
                  normalizedPath:
                    action === "unignore"
                      ? (fileEntry?.ignoreRule?.normalizedPath ?? target.normalizedPath)
                      : target.normalizedPath,
                }
              : target.targetKind === "chunk"
                ? {
                    targetKind: "chunk",
                    lane: target.lane,
                    normalizedPath: target.normalizedPath,
                    chunkId: target.chunkId!,
                  }
                : {
                    targetKind: "file",
                    lane: target.lane,
                    normalizedPath: target.normalizedPath,
                  },
        })) as ReviewApplyRawMutationResult;
        results.push(result);
      }

      await refreshCurrentSession();
      return results;
    },
    [input.routeKind, refreshCurrentSession, rpcClient, threadKey],
  );

  const setBulkProgress = useCallback(
    async (
      progressState: ReviewProgressState,
      targets: ReadonlyArray<ReviewRawSelectionTarget>,
    ) => {
      const summary = useReviewStore.getState().threads[threadKey]?.snapshot.summary;
      if (!rpcClient || !summary || input.routeKind !== "server") {
        throw new Error("Review session is unavailable.");
      }

      for (const target of targets) {
        await rpcClient.review.setProgress({
          sessionId: summary.id,
          progressState,
          ...(target.targetKind === "chunk"
            ? { chunkId: target.chunkId }
            : { fileId: target.fileId }),
        });
      }

      await refreshSessionSnapshot(summary.id);
    },
    [input.routeKind, refreshSessionSnapshot, rpcClient, threadKey],
  );

  const openChange = useCallback(async (targetPath: string) => {
    if (typeof window !== "undefined" && window.desktopBridge?.editor) {
      try {
        await openInEmbeddedEditor(targetPath);
        return;
      } catch {
        // Fall through to the broader editor integration path.
      }
    }

    const api = readLocalApi();
    if (!api) {
      throw new Error("Editor integration is unavailable.");
    }
    await openInPreferredEditor(api, targetPath, { allowEmbedded: false });
  }, []);

  const askAgentAboutChange = useCallback(
    (prompt: string) => {
      const threadRef = scopeThreadRef(input.environmentId, input.threadId);
      const currentPrompt =
        useComposerDraftStore.getState().getComposerDraft(threadRef)?.prompt ?? "";
      const nextPrompt = currentPrompt.trim().length > 0 ? `${currentPrompt}\n\n${prompt}` : prompt;
      useComposerDraftStore.getState().setPrompt(threadRef, nextPrompt);
      useEditorStore.getState().setActiveChatTab("thread");
      queueMicrotask(() => {
        document.querySelector<HTMLElement>("[data-composer-textarea]")?.focus();
      });
    },
    [input.environmentId, input.threadId],
  );

  const fetchFilePatch = useCallback(
    async (sessionId: string, lane: ReviewRawLaneKind, normalizedPath: string) => {
      if (!rpcClient) {
        throw new Error("Review RPC is unavailable.");
      }
      return (await rpcClient.review.getFilePatch({
        sessionId,
        lane,
        normalizedPath,
      })) as ReviewDiffFilePatch;
    },
    [rpcClient],
  );

  const fetchChunkSnapshot = useCallback(
    async (ref: ReviewContextChunkRef): Promise<ReviewContextChunkSnapshot> => {
      if (!rpcClient) {
        throw new Error("Review RPC is unavailable.");
      }
      const payload = (await rpcClient.review.getChunkPayload({
        sessionId: ref.sessionId,
        lane: ref.lane,
        normalizedPath: ref.normalizedPath,
        chunkId: ref.chunkId,
      })) as ReviewChunkPayload;
      return {
        ...ref,
        anchor: payload.anchor,
        header: headerFromPatch(payload.rawPatch),
        rawPatch: payload.rawPatch,
        codeExcerpt: payload.anchor.excerpt,
      };
    },
    [rpcClient],
  );

  const expandTargetsToChunkRefs = useCallback(
    async (
      targetRefs: ReadonlyArray<ReviewAnalysisTargetRef>,
    ): Promise<ReviewContextChunkRef[]> => {
      if (!currentThreadState?.sessionId) {
        throw new Error("Review session is not ready.");
      }
      const refs: ReviewContextChunkRef[] = [];
      for (const targetRef of targetRefs) {
        const normalizedPath = targetRef.normalizedPath;
        if (targetRef.fileId && targetRef.chunkId && normalizedPath) {
          const file = currentThreadState.snapshot.filesById[targetRef.fileId];
          refs.push({
            sessionId: currentThreadState.sessionId,
            groupId: targetRef.groupId,
            fileId: targetRef.fileId,
            lane: targetRef.lane,
            normalizedPath,
            displayPath: file?.displayPath ?? normalizedPath,
            chunkId: targetRef.chunkId,
          });
          continue;
        }

        const fileRefs =
          targetRef.fileId && normalizedPath
            ? [
                {
                  lane: targetRef.lane,
                  normalizedPath,
                },
              ]
            : (currentThreadState.explorer.laneById[targetRef.groupId]?.files ?? []).map(
                (file) => ({
                  lane: file.lane,
                  normalizedPath: file.normalizedPath,
                }),
              );

        for (const fileRef of fileRefs) {
          const patch = await fetchFilePatch(
            currentThreadState.sessionId,
            fileRef.lane,
            fileRef.normalizedPath,
          );
          refs.push(
            ...patch.chunks.map((chunk) => ({
              sessionId: currentThreadState.sessionId!,
              groupId: patch.groupId,
              fileId: patch.fileId,
              lane: patch.lane,
              normalizedPath: patch.normalizedPath,
              displayPath: patch.displayPath,
              chunkId: chunk.chunkId,
            })),
          );
        }
      }
      return dedupeReviewContextChunkRefs(refs);
    },
    [currentThreadState, fetchFilePatch],
  );

  const createReviewContextAttachment = useCallback(
    async (args: {
      sourceKind: ReviewContextAttachmentDraft["sourceKind"];
      title: string;
      refs: ReadonlyArray<ReviewContextChunkRef>;
      attachmentId?: string;
      createdAt?: string;
    }): Promise<ReviewContextAttachmentDraft> => {
      if (!currentThreadState?.sessionId) {
        throw new Error("Review session is not ready.");
      }
      const chunks = await Promise.all(args.refs.map((ref) => fetchChunkSnapshot(ref)));
      return {
        id: args.attachmentId ?? randomUUID(),
        createdAt: args.createdAt ?? new Date().toISOString(),
        sourceKind: args.sourceKind,
        title: args.title,
        sessionId: currentThreadState.sessionId,
        diffCacheToken: currentThreadState.diffCacheToken,
        chunks,
      };
    },
    [currentThreadState?.diffCacheToken, currentThreadState?.sessionId, fetchChunkSnapshot],
  );

  const attachChunkToComposer = useCallback(
    async (args: {
      groupId: string;
      fileId: string;
      lane: ReviewRawLaneKind;
      normalizedPath: string;
      displayPath: string;
      chunkId: string;
      title?: string;
    }) => {
      if (!currentThreadState?.sessionId) {
        throw new Error("Review session is not ready.");
      }
      const attachment = await createReviewContextAttachment({
        sourceKind: "chunk",
        title: args.title ?? args.displayPath,
        refs: [
          {
            sessionId: currentThreadState.sessionId,
            groupId: args.groupId,
            fileId: args.fileId,
            lane: args.lane,
            normalizedPath: args.normalizedPath,
            displayPath: args.displayPath,
            chunkId: args.chunkId,
          },
        ],
      });
      useComposerDraftStore.getState().addReviewContext(composerThreadRef, attachment);
      return attachment;
    },
    [composerThreadRef, createReviewContextAttachment, currentThreadState?.sessionId],
  );

  const attachFileToComposer = useCallback(
    async (args: { lane: ReviewRawLaneKind; normalizedPath: string; title: string }) => {
      if (!currentThreadState?.sessionId) {
        throw new Error("Review session is not ready.");
      }
      const patch = await fetchFilePatch(
        currentThreadState.sessionId,
        args.lane,
        args.normalizedPath,
      );
      const attachment = await createReviewContextAttachment({
        sourceKind: "file",
        title: args.title,
        refs: patch.chunks.map((chunk) => ({
          sessionId: currentThreadState.sessionId!,
          groupId: patch.groupId,
          fileId: patch.fileId,
          lane: patch.lane,
          normalizedPath: patch.normalizedPath,
          displayPath: patch.displayPath,
          chunkId: chunk.chunkId,
        })),
      });
      useComposerDraftStore.getState().addReviewContext(composerThreadRef, attachment);
      return attachment;
    },
    [
      composerThreadRef,
      createReviewContextAttachment,
      currentThreadState?.sessionId,
      fetchFilePatch,
    ],
  );

  const attachSemanticGroupToComposer = useCallback(
    async (args: { title: string; targetRefs: ReadonlyArray<ReviewAnalysisTargetRef> }) => {
      const refs = await expandTargetsToChunkRefs(args.targetRefs);
      const attachment = await createReviewContextAttachment({
        sourceKind: "group",
        title: args.title,
        refs,
      });
      useComposerDraftStore.getState().addReviewContext(composerThreadRef, attachment);
      return attachment;
    },
    [composerThreadRef, createReviewContextAttachment, expandTargetsToChunkRefs],
  );

  const refreshComposerReviewContext = useCallback(
    async (attachment: ReviewContextAttachmentDraft) => {
      const refreshed = await createReviewContextAttachment({
        sourceKind: attachment.sourceKind,
        title: attachment.title,
        refs: attachment.chunks,
        attachmentId: attachment.id,
        createdAt: attachment.createdAt,
      });
      useComposerDraftStore.getState().refreshReviewContext(composerThreadRef, refreshed);
      return refreshed;
    },
    [composerThreadRef, createReviewContextAttachment],
  );

  return {
    threadKey,
    state: currentThreadState,
    latestAnalysisArtifact,
    analysisRequest,
    visibleLaneIds,
    selectedFileEntry,
    selectedFilePatch: selectedFilePatchEntry,
    selectedChunkPayload: findChunkPayload(selectedChunkPayloadEntry?.value),
    selectedChunkPayloadEntry,
    visibleLocalThreadCount:
      currentThreadState &&
      countVisibleLocalThreads({
        snapshot: currentThreadState.snapshot,
        filters: currentThreadState.filters,
      }),
    visibleOverviewNoteCount:
      currentThreadState &&
      countVisibleOverviewNotes({
        snapshot: currentThreadState.snapshot,
        filters: currentThreadState.filters,
      }),
    setFilters: (updater: Parameters<typeof setFilters>[1]) => setFilters(threadKey, updater),
    toggleLaneExpanded: (laneId: string) => toggleLaneExpanded(threadKey, laneId),
    toggleFileExpanded: (fileId: string) => toggleFileExpanded(threadKey, fileId),
    toggleLocalThreadExpanded: (threadId: string) => toggleLocalThreadExpanded(threadKey, threadId),
    toggleGitHubThreadExpanded: (threadId: string) =>
      toggleGitHubThreadExpanded(threadKey, threadId),
    toggleArtifactExpanded: (artifactId: string) => toggleArtifactExpanded(threadKey, artifactId),
    refresh,
    applyRawMutations,
    setBulkProgress,
    setProgress: (input: {
      fileId?: string;
      chunkId?: string;
      threadId?: string;
      overviewNoteId?: string;
      progressState: ReviewProgressState;
    }) =>
      mutateNotes((sessionId) =>
        rpcClient!.review.setProgress({
          sessionId,
          ...input,
        }),
      ),
    createLocalThread: (input: {
      groupId: string;
      fileId: string;
      chunkId?: string;
      anchor: ReviewSessionSnapshot["chunks"][number]["anchor"];
      body: string;
      progressState?: ReviewProgressState;
    }) =>
      mutateNotes((sessionId) =>
        rpcClient!.review.createLocalThread({
          sessionId,
          ...input,
          author: authorSnapshot,
        }),
      ),
    updateLocalThread: (threadId: string, body: string) =>
      mutateNotes((sessionId) =>
        rpcClient!.review.updateLocalThread({ sessionId, threadId, body }),
      ),
    deleteLocalThread: (threadId: string) =>
      mutateNotes((sessionId) => rpcClient!.review.deleteLocalThread({ sessionId, threadId })),
    setLocalThreadResolved: (threadId: string, resolved: boolean) =>
      mutateNotes((sessionId) =>
        rpcClient!.review.setLocalThreadResolved({ sessionId, threadId, resolved }),
      ),
    createLocalReply: (threadId: string, body: string) =>
      mutateNotes((sessionId) =>
        rpcClient!.review.createLocalReply({
          sessionId,
          threadId,
          body,
          author: authorSnapshot,
        }),
      ),
    updateLocalReply: (replyId: string, body: string) =>
      mutateNotes((sessionId) => rpcClient!.review.updateLocalReply({ sessionId, replyId, body })),
    deleteLocalReply: (replyId: string) =>
      mutateNotes((sessionId) => rpcClient!.review.deleteLocalReply({ sessionId, replyId })),
    upsertOverviewNote: (input: {
      noteId?: string;
      title?: string;
      body: string;
      progressState?: ReviewProgressState;
    }) =>
      mutateNotes((sessionId) =>
        rpcClient!.review.upsertOverviewNote({
          sessionId,
          ...input,
          author: authorSnapshot,
        }),
      ),
    deleteOverviewNote: (noteId: string) =>
      mutateNotes((sessionId) => rpcClient!.review.deleteOverviewNote({ sessionId, noteId })),
    upsertGitHubDraft: (input: {
      draftId?: string;
      draftKind: "inline-comment" | "review-summary";
      chunkId?: string;
      body: string;
      submitAction?: GitHubReviewDecision;
    }) =>
      mutateGitHub((sessionId) =>
        rpcClient!.review.upsertGitHubDraft({
          sessionId,
          ...input,
        }),
      ),
    deleteGitHubDraft: (draftId: string) =>
      mutateGitHub((sessionId) => rpcClient!.review.deleteGitHubDraft({ sessionId, draftId })),
    replyToGitHubThread: (threadId: string, body: string) =>
      mutateGitHub((sessionId) =>
        rpcClient!.review.replyToGitHubThread({ sessionId, threadId, body }),
      ),
    submitGitHubDraft: (input: { decision: GitHubReviewDecision; body?: string }) =>
      mutateGitHub((sessionId) =>
        rpcClient!.review.submitGitHubDraft({
          sessionId,
          ...input,
        }),
      ),
    openChange,
    askAgentAboutChange,
    attachChunkToComposer,
    attachFileToComposer,
    attachSemanticGroupToComposer,
    refreshComposerReviewContext,
    generateAnalysis: (instruction?: string) => void runAnalysis("generate", instruction),
    refreshAnalysis: (instruction?: string) => void runAnalysis("refresh", instruction),
  };
}
