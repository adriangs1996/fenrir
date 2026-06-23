import type { LoadDiffFileResult } from "@fenrir/contracts";
import { describe, expect, it } from "vitest";

import {
  appendGitDiffReviewContextToPrompt,
  extractGitDiffReviewSelectionText,
  formatGitDiffReviewContextLabels,
  formatGitDiffReviewContextTitle,
  resolveGitDiffReviewSelectionHunkIndex,
  type GitDiffReviewPromptContext,
} from "./gitDiffReviewPromptContext";

const diff: LoadDiffFileResult = {
  path: "src/App.tsx",
  previousPath: null,
  oldFile: {
    path: "src/App.tsx",
    contents: ["old one", "old two", "old three"].join("\n"),
  },
  newFile: {
    path: "src/App.tsx",
    contents: ["new one", "new two", "new three"].join("\n"),
  },
  patch: "",
  patchTruncated: false,
  oldFileTooLarge: false,
  newFileTooLarge: false,
};

function makeContext(overrides?: Partial<GitDiffReviewPromptContext>): GitDiffReviewPromptContext {
  return {
    filePath: "src/App.tsx",
    previousPath: null,
    repositoryCwd: "/workspace/packages/app",
    projectCwd: "/workspace",
    threadWorktreePath: "/worktrees/review",
    branch: "feature/review",
    target: { kind: "worktree" },
    selection: null,
    reviewThreads: [],
    ...overrides,
  };
}

describe("gitDiffReviewPromptContext", () => {
  it("extracts selected lines from the correct diff side", () => {
    expect(
      extractGitDiffReviewSelectionText(diff, {
        side: "additions",
        start: 2,
        end: 3,
      }),
    ).toBe("new two\nnew three");
    expect(
      extractGitDiffReviewSelectionText(diff, {
        side: "deletions",
        start: 1,
        end: 2,
      }),
    ).toBe("old one\nold two");
  });

  it("appends review metadata and visual selection to the prompt", () => {
    const result = appendGitDiffReviewContextToPrompt(
      "Check this review finding",
      makeContext({
        selection: {
          side: "additions",
          start: 2,
          end: 3,
          text: "new two\nnew three",
        },
      }),
    );

    expect(result).toContain("Check this review finding");
    expect(result).toContain('<git_diff_review_context file="src/App.tsx"');
    expect(result).toContain("- Repository cwd: /workspace/packages/app");
    expect(result).toContain("- Project cwd: /workspace");
    expect(result).toContain("- Thread worktree path: /worktrees/review");
    expect(result).toContain("- Branch: feature/review");
    expect(result).toContain("- Visual selection: additions lines 2-3");
    expect(result).toContain("  2 | new two");
    expect(result).toContain("  3 | new three");
  });

  it("appends review comments for the selected file", () => {
    const result = appendGitDiffReviewContextToPrompt(
      "Address review feedback",
      makeContext({
        selection: {
          side: "additions",
          start: 2,
          end: 3,
          text: "new two\nnew three",
        },
        reviewThreads: [
          {
            id: "thread-1",
            path: "src/App.tsx",
            side: "additions",
            startLine: 2,
            line: 3,
            isResolved: false,
            isOutdated: false,
            comments: [
              {
                id: "comment-1",
                author: { login: "reviewer" },
                body: "Can we simplify this branch?",
                createdAt: "2026-06-17T10:00:00.000Z",
                url: "https://example.test/review/comment-1",
              },
            ],
          },
          {
            id: "thread-2",
            path: "src/App.tsx",
            side: "deletions",
            line: 1,
            isResolved: true,
            isOutdated: true,
            comments: [
              {
                id: "comment-2",
                author: { login: "maintainer" },
                body: "This old path can stay deleted.",
              },
            ],
          },
        ],
      }),
    );

    expect(result).toContain("- Review comments: 2 threads, 2 comments");
    expect(result).toContain(
      '<review_thread id="thread-1" path="src/App.tsx" side="additions" startLine="2" line="3" overlapsSelection="true">',
    );
    expect(result).toContain(
      '<review_comment id="comment-1" author="reviewer" createdAt="2026-06-17T10:00:00.000Z" url="https://example.test/review/comment-1">',
    );
    expect(result).toContain("  Can we simplify this branch?");
    expect(result).toContain(
      '<review_thread id="thread-2" path="src/App.tsx" side="deletions" startLine="1" line="1" overlapsSelection="false">',
    );
    expect(result).toContain("- State: resolved, outdated");
    expect(result).toContain("  This old path can stay deleted.");
  });

  it("formats compact labels for the prompt overlay", () => {
    const context = makeContext({
      selection: {
        side: "deletions",
        start: 1,
        end: 1,
        text: "old one",
      },
    });

    expect(formatGitDiffReviewContextTitle(context)).toBe("App.tsx deletions line 1");
    expect(formatGitDiffReviewContextLabels(context)).toEqual([
      "App.tsx deletions line 1",
      "branch feature/review",
      "/workspace/packages/app",
    ]);
  });

  it("resolves selected additions to the matching hunk index", () => {
    expect(
      resolveGitDiffReviewSelectionHunkIndex(
        [
          {
            index: 0,
            header: "@@ -1,1 +1,1 @@",
            oldStart: 1,
            oldLines: 1,
            newStart: 1,
            newLines: 1,
          },
          {
            index: 1,
            header: "@@ -10,2 +10,4 @@",
            oldStart: 10,
            oldLines: 2,
            newStart: 10,
            newLines: 4,
          },
        ],
        { side: "additions", start: 12, end: 13 },
      ),
    ).toBe(1);
  });

  it("resolves selected deletions using old-line hunk ranges", () => {
    expect(
      resolveGitDiffReviewSelectionHunkIndex(
        [
          {
            index: 0,
            header: "@@ -3,2 +3,0 @@",
            oldStart: 3,
            oldLines: 2,
            newStart: 3,
            newLines: 0,
          },
        ],
        { side: "deletions", start: 4, end: 4 },
      ),
    ).toBe(0);
  });

  it("returns null when the selected lines are outside every hunk", () => {
    expect(
      resolveGitDiffReviewSelectionHunkIndex(
        [
          {
            index: 0,
            header: "@@ -3,1 +3,1 @@",
            oldStart: 3,
            oldLines: 1,
            newStart: 3,
            newLines: 1,
          },
        ],
        { side: "additions", start: 20, end: 20 },
      ),
    ).toBeNull();
  });
});
