import { describe, expect, it } from "vitest";

import {
  anchorsOverlap,
  buildReviewNavigationItems,
  deriveGitHubComposerAvailability,
  deriveReviewAvailableCommands,
  filterVisibleGitHubThreads,
  moveReviewNavigation,
} from "./ReviewTabShell";

function makeState() {
  return {
    routeState: {
      tab: "review",
      reviewMode: "review",
      reviewScope: "combined",
    },
    filters: {
      progressStates: {
        unreviewed: true,
        reviewed: true,
        "needs-follow-up": false,
      },
    },
    explorer: {
      fileIdsByLaneId: {
        "lane-1": ["file-1", "file-2"],
      },
    },
    snapshot: {
      filesById: {
        "file-1": { id: "file-1", progressState: "unreviewed", normalizedPath: "src/a.ts" },
        "file-2": { id: "file-2", progressState: "needs-follow-up", normalizedPath: "src/b.ts" },
      },
      chunkIdsByFileId: {
        "file-1": ["chunk-1", "chunk-2"],
        "file-2": ["chunk-3"],
      },
      github: {
        writable: true,
      },
      githubThreadIds: ["gh-thread-1", "gh-thread-2"],
      githubThreadsById: {
        "gh-thread-1": {
          id: "gh-thread-1",
          path: "src/a.ts",
          anchor: {
            normalizedPath: "src/a.ts",
            newRange: { startLine: 12, endLine: 16 },
          },
          comments: [{ updatedAt: "2026-05-21T10:00:00.000Z" }],
        },
        "gh-thread-2": {
          id: "gh-thread-2",
          path: "src/a.ts",
          anchor: {
            normalizedPath: "src/a.ts",
            newRange: { startLine: 40, endLine: 44 },
          },
          comments: [{ updatedAt: "2026-05-21T09:00:00.000Z" }],
        },
      },
    },
  };
}

describe("ReviewTabShell logic", () => {
  it("derives review command availability from the current selection and composer context", () => {
    const commands = deriveReviewAvailableCommands({
      hasSelectedFileEntry: true,
      hasSelectedFile: true,
      hasComposerDraftTarget: false,
    });

    expect(commands.has("review.openChange")).toBe(true);
    expect(commands.has("review.markReviewed")).toBe(true);
    expect(commands.has("review.askAgent")).toBe(false);
  });

  it("builds navigation only for visible files and cycles between chunk deep links", () => {
    const items = buildReviewNavigationItems({
      review: {
        visibleLaneIds: ["lane-1"],
      },
      state: makeState(),
    } as never);

    expect(items).toHaveLength(3);
    expect(
      moveReviewNavigation(
        items,
        {
          groupId: "lane-1",
          fileId: "file-1",
          chunkId: "chunk-2",
        },
        "next",
      ),
    ).toEqual(items[0]?.routeState);
  });

  it("keeps GitHub inline review usable while filtering anchors that no longer overlap", () => {
    const state = makeState();
    const selectedAnchor = {
      normalizedPath: "src/a.ts",
      newRange: { startLine: 10, endLine: 20 },
      provenance: { scope: "branch", lane: "committed" },
      excerpt: "selected",
    } as const;

    expect(
      filterVisibleGitHubThreads({
        state: state as never,
        normalizedPath: "src/a.ts",
        selectedAnchor,
      }).map((thread) => thread.id),
    ).toEqual(["gh-thread-1"]);
    expect(
      deriveGitHubComposerAvailability({
        state: state as never,
        summaryPullRequestNumber: 42,
        selectedChunkAnchor: {
          ...selectedAnchor,
          provenance: { scope: "uncommitted", lane: "unstaged" },
        } as const,
      }),
    ).toMatchObject({
      ready: true,
      canCreateInlineComment: false,
    });
    expect(
      anchorsOverlap(
        selectedAnchor as never,
        state.snapshot.githubThreadsById["gh-thread-1"].anchor as never,
      ),
    ).toBe(true);
  });
});
