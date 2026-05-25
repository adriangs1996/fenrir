import { describe, expect, it } from "vitest";

import {
  buildReviewExplorerTree,
  collectReviewExplorerAncestorPaths,
  collectReviewExplorerDirectoryPaths,
  type ReviewExplorerFileRef,
} from "./explorerTree";

function makeFileRef(input: {
  fileId: string;
  path: string;
  laneId?: string;
  insertions?: number;
  deletions?: number;
}) {
  return {
    laneId: input.laneId ?? "lane-1",
    fileId: input.fileId,
    fileEntry: {
      fileId: input.fileId,
      lane: "committed",
      normalizedPath: input.path,
      displayPath: input.path,
      insertions: input.insertions ?? 1,
      deletions: input.deletions ?? 0,
    },
  } as ReviewExplorerFileRef;
}

describe("review explorer tree", () => {
  it("compacts a single directory chain into a single folder node", () => {
    const tree = buildReviewExplorerTree([
      makeFileRef({ fileId: "file-1", path: "apps/web/src/index.ts", insertions: 2, deletions: 1 }),
      makeFileRef({ fileId: "file-2", path: "apps/web/src/main.ts", insertions: 3, deletions: 0 }),
    ]);

    expect(tree).toHaveLength(1);
    expect(tree[0]).toMatchObject({
      kind: "directory",
      name: "apps/web/src",
      path: "apps/web/src",
      stat: { insertions: 5, deletions: 1 },
    });
    expect(
      tree[0]?.kind === "directory" ? tree[0].children.map((child) => child.name) : [],
    ).toEqual(["index.ts", "main.ts"]);
  });

  it("preserves duplicate file names that share the same normalized path", () => {
    const tree = buildReviewExplorerTree([
      makeFileRef({ fileId: "file-1", path: "apps/server/src/git/index.ts" }),
      makeFileRef({ fileId: "file-2", path: "apps/server/src/git/index.ts" }),
    ]);

    const directory = tree[0];
    expect(directory?.kind).toBe("directory");
    if (!directory || directory.kind !== "directory") {
      throw new Error("expected directory");
    }

    expect(directory.children).toHaveLength(2);
    expect(directory.children.map((child) => child.kind)).toEqual(["file", "file"]);
    expect(directory.children.map((child) => child.name)).toEqual(["index.ts", "index.ts"]);
  });

  it("collects ancestor and directory paths for expansion state", () => {
    const tree = buildReviewExplorerTree([
      makeFileRef({ fileId: "file-1", path: "packages/contracts/src/review.ts" }),
      makeFileRef({ fileId: "file-2", path: "README.md" }),
    ]);

    expect(collectReviewExplorerDirectoryPaths(tree)).toEqual(["packages/contracts/src"]);
    expect(collectReviewExplorerAncestorPaths("packages/contracts/src/review.ts")).toEqual([
      "packages",
      "packages/contracts",
      "packages/contracts/src",
    ]);
  });
});
