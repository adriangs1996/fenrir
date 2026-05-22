import type {
  ServerProvider,
  ServerProviderAuthStatus,
  ServerProviderAvailability,
  ServerProviderState,
} from "@fenrir/contracts";
import type {
  GitHubReviewComment,
  GitHubReviewGeneralComment,
  GitHubReviewSnapshot,
  GitHubReviewThread,
  ReviewAnalysisArtifact,
  ReviewChunk,
  ReviewChunkPayload,
  ReviewDiffFileEntry,
  ReviewDiffFilePatch,
  ReviewDiffSnapshot,
  ReviewFile,
  ReviewGroup,
  ReviewLocalAnnotationReply,
  ReviewLocalAnnotationThread,
  ReviewOverviewNote,
  ReviewProgressState,
  ReviewRawLaneKind,
  ReviewSessionSnapshot,
  ReviewSessionSummary,
} from "../../../../../packages/contracts/src/review.ts";
import type {
  SavedEnvironmentConnectionState,
  SavedEnvironmentRuntimeState,
} from "~/environments/runtime/catalog";
import type { ReviewRouteState } from "./routeSearch";

export type ReviewLoadStatus = "idle" | "loading" | "ready" | "error" | "unsupported";
export type ReviewLiveStatus = "inactive" | "connecting" | "subscribed" | "resubscribing";

export interface ReviewExplorerState {
  readonly laneIds: readonly string[];
  readonly laneById: Readonly<Record<string, ReviewDiffSnapshot["lanes"][number]>>;
  readonly fileIdsByLaneId: Readonly<Record<string, readonly string[]>>;
  readonly fileEntryById: Readonly<Record<string, ReviewDiffFileEntry>>;
  readonly chunkIdsByFileId: Readonly<Record<string, readonly string[]>>;
  readonly chunkFileIdByChunkId: Readonly<Record<string, string>>;
  readonly chunkPatchById: Readonly<
    Record<
      string,
      {
        readonly fileId: string;
        readonly lane: ReviewRawLaneKind;
        readonly normalizedPath: string;
      }
    >
  >;
}

export interface ReviewActivityFilters {
  readonly progressStates: Readonly<Record<ReviewProgressState, boolean>>;
  readonly laneKinds: Readonly<Record<ReviewRawLaneKind, boolean>>;
  readonly showLocalThreads: boolean;
  readonly showOverviewNotes: boolean;
  readonly showGitHubThreads: boolean;
  readonly showAnalysis: boolean;
}

export interface ReviewExpansionState {
  readonly laneIds: Readonly<Record<string, boolean>>;
  readonly fileIds: Readonly<Record<string, boolean>>;
  readonly localThreadIds: Readonly<Record<string, boolean>>;
  readonly githubThreadIds: Readonly<Record<string, boolean>>;
  readonly artifactIds: Readonly<Record<string, boolean>>;
}

export interface ReviewSelectionState {
  readonly groupId: string | null;
  readonly fileId: string | null;
  readonly chunkId: string | null;
  readonly commentId: string | null;
  readonly hasInvalidGroupId: boolean;
  readonly hasInvalidFileId: boolean;
  readonly hasInvalidChunkId: boolean;
  readonly hasInvalidCommentId: boolean;
}

export interface ReviewNormalizedSnapshot {
  readonly summary: ReviewSessionSummary | null;
  readonly groupsById: Readonly<Record<string, ReviewGroup>>;
  readonly groupIds: readonly string[];
  readonly filesById: Readonly<Record<string, ReviewFile>>;
  readonly fileIds: readonly string[];
  readonly chunksById: Readonly<Record<string, ReviewChunk>>;
  readonly chunkIds: readonly string[];
  readonly chunkIdsByFileId: Readonly<Record<string, readonly string[]>>;
  readonly chunkFileIdByChunkId: Readonly<Record<string, string>>;
  readonly localThreadsById: Readonly<Record<string, ReviewLocalAnnotationThread>>;
  readonly localThreadIds: readonly string[];
  readonly localRepliesByThreadId: Readonly<Record<string, readonly ReviewLocalAnnotationReply[]>>;
  readonly overviewNotesById: Readonly<Record<string, ReviewOverviewNote>>;
  readonly overviewNoteIds: readonly string[];
  readonly analysisArtifactsById: Readonly<Record<string, ReviewAnalysisArtifact>>;
  readonly analysisArtifactIds: readonly string[];
  readonly github: GitHubReviewSnapshot | null;
  readonly githubThreadsById: Readonly<Record<string, GitHubReviewThread>>;
  readonly githubThreadIds: readonly string[];
  readonly githubCommentsById: Readonly<Record<string, GitHubReviewComment>>;
  readonly githubGeneralCommentsById: Readonly<Record<string, GitHubReviewGeneralComment>>;
  readonly githubGeneralCommentIds: readonly string[];
}

