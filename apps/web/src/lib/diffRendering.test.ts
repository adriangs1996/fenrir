import { describe, expect, it } from "vitest";
import { RegisteredCustomThemes } from "@pierre/diffs";
import {
  DIFF_CHANGE_HIGHLIGHT_UNSAFE_CSS,
  DIFF_HIGHLIGHTER_THEME_NAMES,
  buildPatchCacheKey,
  resolveDiffThemeName,
} from "./diffRendering";
import { DRACULA_PRO_THEME_NAMES } from "./draculaProThemeData";

describe("resolveDiffThemeName", () => {
  it("maps custom syntax themes to matching Shiki theme ids", () => {
    expect(resolveDiffThemeName("pierre-dark")).toBe("pierre-dark");
    expect(resolveDiffThemeName("pierre-dark-soft")).toBe("pierre-dark-soft");
    expect(resolveDiffThemeName("kanagawa-wave")).toBe("kanagawa-wave");
    expect(resolveDiffThemeName("kanagawa-dragon")).toBe("kanagawa-dragon");
    expect(resolveDiffThemeName("catppuccin-mocha")).toBe("catppuccin-mocha");
    expect(resolveDiffThemeName("rose-pine")).toBe("rose-pine");
    expect(resolveDiffThemeName("nord")).toBe("nord");
    expect(resolveDiffThemeName("tokyonight-moon")).toBe("tokyonight-moon");
    expect(resolveDiffThemeName("dracula-pro")).toBe("dracula-pro");
    for (const themeName of DRACULA_PRO_THEME_NAMES) {
      expect(resolveDiffThemeName(themeName)).toBe(themeName);
    }
  });

  it("preloads every Shiki theme used by app syntax themes", () => {
    expect(DIFF_HIGHLIGHTER_THEME_NAMES).toEqual([
      "pierre-dark",
      "pierre-light",
      "pierre-dark-soft",
      "catppuccin-mocha",
      "rose-pine",
      "kanagawa-wave",
      "kanagawa-dragon",
      "tokyonight-moon",
      ...DRACULA_PRO_THEME_NAMES,
      "nord",
    ]);
  });

  it("registers custom Shiki themes", () => {
    expect(RegisteredCustomThemes.has("tokyonight-moon")).toBe(true);
    expect(RegisteredCustomThemes.has("dracula-pro")).toBe(true);
    for (const themeName of DRACULA_PRO_THEME_NAMES) {
      expect(RegisteredCustomThemes.has(themeName)).toBe(true);
    }
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
