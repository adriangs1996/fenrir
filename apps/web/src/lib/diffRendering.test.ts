import { describe, expect, it } from "vitest";
import {
  DIFF_CHANGE_HIGHLIGHT_UNSAFE_CSS,
  DIFF_HIGHLIGHTER_THEME_NAMES,
  buildPatchCacheKey,
  resolveDiffThemeName,
} from "./diffRendering";

describe("resolveDiffThemeName", () => {
  it("maps custom syntax themes to matching Shiki theme ids", () => {
    expect(resolveDiffThemeName("kanagawa-wave")).toBe("kanagawa-wave");
    expect(resolveDiffThemeName("kanagawa-dragon")).toBe("kanagawa-dragon");
    expect(resolveDiffThemeName("catppuccin-mocha")).toBe("catppuccin-mocha");
    expect(resolveDiffThemeName("rose-pine")).toBe("rose-pine");
    expect(resolveDiffThemeName("nord")).toBe("nord");
  });

  it("preloads every Shiki theme used by app syntax themes", () => {
    expect(DIFF_HIGHLIGHTER_THEME_NAMES).toEqual([
      "pierre-dark",
      "pierre-light",
      "catppuccin-mocha",
      "rose-pine",
      "kanagawa-wave",
      "kanagawa-dragon",
      "nord",
    ]);
  });
});

describe("DIFF_CHANGE_HIGHLIGHT_UNSAFE_CSS", () => {
  it("targets semantic colors directly so row highlights are not double-mixed", () => {
    expect(DIFF_CHANGE_HIGHLIGHT_UNSAFE_CSS).toContain(
      "--diffs-bg-addition-override: var(--success-foreground)",
    );
    expect(DIFF_CHANGE_HIGHLIGHT_UNSAFE_CSS).toContain(
      "--diffs-bg-deletion-override: var(--destructive-foreground)",
    );
    expect(DIFF_CHANGE_HIGHLIGHT_UNSAFE_CSS).toContain("--mix-dark: 68%");
  });
});

describe("buildPatchCacheKey", () => {
  it("returns a stable cache key for identical content", () => {
    const patch = "diff --git a/a.ts b/a.ts\n+console.log('hello')";

    expect(buildPatchCacheKey(patch)).toBe(buildPatchCacheKey(patch));
  });

  it("normalizes outer whitespace before hashing", () => {
    const patch = "diff --git a/a.ts b/a.ts\n+console.log('hello')";

    expect(buildPatchCacheKey(`\n${patch}\n`)).toBe(buildPatchCacheKey(patch));
  });

  it("changes when diff content changes", () => {
    const before = "diff --git a/a.ts b/a.ts\n+console.log('hello')";
    const after = "diff --git a/a.ts b/a.ts\n+console.log('hello world')";

    expect(buildPatchCacheKey(before)).not.toBe(buildPatchCacheKey(after));
  });

  it("changes when cache scope changes", () => {
    const patch = "diff --git a/a.ts b/a.ts\n+console.log('hello')";

    expect(buildPatchCacheKey(patch, "diff-panel:light")).not.toBe(
      buildPatchCacheKey(patch, "diff-panel:dark"),
    );
  });
});
