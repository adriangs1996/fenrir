import { describe, expect, it } from "vitest";
import { resolveOpenChangeTarget } from "./rawState";

describe("resolveOpenChangeTarget", () => {
  it("keeps current-file line precision for surviving new lines", () => {
    expect(
      resolveOpenChangeTarget({
        cwd: "/repo",
        file: {
          fileId: "file-1" as never,
          groupId: "group-1" as never,
          lane: "committed",
          normalizedPath: "src/app.ts",
          displayPath: "src/app.ts",
          changeKind: "text",
          insertions: 1,
          deletions: 1,
        } as never,
        chunk: {
          chunkId: "chunk-1" as never,
          header: "@@ -10,2 +10,3 @@",
          anchor: {
            normalizedPath: "src/app.ts",
            provenance: { scope: "branch", lane: "committed" },
            oldRange: { startLine: 10, endLine: 11 },
            newRange: { startLine: 10, endLine: 12 },
            excerpt: "context",
          },
          lines: [
            { kind: "context", text: "const value = 1;", oldLineNumber: 10, newLineNumber: 10 },
            { kind: "delete", text: "oldLine()", oldLineNumber: 11 },
            { kind: "add", text: "newLine()", newLineNumber: 11 },
          ],
        },
      }),
    ).toBe("/repo/src/app.ts:10");
  });

  it("maps deleted hunks to the nearest surviving current-file line", () => {
    expect(
      resolveOpenChangeTarget({
        cwd: "/repo",
        file: {
          fileId: "file-1" as never,
          groupId: "group-1" as never,
          lane: "committed",
          normalizedPath: "src/app.ts",
          displayPath: "src/app.ts",
          changeKind: "text",
          insertions: 0,
          deletions: 2,
        } as never,
        chunk: {
          chunkId: "chunk-1" as never,
          header: "@@ -20,4 +20,2 @@",
          anchor: {
            normalizedPath: "src/app.ts",
            provenance: { scope: "branch", lane: "committed" },
            oldRange: { startLine: 21, endLine: 22 },
            excerpt: "deleted block",
          },
          lines: [
            { kind: "context", text: "before()", oldLineNumber: 20, newLineNumber: 20 },
            { kind: "delete", text: "removeOne()", oldLineNumber: 21 },
            { kind: "delete", text: "removeTwo()", oldLineNumber: 22 },
            { kind: "context", text: "after()", oldLineNumber: 23, newLineNumber: 21 },
          ],
        },
      }),
    ).toBe("/repo/src/app.ts:21");
  });

  it("opens deleted files without a dead line target", () => {
    expect(
      resolveOpenChangeTarget({
        cwd: "/repo",
        file: {
          fileId: "file-1" as never,
          groupId: "group-1" as never,
          lane: "committed",
          normalizedPath: "src/deleted.ts",
          displayPath: "src/deleted.ts",
          changeKind: "delete",
          insertions: 0,
          deletions: 12,
        } as never,
        chunk: {
          chunkId: "chunk-1" as never,
          header: "@@ -1,12 +0,0 @@",
          anchor: {
            normalizedPath: "src/deleted.ts",
            provenance: { scope: "branch", lane: "committed" },
            oldRange: { startLine: 1, endLine: 12 },
            excerpt: "entire file deleted",
          },
          lines: [{ kind: "delete", text: "gone()", oldLineNumber: 1 }],
        },
      }),
    ).toBe("/repo/src/deleted.ts");
  });
});
