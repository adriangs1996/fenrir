import { describe, expect, it } from "vitest";

import { buildReviewExplorerTree } from "../explorerTree";
import {
  buildExplorerRows,
  estimateExplorerRowSize,
  estimatePatchChunkRowSize,
} from "./ReviewRawModeShell";

function makeFileRef(input: { fileId: string; path: string; laneId?: string }) {
  return {
    laneId: input.laneId ?? "lane-1",
    fileId: input.fileId,
    fileEntry: {
      fileId: input.fileId,
      lane: "committed",
      normalizedPath: input.path,
      displayPath: input.path,
      insertions: 1,
      deletions: 0,
    },
  } as never;
}

describe("ReviewRawModeShell logic", () => {
  it("keeps large explorer payloads lazy by only rendering chunks for the selected file patch", () => {
    const sectionTrees = new Map([
      [
        "committed",
        buildReviewExplorerTree(
          Array.from({ length: 250 }, (_, index) =>
            makeFileRef({
              fileId: `file-${index + 1}`,
              path: `src/file-${index + 1}.ts`,
            }),
          ),
        ),
      ],
    ]);

    const rows = buildExplorerRows({
      sectionTrees: sectionTrees as never,
      expandedSections: {
        ignored: false,
        unstaged: false,
        staged: false,
        committed: true,
      },
      expandedDirectories: {
        "directory:committed:src": true,
      },
      autoExpandedDirectories: new Set<string>(),
      fileExpansion: {
        "file-1": true,
        "file-2": true,
      },
      selectedFileId: "file-2",
      selectedPatchFileId: "file-2",
      selectedFilePatch: {
        status: "ready",
        value: {
          fileId: "file-2",
          chunks: [
            { chunkId: "chunk-1", lines: [] },
            { chunkId: "chunk-2", lines: [] },
          ],
        },
        error: null,
      } as never,
    });

    expect(rows.filter((row) => row.kind === "file")).toHaveLength(250);
    expect(rows.filter((row) => row.kind === "chunk").map((row) => row.fileId)).toEqual([
      "file-2",
      "file-2",
    ]);
    expect(rows.some((row) => row.kind === "status" && row.fileId === "file-1")).toBe(false);
  });

  it("uses stable row estimates for explorer and patch virtualization", () => {
    expect(estimateExplorerRowSize(undefined)).toBe(56);
    expect(
      estimateExplorerRowSize({
        id: "status:file-1:error",
        kind: "status",
        sectionKey: "committed",
        depth: 1,
        fileId: "file-1",
        message: "failed",
        tone: "error",
      }),
    ).toBe(28);
    expect(
      estimatePatchChunkRowSize({
        lines: Array.from({ length: 20 }, () => ({ kind: "context", text: "x" })),
      } as never),
    ).toBe(424);
  });
});
