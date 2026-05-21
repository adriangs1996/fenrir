import { describe, expect, it } from "vitest";

import { deriveReviewDegradedBanners } from "./state";

describe("review state", () => {
  it("surfaces provider degradation alongside stale deep-link selection warnings", () => {
    const banners = deriveReviewDegradedBanners({
      summary: {
        degradedReasons: ["github-unavailable", "diff-unavailable"],
      } as never,
      providerAvailability: {
        connectionState: "connected",
        authState: "authenticated",
        serverProviders: [],
        github: {
          available: false,
          writable: null,
          pullRequestNumber: 42,
        },
      },
      selection: {
        groupId: null,
        fileId: null,
        chunkId: null,
        commentId: null,
        hasInvalidGroupId: false,
        hasInvalidFileId: true,
        hasInvalidChunkId: true,
        hasInvalidCommentId: false,
      },
    });

    expect(banners.map((banner) => banner.id)).toEqual([
      "degraded:github-unavailable",
      "degraded:diff-unavailable",
      "selection:stale",
    ]);
    expect(banners[0]?.tone).toBe("warning");
    expect(banners[1]?.tone).toBe("warning");
  });
});
