import type {
  ReviewChunkPayload,
  ReviewDiffFilePatch,
  ReviewDiffSnapshot,
  ReviewSessionSnapshot,
  ReviewSessionSummary,
} from "../../../../../packages/contracts/src/review.ts";
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import { createDebouncedStorage } from "~/lib/storage";
import {
  chunkPayloadCacheKey,
  createDefaultReviewExpansionState,
  createDefaultReviewFilters,
  createEmptyNormalizedSnapshot,
  createEmptyReviewExplorerState,
  createEmptyReviewSelection,
  deriveReviewDegradedBanners,
  diffSnapshotCacheToken,
  filePatchCacheKey,
  mergeFilePatchIntoExplorer,
  normalizeReviewDiffSnapshot,
  normalizeReviewSnapshot,
  resolveReviewSelection,
  type ReviewActivityFilters,
  type ReviewDegradedBanner,
  type ReviewExpansionState,
  type ReviewExplorerState,
  type ReviewLiveStatus,
  type ReviewLoadStatus,
  type ReviewNormalizedSnapshot,
  type ReviewProviderAvailabilityState,
  type ReviewSelectionState,
} from "./state";
import type { ReviewRouteState } from "./routeSearch";

export interface ReviewThreadContext {
  readonly environmentId: string;
  readonly threadId: string;
  readonly routeKind: "server" | "draft";
}

export interface ReviewCacheEntry<TValue> {
  readonly status: Exclude<ReviewLoadStatus, "unsupported">;
  readonly value: TValue | null;
  readonly error: string | null;
}

export interface ReviewThreadState {
  readonly context: ReviewThreadContext | null;
  readonly sessionStatus: ReviewLoadStatus;
  readonly liveStatus: ReviewLiveStatus;
  readonly sessionId: string | null;
  readonly routeState: ReviewRouteState;
  readonly snapshot: ReviewNormalizedSnapshot;
  readonly explorerStatus: Exclude<ReviewLoadStatus, "unsupported">;
  readonly explorer: ReviewExplorerState;
  readonly diffSnapshot: ReviewDiffSnapshot | null;
  readonly diffCacheToken: string | null;
  readonly providerAvailability: ReviewProviderAvailabilityState | null;
  readonly degradedBanners: readonly ReviewDegradedBanner[];
  readonly selection: ReviewSelectionState;
  readonly filters: ReviewActivityFilters;
  readonly expansion: ReviewExpansionState;
  readonly sessionError: string | null;
  readonly explorerError: string | null;
  readonly filePatchCache: Readonly<Record<string, ReviewCacheEntry<ReviewDiffFilePatch>>>;
  readonly chunkPayloadCache: Readonly<Record<string, ReviewCacheEntry<ReviewChunkPayload>>>;
}

interface ReviewStoreState {
  readonly threads: Readonly<Record<string, ReviewThreadState>>;
  readonly ensureThread: (
    threadKey: string,
    context: ReviewThreadContext,
    routeState: ReviewRouteState,
  ) => void;
  readonly setRouteState: (threadKey: string, routeState: ReviewRouteState) => void;
  readonly setSessionStatus: (
    threadKey: string,
    status: ReviewLoadStatus,
    error?: string | null,
  ) => void;
  readonly setLiveStatus: (threadKey: string, status: ReviewLiveStatus) => void;
  readonly applySessionSummary: (threadKey: string, summary: ReviewSessionSummary) => void;
  readonly applySessionSnapshot: (threadKey: string, snapshot: ReviewSessionSnapshot) => void;
  readonly setExplorerLoading: (threadKey: string) => void;
  readonly applyDiffSnapshot: (threadKey: string, snapshot: ReviewDiffSnapshot) => void;
  readonly setExplorerError: (threadKey: string, error: string) => void;
  readonly setProviderAvailability: (
    threadKey: string,
    providerAvailability: ReviewProviderAvailabilityState,
  ) => void;
  readonly setFilters: (
    threadKey: string,
    updater:
      | Partial<ReviewActivityFilters>
      | ((current: ReviewActivityFilters) => ReviewActivityFilters),
  ) => void;
  readonly toggleLaneExpanded: (threadKey: string, laneId: string) => void;
  readonly toggleFileExpanded: (threadKey: string, fileId: string) => void;
  readonly toggleLocalThreadExpanded: (threadKey: string, threadId: string) => void;
  readonly toggleGitHubThreadExpanded: (threadKey: string, threadId: string) => void;
  readonly toggleArtifactExpanded: (threadKey: string, artifactId: string) => void;
  readonly setFilePatchLoading: (threadKey: string, cacheKey: string) => void;
  readonly applyFilePatch: (
    threadKey: string,
    cacheKey: string,
    patch: ReviewDiffFilePatch | null,
  ) => void;
  readonly setFilePatchError: (threadKey: string, cacheKey: string, error: string) => void;
  readonly setChunkPayloadLoading: (threadKey: string, cacheKey: string) => void;
  readonly applyChunkPayload: (
    threadKey: string,
    cacheKey: string,
    payload: ReviewChunkPayload | null,
  ) => void;
  readonly setChunkPayloadError: (threadKey: string, cacheKey: string, error: string) => void;
}