export interface ReviewProviderAvailabilityState {
  readonly connectionState: SavedEnvironmentConnectionState;
  readonly authState: SavedEnvironmentRuntimeState["authState"];
  readonly serverProviders: readonly {
    readonly key: string;
    readonly label: string;
    readonly state: ServerProviderState;
    readonly availability: ServerProviderAvailability | "unknown";
    readonly authStatus: ServerProviderAuthStatus;
    readonly message: string | null;
  }[];
  readonly github: {
    readonly available: boolean;
    readonly writable: boolean | null;
    readonly pullRequestNumber: number | null;
  };
}

export interface ReviewDegradedBanner {
  readonly id: string;
  readonly tone: "warning" | "error";
  readonly title: string;
  readonly detail: string;
}

const EMPTY_RECORD = Object.freeze({}) as Readonly<Record<string, never>>;
const EMPTY_ARRAY = Object.freeze([]) as readonly never[];

export function createDefaultReviewFilters(): ReviewActivityFilters {
  return {
    progressStates: {
      unreviewed: true,
      reviewed: true,
      "needs-follow-up": true,
    },
    laneKinds: {
      ignored: true,
      unstaged: true,
      staged: true,
      committed: true,
      "inverse-edit": true,
    },
    showLocalThreads: true,
    showOverviewNotes: true,
    showGitHubThreads: true,
    showAnalysis: true,
  };
}

export function createDefaultReviewExpansionState(): ReviewExpansionState {
  return {
    laneIds: {},
    fileIds: {},
    localThreadIds: {},
    githubThreadIds: {},
    artifactIds: {},
  };
}

export function createEmptyReviewSelection(): ReviewSelectionState {
  return {
    groupId: null,
    fileId: null,
    chunkId: null,
    commentId: null,
    hasInvalidGroupId: false,
    hasInvalidFileId: false,
    hasInvalidChunkId: false,
    hasInvalidCommentId: false,
  };
}

export function createEmptyReviewExplorerState(): ReviewExplorerState {
  return {
    laneIds: EMPTY_ARRAY as readonly string[],
    laneById: EMPTY_RECORD as Readonly<Record<string, ReviewDiffSnapshot["lanes"][number]>>,
    fileIdsByLaneId: EMPTY_RECORD as Readonly<Record<string, readonly string[]>>,
    fileEntryById: EMPTY_RECORD as Readonly<Record<string, ReviewDiffFileEntry>>,
    chunkIdsByFileId: EMPTY_RECORD as Readonly<Record<string, readonly string[]>>,
    chunkFileIdByChunkId: EMPTY_RECORD as Readonly<Record<string, string>>,
    chunkPatchById: EMPTY_RECORD as Readonly<
      Record<
        string,
        {
          readonly fileId: string;
          readonly lane: ReviewRawLaneKind;
          readonly normalizedPath: string;
        }
      >
    >,
  };
}

