import { describe, expect, it } from "vitest";
import { Schema } from "effect";

import { DiffTarget, GitDiffFileSummary, LoadDiffFileResult } from "./gitDiff";

const decodeDiffTarget = Schema.decodeUnknownSync(DiffTarget);
const decodeGitDiffFileSummary = Schema.decodeUnknownSync(GitDiffFileSummary);
const decodeLoadDiffFileResult = Schema.decodeUnknownSync(LoadDiffFileResult);

describe("DiffTarget", () => {
  it("accepts stash targets", () => {
    expect(decodeDiffTarget({ kind: "stash", ref: "stash@{0}" })).toEqual({
      kind: "stash",
      ref: "stash@{0}",
    });
  });
});

describe("GitDiffFileSummary", () => {
  it("defaults newer metadata fields to false for older payloads", () => {
    const summary = decodeGitDiffFileSummary({
      path: "src/file.ts",
      previousPath: null,
      insertions: 1,
      deletions: 0,
      binary: false,
    });

    expect(summary.isUntracked).toBe(false);
    expect(summary.isTooLarge).toBe(false);
    expect(summary.statsTruncated).toBe(false);
    expect(summary.hunkCount).toBe(0);
    expect(summary.hunks).toEqual([]);
  });

  it("accepts explicit newer metadata fields", () => {
    const summary = decodeGitDiffFileSummary({
      path: "src/new.ts",
      previousPath: null,
      insertions: 2,
      deletions: 0,
      binary: false,
      isUntracked: true,
      isTooLarge: true,
      statsTruncated: true,
      hunkCount: 1,
      hunks: [
        {
          index: 0,
          header: "@@ -1 +1 @@",
          oldStart: 1,
          oldLines: 1,
          newStart: 1,
          newLines: 1,
        },
      ],
    });

    expect(summary.isUntracked).toBe(true);
    expect(summary.isTooLarge).toBe(true);
    expect(summary.statsTruncated).toBe(true);
    expect(summary.hunkCount).toBe(1);
    expect(summary.hunks).toEqual([
      {
        index: 0,
        header: "@@ -1 +1 @@",
        oldStart: 1,
        oldLines: 1,
        newStart: 1,
        newLines: 1,
      },
    ]);
  });
});

describe("LoadDiffFileResult", () => {
  it("defaults newer metadata fields to false for older payloads", () => {
    const result = decodeLoadDiffFileResult({
      path: "src/file.ts",
      previousPath: null,
      oldFile: null,
      newFile: null,
      patch: "",
    });

    expect(result.patchTruncated).toBe(false);
    expect(result.oldFileTooLarge).toBe(false);
    expect(result.newFileTooLarge).toBe(false);
  });
});