function createStorage() {
  return createDebouncedStorage(typeof window !== "undefined" ? window.localStorage : undefined);
}

function createDefaultThreadState(routeState: ReviewRouteState): ReviewThreadState {
  return {
    context: null,
    sessionStatus: "idle",
    liveStatus: "inactive",
    sessionId: null,
    routeState,
    snapshot: createEmptyNormalizedSnapshot(),
    explorerStatus: "idle",
    explorer: createEmptyReviewExplorerState(),
    diffSnapshot: null,
    diffCacheToken: null,
    providerAvailability: null,
    degradedBanners: [],
    selection: createEmptyReviewSelection(),
    filters: createDefaultReviewFilters(),
    expansion: createDefaultReviewExpansionState(),
    sessionError: null,
    explorerError: null,
    filePatchCache: {},
    chunkPayloadCache: {},
  };
}

function recalculateThreadState(thread: ReviewThreadState): ReviewThreadState {
  const selection = resolveReviewSelection({
    routeState: thread.routeState,
    snapshot: thread.snapshot,
    explorer: thread.explorer,
  });
  const degradedBanners = deriveReviewDegradedBanners({
    summary: thread.snapshot.summary,
    providerAvailability: thread.providerAvailability ?? {
      connectionState: "disconnected",
      authState: "unknown",
      serverProviders: [],
      github: { available: false, writable: null, pullRequestNumber: null },
    },
    selection,
  });
  return {
    ...thread,
    selection,
    degradedBanners,
  };
}

function updateThreadState(
  state: ReviewStoreState,
  threadKey: string,
  updater: (thread: ReviewThreadState) => ReviewThreadState,
) {
  const current =
    state.threads[threadKey] ??
    createDefaultThreadState({
      tab: "review",
      reviewMode: "review",
      reviewScope: "combined",
    });
  const nextThread = recalculateThreadState(updater(current));
  return {
    threads: {
      ...state.threads,
      [threadKey]: nextThread,
    },
  };
}

function resetLazyCaches(thread: ReviewThreadState): ReviewThreadState {
  return {
    ...thread,
    filePatchCache: {},
    chunkPayloadCache: {},
  };
}

function mergeRouteFilters(
  current: ReviewActivityFilters,
  updater:
    | Partial<ReviewActivityFilters>
    | ((current: ReviewActivityFilters) => ReviewActivityFilters),
): ReviewActivityFilters {
  if (typeof updater === "function") {
    return updater(current);
  }
  return {
    ...current,
    ...updater,
    progressStates: updater.progressStates
      ? { ...current.progressStates, ...updater.progressStates }
      : current.progressStates,
    laneKinds: updater.laneKinds
      ? { ...current.laneKinds, ...updater.laneKinds }
      : current.laneKinds,
  };
}

function routeStateEqual(left: ReviewRouteState, right: ReviewRouteState): boolean {
  return (
    left.tab === right.tab &&
    left.reviewMode === right.reviewMode &&
    left.reviewScope === right.reviewScope &&
    (left.reviewGroupId ?? null) === (right.reviewGroupId ?? null) &&
    (left.reviewFileId ?? null) === (right.reviewFileId ?? null) &&
    (left.reviewChunkId ?? null) === (right.reviewChunkId ?? null) &&
    (left.reviewCommentId ?? null) === (right.reviewCommentId ?? null)
  );
}

function threadContextEqual(left: ReviewThreadContext | null, right: ReviewThreadContext): boolean {
  return (
    left !== null &&
    left.environmentId === right.environmentId &&
    left.threadId === right.threadId &&
    left.routeKind === right.routeKind
  );
}

