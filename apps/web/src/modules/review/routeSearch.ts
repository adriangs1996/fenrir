export type ReviewRouteMode = "raw" | "review";
export type ReviewRouteScope = "uncommitted" | "branch" | "combined";
export type ReviewRouteGroupId = string;
export type ReviewRouteFileId = string;
export type ReviewRouteChunkId = string;

export interface ReviewRouteSearch {
  tab?: "review" | undefined;
  reviewMode?: ReviewRouteMode | undefined;
  reviewScope?: ReviewRouteScope | undefined;
  reviewGroupId?: ReviewRouteGroupId | undefined;
  reviewFileId?: ReviewRouteFileId | undefined;
  reviewChunkId?: ReviewRouteChunkId | undefined;
  reviewCommentId?: string | undefined;
}

export interface ReviewRouteState {
  tab: "review";
  reviewMode: ReviewRouteMode;
  reviewScope: ReviewRouteScope;
  reviewGroupId?: ReviewRouteGroupId | undefined;
  reviewFileId?: ReviewRouteFileId | undefined;
  reviewChunkId?: ReviewRouteChunkId | undefined;
  reviewCommentId?: string | undefined;
}

export const DEFAULT_REVIEW_ROUTE_MODE: ReviewRouteMode = "review";
export const DEFAULT_REVIEW_ROUTE_SCOPE: ReviewRouteScope = "combined";

const REVIEW_MODE_VALUES = new Set<ReviewRouteMode>(["raw", "review"]);
const REVIEW_SCOPE_VALUES = new Set<ReviewRouteScope>(["uncommitted", "branch", "combined"]);

function normalizeSearchString(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : undefined;
}

export function stripReviewSearchParams<T extends object>(
  params: T,
): Omit<
  T,
  | "tab"
  | "reviewMode"
  | "reviewScope"
  | "reviewGroupId"
  | "reviewFileId"
  | "reviewChunkId"
  | "reviewCommentId"
> {
  const searchParams = params as Record<string, unknown>;
  const {
    tab: _tab,
    reviewMode: _reviewMode,
    reviewScope: _reviewScope,
    reviewGroupId: _reviewGroupId,
    reviewFileId: _reviewFileId,
    reviewChunkId: _reviewChunkId,
    reviewCommentId: _reviewCommentId,
    ...rest
  } = searchParams;
  return rest as Omit<
    T,
    | "tab"
    | "reviewMode"
    | "reviewScope"
    | "reviewGroupId"
    | "reviewFileId"
    | "reviewChunkId"
    | "reviewCommentId"
  >;
}

export function parseReviewRouteSearch(search: Record<string, unknown>): ReviewRouteSearch {
  const tabRequested = normalizeSearchString(search.tab) === "review";
  const reviewModeRaw = normalizeSearchString(search.reviewMode);
  const reviewScopeRaw = normalizeSearchString(search.reviewScope);
  const reviewMode =
    reviewModeRaw && REVIEW_MODE_VALUES.has(reviewModeRaw as ReviewRouteMode)
      ? (reviewModeRaw as ReviewRouteMode)
      : undefined;
  const reviewScope =
    reviewScopeRaw && REVIEW_SCOPE_VALUES.has(reviewScopeRaw as ReviewRouteScope)
      ? (reviewScopeRaw as ReviewRouteScope)
      : undefined;
  const reviewGroupId = normalizeSearchString(search.reviewGroupId);
  const reviewFileId = normalizeSearchString(search.reviewFileId);
  const reviewChunkId = normalizeSearchString(search.reviewChunkId);
  const reviewCommentId = normalizeSearchString(search.reviewCommentId);
  const tab =
    tabRequested ||
    reviewMode !== undefined ||
    reviewScope !== undefined ||
    reviewGroupId !== undefined ||
    reviewFileId !== undefined ||
    reviewChunkId !== undefined ||
    reviewCommentId !== undefined
      ? "review"
      : undefined;

  return {
    ...(tab ? { tab } : {}),
    ...(reviewMode ? { reviewMode } : {}),
    ...(reviewScope ? { reviewScope } : {}),
    ...(reviewGroupId ? { reviewGroupId } : {}),
    ...(reviewFileId ? { reviewFileId } : {}),
    ...(reviewChunkId ? { reviewChunkId } : {}),
    ...(reviewCommentId ? { reviewCommentId } : {}),
  };
}

export function resolveReviewRouteState(search: ReviewRouteSearch): ReviewRouteState | null {
  if (search.tab !== "review") {
    return null;
  }

  return {
    tab: "review",
    reviewMode: search.reviewMode ?? DEFAULT_REVIEW_ROUTE_MODE,
    reviewScope: search.reviewScope ?? DEFAULT_REVIEW_ROUTE_SCOPE,
    ...(search.reviewGroupId ? { reviewGroupId: search.reviewGroupId } : {}),
    ...(search.reviewFileId ? { reviewFileId: search.reviewFileId } : {}),
    ...(search.reviewChunkId ? { reviewChunkId: search.reviewChunkId } : {}),
    ...(search.reviewCommentId ? { reviewCommentId: search.reviewCommentId } : {}),
  };
}

export function buildReviewRouteSearch(state: ReviewRouteState): ReviewRouteSearch {
  return {
    tab: "review",
    reviewMode: state.reviewMode,
    reviewScope: state.reviewScope,
    ...(state.reviewGroupId ? { reviewGroupId: state.reviewGroupId } : {}),
    ...(state.reviewFileId ? { reviewFileId: state.reviewFileId } : {}),
    ...(state.reviewChunkId ? { reviewChunkId: state.reviewChunkId } : {}),
    ...(state.reviewCommentId ? { reviewCommentId: state.reviewCommentId } : {}),
  };
}
