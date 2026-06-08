import { describe, expect, it } from "vitest";
import { isTheme, resolveDesktopTheme, resolveThemeState, THEME_OPTIONS } from "./theme";

describe("theme", () => {
  it("registers custom dark theme options", () => {
    expect(THEME_OPTIONS.map((option) => option.value)).toContain("pierre-dark");
    expect(THEME_OPTIONS.map((option) => option.value)).toContain("pierre-dark-soft");
    expect(THEME_OPTIONS.map((option) => option.value)).toContain("kanagawa");
    expect(THEME_OPTIONS.map((option) => option.value)).toContain("kanagawa-dragon");
    expect(isTheme("pierre-dark")).toBe(true);
    expect(isTheme("pierre-dark-soft")).toBe(true);
    expect(isTheme("kanagawa")).toBe(true);
    expect(isTheme("kanagawa-dragon")).toBe(true);
  });

  it("maps Pierre Dark to the Pierre syntax theme", () => {
    expect(resolveThemeState("pierre-dark", false)).toEqual({
      customThemeClassName: "pierre-dark",
      resolvedTheme: "dark",
      syntaxTheme: "pierre-dark",
    });
    expect(resolveDesktopTheme("pierre-dark")).toBe("dark");
  });

  it("maps Pierre Dark Soft to the Pierre soft syntax theme", () => {
    expect(resolveThemeState("pierre-dark-soft", false)).toEqual({
      customThemeClassName: "pierre-dark-soft",
      resolvedTheme: "dark",
      syntaxTheme: "pierre-dark-soft",
    });
    expect(resolveDesktopTheme("pierre-dark-soft")).toBe("dark");
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
