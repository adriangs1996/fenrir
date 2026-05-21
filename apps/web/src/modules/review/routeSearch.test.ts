import { describe, expect, it } from "vitest";
import {
  buildReviewRouteSearch,
  parseReviewRouteSearch,
  resolveReviewRouteState,
  stripReviewSearchParams,
} from "./routeSearch";

describe("review route search", () => {
  it("parses a valid review deep link", () => {
    expect(
      parseReviewRouteSearch({
        tab: "review",
        reviewMode: "raw",
        reviewScope: "branch",
        reviewGroupId: "group-1",
        reviewFileId: "file-1",
        reviewChunkId: "chunk-1",
        reviewCommentId: "comment-1",
      }),
    ).toEqual({
      tab: "review",
      reviewMode: "raw",
      reviewScope: "branch",
      reviewGroupId: "group-1",
      reviewFileId: "file-1",
      reviewChunkId: "chunk-1",
      reviewCommentId: "comment-1",
    });
  });

  it("infers the review tab from review-specific params", () => {
    expect(
      parseReviewRouteSearch({
        reviewScope: "combined",
        reviewFileId: "file-7",
      }),
    ).toEqual({
      tab: "review",
      reviewScope: "combined",
      reviewFileId: "file-7",
    });
  });

  it("drops invalid values", () => {
    expect(
      parseReviewRouteSearch({
        tab: "thread",
        reviewMode: "sideways",
        reviewScope: "all",
        reviewGroupId: "  ",
      }),
    ).toEqual({});
  });

  it("resolves canonical state with defaults", () => {
    expect(
      resolveReviewRouteState({
        tab: "review",
        reviewFileId: "file-9" as never,
      }),
    ).toEqual({
      tab: "review",
      reviewMode: "review",
      reviewScope: "combined",
      reviewFileId: "file-9",
    });
  });

  it("builds explicit review search state", () => {
    expect(
      buildReviewRouteSearch({
        tab: "review",
        reviewMode: "review",
        reviewScope: "uncommitted",
        reviewChunkId: "chunk-4" as never,
      }),
    ).toEqual({
      tab: "review",
      reviewMode: "review",
      reviewScope: "uncommitted",
      reviewChunkId: "chunk-4",
    });
  });

  it("strips review-specific params while preserving unrelated search", () => {
    expect(
      stripReviewSearchParams({
        tab: "review",
        reviewMode: "raw",
        reviewScope: "branch",
        reviewGroupId: "group-1",
        diff: "1",
      }),
    ).toEqual({
      diff: "1",
    });
  });
});