export function createEmptyNormalizedSnapshot(): ReviewNormalizedSnapshot {
  return {
    summary: null,
    groupsById: EMPTY_RECORD as Readonly<Record<string, ReviewGroup>>,
    groupIds: EMPTY_ARRAY as readonly string[],
    filesById: EMPTY_RECORD as Readonly<Record<string, ReviewFile>>,
    fileIds: EMPTY_ARRAY as readonly string[],
    chunksById: EMPTY_RECORD as Readonly<Record<string, ReviewChunk>>,
    chunkIds: EMPTY_ARRAY as readonly string[],
    chunkIdsByFileId: EMPTY_RECORD as Readonly<Record<string, readonly string[]>>,
    chunkFileIdByChunkId: EMPTY_RECORD as Readonly<Record<string, string>>,
    localThreadsById: EMPTY_RECORD as Readonly<Record<string, ReviewLocalAnnotationThread>>,
    localThreadIds: EMPTY_ARRAY as readonly string[],
    localRepliesByThreadId: EMPTY_RECORD as Readonly<
      Record<string, readonly ReviewLocalAnnotationReply[]>
    >,
    overviewNotesById: EMPTY_RECORD as Readonly<Record<string, ReviewOverviewNote>>,
    overviewNoteIds: EMPTY_ARRAY as readonly string[],
    analysisArtifactsById: EMPTY_RECORD as Readonly<Record<string, ReviewAnalysisArtifact>>,
    analysisArtifactIds: EMPTY_ARRAY as readonly string[],
    github: null,
    githubThreadsById: EMPTY_RECORD as Readonly<Record<string, GitHubReviewThread>>,
    githubThreadIds: EMPTY_ARRAY as readonly string[],
    githubCommentsById: EMPTY_RECORD as Readonly<Record<string, GitHubReviewComment>>,
    githubGeneralCommentsById: EMPTY_RECORD as Readonly<Record<string, GitHubReviewGeneralComment>>,
    githubGeneralCommentIds: EMPTY_ARRAY as readonly string[],
  };
}

export function normalizeReviewSnapshot(
  snapshot: ReviewSessionSnapshot | null,
): ReviewNormalizedSnapshot {
  if (!snapshot) {
    return createEmptyNormalizedSnapshot();
  }

  const groupsById: Record<string, ReviewGroup> = {};
  for (const group of snapshot.groups) {
    groupsById[group.id] = group;
  }

  const filesById: Record<string, ReviewFile> = {};
  for (const file of snapshot.files) {
    filesById[file.id] = file;
  }

  const localThreadsById: Record<string, ReviewLocalAnnotationThread> = {};
  for (const thread of snapshot.localThreads) {
    localThreadsById[thread.id] = thread;
  }

  const chunksById: Record<string, ReviewChunk> = {};
  const chunkIdsByFileId: Record<string, string[]> = {};
  const chunkFileIdByChunkId: Record<string, string> = {};
  for (const chunk of snapshot.chunks) {
    chunksById[chunk.id] = chunk;
    const existing = chunkIdsByFileId[chunk.fileId] ?? [];
    existing.push(chunk.id);
    chunkIdsByFileId[chunk.fileId] = existing;
    chunkFileIdByChunkId[chunk.id] = chunk.fileId;
  }

  const localRepliesByThreadId: Record<string, ReviewLocalAnnotationReply[]> = {};
  for (const reply of snapshot.localReplies) {
    const existing = localRepliesByThreadId[reply.threadId] ?? [];
    existing.push(reply);
    localRepliesByThreadId[reply.threadId] = existing;
  }

  const overviewNotesById: Record<string, ReviewOverviewNote> = {};
  for (const note of snapshot.overviewNotes) {
    overviewNotesById[note.id] = note;
  }

  const analysisArtifactsById: Record<string, ReviewAnalysisArtifact> = {};
  for (const artifact of snapshot.analysisArtifacts) {
    analysisArtifactsById[artifact.id] = artifact;
  }

  const githubThreadsById: Record<string, GitHubReviewThread> = {};
  const githubCommentsById: Record<string, GitHubReviewComment> = {};
  const githubThreadIds: string[] = [];
  const githubGeneralCommentsById: Record<string, GitHubReviewGeneralComment> = {};
  const githubGeneralCommentIds: string[] = [];

  for (const thread of snapshot.github?.draft?.threads ?? []) {
    githubThreadIds.push(thread.id);
    githubThreadsById[thread.id] = thread;
    for (const comment of thread.comments) {
      githubCommentsById[comment.id] = comment;
    }
  }

  for (const thread of snapshot.github?.threads ?? []) {
    if (!githubThreadsById[thread.id]) {
      githubThreadIds.push(thread.id);
    }
    githubThreadsById[thread.id] = thread;
    for (const comment of thread.comments) {
      githubCommentsById[comment.id] = comment;
    }
  }

  for (const review of snapshot.github?.reviews ?? []) {
    for (const thread of review.threads) {
      if (!githubThreadsById[thread.id]) {
        githubThreadIds.push(thread.id);
      }
      githubThreadsById[thread.id] = thread;
      for (const comment of thread.comments) {
        githubCommentsById[comment.id] = comment;
      }
    }
  }

  for (const comment of snapshot.github?.generalComments ?? []) {
    githubGeneralCommentsById[comment.id] = comment;
    githubGeneralCommentIds.push(comment.id);
  }

  return {
    summary: snapshot.summary,
    groupsById,
    groupIds: snapshot.groups.map((group) => group.id),
    filesById,
    fileIds: snapshot.files.map((file) => file.id),
    chunksById,
    chunkIds: snapshot.chunks.map((chunk) => chunk.id),
    chunkIdsByFileId,
    chunkFileIdByChunkId,
    localThreadsById,
    localThreadIds: snapshot.localThreads.map((thread) => thread.id),
    localRepliesByThreadId,
    overviewNotesById,
    overviewNoteIds: snapshot.overviewNotes.map((note) => note.id),
    analysisArtifactsById,
    analysisArtifactIds: snapshot.analysisArtifacts.map((artifact) => artifact.id),
    github: snapshot.github,
    githubThreadsById,
    githubThreadIds,
    githubCommentsById,
    githubGeneralCommentsById,
    githubGeneralCommentIds,
  };
}