export const useReviewStore = create<ReviewStoreState>()(
  persist(
    (set) => ({
      threads: {},
      ensureThread: (threadKey, context, routeState) =>
        set((state) =>
          updateThreadState(state as ReviewStoreState, threadKey, (thread) => {
            const nextSessionStatus =
              context.routeKind === "server" ? thread.sessionStatus : "unsupported";
            if (
              threadContextEqual(thread.context, context) &&
              routeStateEqual(thread.routeState, routeState) &&
              thread.sessionStatus === nextSessionStatus
            ) {
              return thread;
            }
            return {
              ...thread,
              context: threadContextEqual(thread.context, context) ? thread.context : context,
              routeState: routeStateEqual(thread.routeState, routeState)
                ? thread.routeState
                : routeState,
              sessionStatus: nextSessionStatus,
            };
          }),
        ),
      setRouteState: (threadKey, routeState) =>
        set((state) =>
          updateThreadState(state as ReviewStoreState, threadKey, (thread) =>
            routeStateEqual(thread.routeState, routeState)
              ? thread
              : {
                  ...thread,
                  routeState,
                },
          ),
        ),
      setSessionStatus: (threadKey, status, error = null) =>
        set((state) =>
          updateThreadState(state as ReviewStoreState, threadKey, (thread) => ({
            ...thread,
            sessionStatus: status,
            sessionError: error,
          })),
        ),
      setLiveStatus: (threadKey, status) =>
        set((state) =>
          updateThreadState(state as ReviewStoreState, threadKey, (thread) => ({
            ...thread,
            liveStatus: status,
          })),
        ),
      applySessionSummary: (threadKey, summary) =>
        set((state) =>
          updateThreadState(state as ReviewStoreState, threadKey, (thread) => {
            const sessionChanged = thread.sessionId !== null && thread.sessionId !== summary.id;
            const nextThread = {
              ...(sessionChanged ? resetLazyCaches(thread) : thread),
              sessionStatus: "ready" as const,
              sessionError: null,
              sessionId: summary.id,
              snapshot: {
                ...thread.snapshot,
                summary,
              },
            };
            return nextThread;
          }),
        ),
      applySessionSnapshot: (threadKey, snapshot) =>
        set((state) =>
          updateThreadState(state as ReviewStoreState, threadKey, (thread) => {
            const sessionChanged =
              thread.sessionId !== null && thread.sessionId !== snapshot.summary.id;
            return {
              ...(sessionChanged ? resetLazyCaches(thread) : thread),
              sessionStatus: "ready",
              sessionError: null,
              sessionId: snapshot.summary.id,
              snapshot: normalizeReviewSnapshot(snapshot),
            };
          }),
        ),
      setExplorerLoading: (threadKey) =>
        set((state) =>
          updateThreadState(state as ReviewStoreState, threadKey, (thread) => ({
            ...thread,
            explorerStatus: "loading",
            explorerError: null,
          })),
        ),
      applyDiffSnapshot: (threadKey, snapshot) =>
        set((state) =>
          updateThreadState(state as ReviewStoreState, threadKey, (thread) => {
            const nextToken = diffSnapshotCacheToken(snapshot);
            const shouldResetCaches =
              thread.diffCacheToken !== null &&
              nextToken !== null &&
              thread.diffCacheToken !== nextToken;
            return {
              ...(shouldResetCaches ? resetLazyCaches(thread) : thread),
              explorerStatus: "ready",
              explorerError: null,
              diffSnapshot: snapshot,
              diffCacheToken: nextToken,
              explorer: normalizeReviewDiffSnapshot(snapshot),
            };
          }),
        ),
      setExplorerError: (threadKey, error) =>
        set((state) =>
          updateThreadState(state as ReviewStoreState, threadKey, (thread) => ({
            ...thread,
            explorerStatus: "error",
            explorerError: error,
          })),
        ),
      setProviderAvailability: (threadKey, providerAvailability) =>
        set((state) =>
          updateThreadState(state as ReviewStoreState, threadKey, (thread) => ({
            ...thread,
            providerAvailability,
          })),
        ),
      setFilters: (threadKey, updater) =>
        set((state) =>
          updateThreadState(state as ReviewStoreState, threadKey, (thread) => ({
            ...thread,
            filters: mergeRouteFilters(thread.filters, updater),
          })),
        ),
      toggleLaneExpanded: (threadKey, laneId) =>
        set((state) =>
          updateThreadState(state as ReviewStoreState, threadKey, (thread) => ({
            ...thread,
            expansion: {
              ...thread.expansion,
              laneIds: {
                ...thread.expansion.laneIds,
                [laneId]: !thread.expansion.laneIds[laneId],
              },
            },
          })),
        ),
      toggleFileExpanded: (threadKey, fileId) =>
        set((state) =>
          updateThreadState(state as ReviewStoreState, threadKey, (thread) => ({
            ...thread,
            expansion: {
              ...thread.expansion,
              fileIds: {
                ...thread.expansion.fileIds,
                [fileId]: !thread.expansion.fileIds[fileId],
              },
            },
          })),
        ),
      toggleLocalThreadExpanded: (threadKey, threadId) =>
        set((state) =>
          updateThreadState(state as ReviewStoreState, threadKey, (thread) => ({
            ...thread,
            expansion: {
              ...thread.expansion,
              localThreadIds: {
                ...thread.expansion.localThreadIds,
                [threadId]: !thread.expansion.localThreadIds[threadId],
              },
            },
          })),
        ),
      toggleGitHubThreadExpanded: (threadKey, threadId) =>
        set((state) =>
          updateThreadState(state as ReviewStoreState, threadKey, (thread) => ({
            ...thread,
            expansion: {
              ...thread.expansion,
              githubThreadIds: {
                ...thread.expansion.githubThreadIds,
                [threadId]: !thread.expansion.githubThreadIds[threadId],
              },
            },
          })),
        ),
      toggleArtifactExpanded: (threadKey, artifactId) =>
        set((state) =>
          updateThreadState(state as ReviewStoreState, threadKey, (thread) => ({
            ...thread,
            expansion: {
              ...thread.expansion,
              artifactIds: {
                ...thread.expansion.artifactIds,
                [artifactId]: !thread.expansion.artifactIds[artifactId],
              },
            },
          })),
        ),
      setFilePatchLoading: (threadKey, cacheKey) =>
        set((state) =>
          updateThreadState(state as ReviewStoreState, threadKey, (thread) => ({
            ...thread,
            filePatchCache: {
              ...thread.filePatchCache,
              [cacheKey]: {
                status: "loading",
                value: thread.filePatchCache[cacheKey]?.value ?? null,
                error: null,
              },
            },
          })),
        ),
      applyFilePatch: (threadKey, cacheKey, patch) =>
        set((state) =>
          updateThreadState(state as ReviewStoreState, threadKey, (thread) => ({
            ...thread,
            explorer: mergeFilePatchIntoExplorer(thread.explorer, patch),
            filePatchCache: {
              ...thread.filePatchCache,
              [cacheKey]: {
                status: "ready",
                value: patch,
                error: null,
              },
            },
          })),
        ),
      setFilePatchError: (threadKey, cacheKey, error) =>
        set((state) =>
          updateThreadState(state as ReviewStoreState, threadKey, (thread) => ({
            ...thread,
            filePatchCache: {
              ...thread.filePatchCache,
              [cacheKey]: {
                status: "error",
                value: thread.filePatchCache[cacheKey]?.value ?? null,
                error,
              },
            },
          })),
        ),
      setChunkPayloadLoading: (threadKey, cacheKey) =>
        set((state) =>
          updateThreadState(state as ReviewStoreState, threadKey, (thread) => ({
            ...thread,
            chunkPayloadCache: {
              ...thread.chunkPayloadCache,
              [cacheKey]: {
                status: "loading",
                value: thread.chunkPayloadCache[cacheKey]?.value ?? null,
                error: null,
              },
            },
          })),
        ),
      applyChunkPayload: (threadKey, cacheKey, payload) =>
        set((state) =>
          updateThreadState(state as ReviewStoreState, threadKey, (thread) => ({
            ...thread,
            chunkPayloadCache: {
              ...thread.chunkPayloadCache,
              [cacheKey]: {
                status: "ready",
                value: payload,
                error: null,
              },
            },
          })),
        ),
      setChunkPayloadError: (threadKey, cacheKey, error) =>
        set((state) =>
          updateThreadState(state as ReviewStoreState, threadKey, (thread) => ({
            ...thread,
            chunkPayloadCache: {
              ...thread.chunkPayloadCache,
              [cacheKey]: {
                status: "error",
                value: thread.chunkPayloadCache[cacheKey]?.value ?? null,
                error,
              },
            },
          })),
        ),
    }),
    {
      name: "fenrir:review-store",
      storage: createJSONStorage(createStorage),
      partialize: (state) => ({
        threads: Object.fromEntries(
          Object.entries(state.threads).map(([threadKey, thread]) => [
            threadKey,
            {
              expansion: thread.expansion,
            },
          ]),
        ),
      }),
      merge: (persistedState, currentState) => {
        const persistedThreads = (
          persistedState as
            | { threads?: Record<string, { expansion?: ReviewExpansionState }> }
            | undefined
        )?.threads;
        if (!persistedThreads) {
          return currentState as ReviewStoreState;
        }
        const current = currentState as ReviewStoreState;
        const nextThreads: Record<string, ReviewThreadState> = { ...current.threads };
        for (const [threadKey, persistedThread] of Object.entries(persistedThreads)) {
          const existing = nextThreads[threadKey];
          const base =
            existing ??
            createDefaultThreadState({
              tab: "review",
              reviewMode: "review",
              reviewScope: "combined",
            });
          nextThreads[threadKey] = {
            ...base,
            expansion: persistedThread.expansion ?? base.expansion,
          };
        }
        return {
          ...current,
          threads: nextThreads,
        };
      },
    },
  ),
);

export const reviewCacheKeys = {
  filePatch: filePatchCacheKey,
  chunkPayload: chunkPayloadCacheKey,
};
