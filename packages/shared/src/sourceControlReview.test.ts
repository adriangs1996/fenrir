import { describe, expect, it } from "vitest";

import {
  deriveReanchorConfidenceInputs,
  hashReviewAnchor,
  normalizeReviewExcerpt,
  normalizeReviewPath,
} from "./sourceControlReview";

describe("review helpers", () => {
  it("normalizes review paths and excerpts", () => {
    expect(normalizeReviewPath(" ./apps\\\\web/../web/src/review.tsx ")).toBe(
      "apps/web/src/review.tsx",
    );
    expect(normalizeReviewExcerpt("  const   value = 1; \r\n\r\n\treturn value;  ")).toBe(
      "const value = 1;\nreturn value;",
    );
  });

  it("keeps anchor hashes stable across line-number churn", () => {
    const first = hashReviewAnchor({
      normalizedPath: "apps/server/src/review.ts",
      provenance: {
        scope: "branch",
        lane: "committed",
      },
      excerpt: "return buildRuntime(files);",
      excerptHash: "sha256:excerpt",
      patchFingerprint: "sha256:patch",
    });
    const second = hashReviewAnchor({
      normalizedPath: "./apps/server/src/review.ts",
      provenance: {
        scope: "branch",
        lane: "committed",
      },
      excerpt: "  return   buildRuntime(files); ",
      excerptHash: "sha256:excerpt",
      patchFingerprint: "sha256:patch",
    });

    expect(first).toBe(second);
  });

  it("derives re-anchor confidence inputs", () => {
    const result = deriveReanchorConfidenceInputs(
      {
        normalizedPath: "apps/server/src/review.ts",
        provenance: {
          scope: "uncommitted",
          lane: "unstaged",
        },
        oldRange: { startLine: 10, endLine: 12 },
        newRange: { startLine: 10, endLine: 15 },
        excerpt: "loadDiffSnapshot()",
        excerptHash: "sha256:excerpt",
        patchFingerprint: "sha256:patch",
      },
      {
        normalizedPath: "apps/server/src/review.ts",
        provenance: {
          scope: "uncommitted",
          lane: "unstaged",
        },
        oldRange: { startLine: 12, endLine: 14 },
        newRange: { startLine: 13, endLine: 18 },
        excerpt: "loadDiffSnapshot()",
        excerptHash: "sha256:excerpt",
        patchFingerprint: "sha256:patch",
      },
    );

    expect(result.sameNormalizedPath).toBe(true);
    expect(result.excerptHashMatches).toBe(true);
    expect(result.patchFingerprintMatches).toBe(true);
    expect(result.oldRangeDelta).toBe(2);
    expect(result.newRangeDelta).toBe(3);
  });
});