export function normalizeReviewDiffSnapshot(
  diffSnapshot: ReviewDiffSnapshot | null,
): ReviewExplorerState {
  if (!diffSnapshot) {
    return createEmptyReviewExplorerState();
  }

  const laneById: Record<string, ReviewDiffSnapshot["lanes"][number]> = {};
  const fileIdsByLaneId: Record<string, string[]> = {};
  const fileEntryById: Record<string, ReviewDiffFileEntry> = {};

  for (const lane of diffSnapshot.lanes) {
    laneById[lane.groupId] = lane;
    const fileIds: string[] = [];
    for (const file of lane.files) {
      fileIds.push(file.fileId);
      fileEntryById[file.fileId] = file;
    }
    fileIdsByLaneId[lane.groupId] = fileIds;
  }

  return {
    laneIds: diffSnapshot.lanes.map((lane) => lane.groupId),
    laneById,
    fileIdsByLaneId,
    fileEntryById,
    chunkIdsByFileId: EMPTY_RECORD as Readonly<Record<string, readonly string[]>>,
    chunkFileIdByChunkId: EMPTY_RECORD as Readonly<Record<string, string>>,
    chunkPatchById: EMPTY_RECORD as Readonly<
      Record<
        string,
        {
          readonly fileId: string;
          readonly lane: ReviewRawLaneKind;
          readonly normalizedPath: string;
        }
      >
    >,
  };
}

export function mergeFilePatchIntoExplorer(
  explorer: ReviewExplorerState,
  patch: ReviewDiffFilePatch | null,
): ReviewExplorerState {
  if (!patch) {
    return explorer;
  }

  const chunkIdsByFileId = {
    ...explorer.chunkIdsByFileId,
    [patch.fileId]: patch.chunks.map((chunk) => chunk.chunkId),
  };
  const chunkFileIdByChunkId = { ...explorer.chunkFileIdByChunkId };
  const chunkPatchById = { ...explorer.chunkPatchById };

  for (const chunk of patch.chunks) {
    chunkFileIdByChunkId[chunk.chunkId] = patch.fileId;
    chunkPatchById[chunk.chunkId] = {
      fileId: patch.fileId,
      lane: patch.lane,
      normalizedPath: patch.normalizedPath,
    };
  }

  return {
    ...explorer,
    chunkIdsByFileId,
    chunkFileIdByChunkId,
    chunkPatchById,
  };
}

