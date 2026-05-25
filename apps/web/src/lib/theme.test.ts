import { describe, expect, it } from "vitest";
import { isTheme, resolveDesktopTheme, resolveThemeState, THEME_OPTIONS } from "./theme";

describe("theme", () => {
  it("registers the Kanagawa theme options", () => {
    expect(THEME_OPTIONS.map((option) => option.value)).toContain("kanagawa");
    expect(THEME_OPTIONS.map((option) => option.value)).toContain("kanagawa-dragon");
    expect(isTheme("kanagawa")).toBe(true);
    expect(isTheme("kanagawa-dragon")).toBe(true);
  });

  it("maps Kanagawa to the Wave syntax theme", () => {
    expect(resolveThemeState("kanagawa", false)).toEqual({
      customThemeClassName: "kanagawa",
      resolvedTheme: "dark",
      syntaxTheme: "kanagawa-wave",
    });
  });

  it("treats Kanagawa Dragon as a dark custom theme", () => {
    expect(resolveThemeState("kanagawa-dragon", false)).toEqual({
      customThemeClassName: "kanagawa-dragon",
      resolvedTheme: "dark",
      syntaxTheme: "kanagawa-dragon",
    });
    expect(resolveDesktopTheme("kanagawa-dragon")).toBe("dark");
  });
});