export function resolveReviewSelection(args: {
  readonly routeState: ReviewRouteState;
  readonly snapshot: ReviewNormalizedSnapshot;
  readonly explorer: ReviewExplorerState;
}): ReviewSelectionState {
  const groupId =
    args.routeState.reviewGroupId && args.snapshot.groupsById[args.routeState.reviewGroupId]
      ? args.routeState.reviewGroupId
      : null;
  const fileId =
    args.routeState.reviewFileId && args.snapshot.filesById[args.routeState.reviewFileId]
      ? args.routeState.reviewFileId
      : null;
  const chunkId =
    args.routeState.reviewChunkId &&
    args.snapshot.chunkFileIdByChunkId[args.routeState.reviewChunkId]
      ? args.routeState.reviewChunkId
      : null;

  const commentId = args.routeState.reviewCommentId ?? null;
  const hasComment =
    commentId !== null &&
    (args.snapshot.localThreadsById[commentId] !== undefined ||
      args.snapshot.githubThreadsById[commentId] !== undefined ||
      args.snapshot.githubCommentsById[commentId] !== undefined);

  return {
    groupId,
    fileId,
    chunkId,
    commentId: hasComment ? commentId : null,
    hasInvalidGroupId:
      args.routeState.reviewGroupId !== undefined && args.routeState.reviewGroupId !== groupId,
    hasInvalidFileId:
      args.routeState.reviewFileId !== undefined && args.routeState.reviewFileId !== fileId,
    hasInvalidChunkId:
      args.routeState.reviewChunkId !== undefined && args.routeState.reviewChunkId !== chunkId,
    hasInvalidCommentId:
      args.routeState.reviewCommentId !== undefined && (!commentId || !hasComment),
  };
}

export function deriveReviewProviderAvailability(args: {
  readonly connectionState: SavedEnvironmentConnectionState;
  readonly authState: SavedEnvironmentRuntimeState["authState"];
  readonly serverProviders: readonly ServerProvider[];
  readonly github: GitHubReviewSnapshot | null;
}): ReviewProviderAvailabilityState {
  return {
    connectionState: args.connectionState,
    authState: args.authState,
    serverProviders: args.serverProviders.map((provider) => ({
      key:
        provider.instanceId ??
        provider.provider ??
        provider.driver ??
        provider.displayName ??
        "provider",
      label:
        provider.displayName?.trim() ||
        provider.provider?.trim() ||
        provider.driver?.trim() ||
        "Provider",
      state: provider.status,
      availability: provider.availability ?? "unknown",
      authStatus: provider.auth.status,
      message: provider.message ?? provider.unavailableReason ?? null,
    })),
    github: {
      available: args.github !== null,
      writable: args.github?.writable ?? null,
      pullRequestNumber: args.github?.pullRequestNumber ?? null,
    },
  };
}

export function deriveReviewDegradedBanners(args: {
  readonly summary: ReviewSessionSummary | null;
  readonly providerAvailability: ReviewProviderAvailabilityState;
  readonly selection: ReviewSelectionState;
}): readonly ReviewDegradedBanner[] {
  const banners: ReviewDegradedBanner[] = [];

  if (args.providerAvailability.connectionState !== "connected") {
    banners.push({
      id: "connection",
      tone: "error",
      title: "Live review is disconnected",
      detail:
        args.providerAvailability.connectionState === "error"
          ? "The environment connection is in an error state."
          : "Reconnect to resume live review updates and on-demand payload fetches.",
    });
  }

  for (const reason of args.summary?.degradedReasons ?? []) {
    banners.push({
      id: `degraded:${reason}`,
      tone: reason === "offline" || reason === "provider-unavailable" ? "error" : "warning",
      title: formatDegradedTitle(reason),
      detail: formatDegradedDetail(reason),
    });
  }

  if (
    args.selection.hasInvalidGroupId ||
    args.selection.hasInvalidFileId ||
    args.selection.hasInvalidChunkId
  ) {
    banners.push({
      id: "selection:stale",
      tone: "warning",
      title: "The deep link is stale",
      detail: "One or more selected review items no longer exist in the current diff.",
    });
  }

  return banners;
}

function formatDegradedTitle(
  reason: NonNullable<ReviewSessionSummary["degradedReasons"]>[number],
): string {
  switch (reason) {
    case "not-a-repository":
      return "Review target is not a repository";
    case "git-status-unavailable":
      return "Git status is unavailable";
    case "diff-unavailable":
      return "Diff data is unavailable";
    case "patch-truncated":
      return "Patch data was truncated";
    case "provider-unavailable":
      return "A provider is unavailable";
    case "github-unavailable":
      return "GitHub review data is unavailable";
    case "offline":
      return "Review is offline";
    case "permissions-limited":
      return "Permissions are limited";
    default:
      return reason;
  }
}

function formatDegradedDetail(
  reason: NonNullable<ReviewSessionSummary["degradedReasons"]>[number],
): string {
  switch (reason) {
    case "not-a-repository":
      return "Fenrir could not resolve a Git repository for this thread.";
    case "git-status-unavailable":
      return "Git metadata could not be read for the current checkout.";
    case "diff-unavailable":
      return "The live review session could not rebuild the latest diff snapshot.";
    case "patch-truncated":
      return "Some patch payloads were truncated and may need targeted refetches.";
    case "provider-unavailable":
      return "At least one provider needed for review workflows is currently unavailable.";
    case "github-unavailable":
      return "GitHub review context could not be loaded for this review session.";
    case "offline":
      return "The review session is offline and cannot refresh provider-backed data.";
    case "permissions-limited":
      return "The current auth/session permissions block parts of the review workflow.";
    default:
      return reason;
  }
}

export function filePatchCacheKey(input: {
  readonly sessionId: string;
  readonly scope: string;
  readonly lane: string;
  readonly normalizedPath: string;
}): string {
  return `${input.sessionId}::${input.scope}::${input.lane}::${input.normalizedPath}`;
}

export function chunkPayloadCacheKey(input: {
  readonly sessionId: string;
  readonly scope: string;
  readonly lane: string;
  readonly normalizedPath: string;
  readonly chunkId: string;
}): string {
  return `${input.sessionId}::${input.scope}::${input.lane}::${input.normalizedPath}::${input.chunkId}`;
}

export function diffSnapshotCacheToken(snapshot: ReviewDiffSnapshot | null): string | null {
  if (!snapshot) {
    return null;
  }
  return JSON.stringify({
    scope: snapshot.scope,
    target: {
      baseRef: snapshot.target.baseRef ?? null,
      headRef: snapshot.target.headRef ?? null,
      baseCommitOid: snapshot.target.baseCommitOid ?? null,
      headCommitOid: snapshot.target.headCommitOid ?? null,
      pullRequestNumber: snapshot.target.pullRequestNumber ?? null,
    },
    lanes: snapshot.lanes.map((lane) => ({
      id: lane.groupId,
      kind: lane.kind,
      files: lane.files.map((file) => ({
        id: file.fileId,
        path: file.normalizedPath,
        chunks: file.chunkCount,
        insertions: file.insertions,
        deletions: file.deletions,
      })),
    })),
  });
}

export function filterVisibleFileIds(args: {
  readonly laneId: string;
  readonly explorer: ReviewExplorerState;
  readonly snapshot: ReviewNormalizedSnapshot;
  readonly filters: ReviewActivityFilters;
}): readonly string[] {
  const lane = args.explorer.laneById[args.laneId];
  if (!lane || !args.filters.laneKinds[lane.kind]) {
    return EMPTY_ARRAY as readonly string[];
  }

  return (args.explorer.fileIdsByLaneId[args.laneId] ?? EMPTY_ARRAY).filter((fileId) => {
    const file = args.snapshot.filesById[fileId];
    return file ? args.filters.progressStates[file.progressState] : true;
  });
}

export function countVisibleLocalThreads(args: {
  readonly snapshot: ReviewNormalizedSnapshot;
  readonly filters: ReviewActivityFilters;
}): number {
  if (!args.filters.showLocalThreads) {
    return 0;
  }
  return args.snapshot.localThreadIds.filter((threadId) => {
    const thread = args.snapshot.localThreadsById[threadId];
    return thread ? args.filters.progressStates[thread.progressState] : false;
  }).length;
}

export function countVisibleOverviewNotes(args: {
  readonly snapshot: ReviewNormalizedSnapshot;
  readonly filters: ReviewActivityFilters;
}): number {
  if (!args.filters.showOverviewNotes) {
    return 0;
  }
  return args.snapshot.overviewNoteIds.filter((noteId) => {
    const note = args.snapshot.overviewNotesById[noteId];
    return note ? args.filters.progressStates[note.progressState] : false;
  }).length;
}

export function findChunkPayload(
  entry: ReviewChunkPayload | null | undefined,
): ReviewChunkPayload | null {
  return entry ?? null;
}
