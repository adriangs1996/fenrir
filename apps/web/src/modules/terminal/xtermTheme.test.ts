import { afterEach, describe, expect, it, vi } from "vitest";
import { DRACULA_PRO_VARIANTS } from "../../lib/draculaProThemeData";
import { terminalThemeFromApp } from "./xtermTheme";

function installDocumentMock(
  classNames: readonly string[],
  computedStyle?: Partial<CSSStyleDeclaration>,
) {
  const classes = new Set(classNames);
  const body = {};

  vi.stubGlobal("document", {
    body,
    documentElement: {
      classList: {
        contains: (className: string) => classes.has(className),
      },
    },
    querySelector: vi.fn(() => null),
  });
  vi.stubGlobal(
    "getComputedStyle",
    vi.fn(() => ({
      backgroundColor: "transparent",
      color: "transparent",
      ...computedStyle,
    })),
  );
}

describe("terminalThemeFromApp", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("uses the Pierre Dark terminal palette when the app theme is active", () => {
    installDocumentMock(["dark", "pierre-dark"]);

    expect(terminalThemeFromApp()).toEqual(
      expect.objectContaining({
        cursor: "#009fff",
        red: "#ff2e3f",
        green: "#0dbe4e",
        blue: "#009fff",
        scrollbarSliderBackground: "rgba(38, 38, 38, 0.72)",
      }),
    );
  });

  it("keeps Pierre Dark terminal surface colors derived from the xterm mount", () => {
    installDocumentMock(["dark", "pierre-dark"], {
      backgroundColor: "rgb(10, 10, 10)",
      color: "rgb(250, 250, 250)",
    });

    expect(terminalThemeFromApp()).toEqual(
      expect.objectContaining({
        background: "rgb(10, 10, 10)",
        foreground: "rgb(250, 250, 250)",
        cursor: "#009fff",
        red: "#ff2e3f",
      }),
    );
  });

  it("uses the Pierre Dark Soft terminal palette when the app theme is active", () => {
    installDocumentMock(["dark", "pierre-dark-soft"]);

    expect(terminalThemeFromApp()).toEqual(
      expect.objectContaining({
        cursor: "#69b1ff",
        red: "#ff2e3f",
        green: "#0dbe4e",
        blue: "#009fff",
        scrollbarSliderBackground: "rgba(44, 44, 44, 0.72)",
      }),
    );
  });

  it("uses the Catppuccin Mocha terminal palette when the app theme is active", () => {
    installDocumentMock(["dark", "catppuccin-mocha"]);

    expect(terminalThemeFromApp()).toEqual(
      expect.objectContaining({
        cursor: "#f5e0dc",
        red: "#f38ba8",
        green: "#a6e3a1",
        blue: "#89b4fa",
        scrollbarSliderBackground: "rgba(49, 50, 68, 0.6)",
      }),
    );
  });

  it("uses the Kanagawa Wave terminal palette when the app theme is active", () => {
    installDocumentMock(["dark", "kanagawa"]);

    expect(terminalThemeFromApp()).toEqual(
      expect.objectContaining({
        cursor: "#c8c093",
        red: "#c34043",
        green: "#76946a",
        blue: "#7e9cd8",
        scrollbarSliderBackground: "rgba(84, 84, 109, 0.4)",
      }),
    );
  });

  it("uses the Kanagawa Dragon terminal palette when the app theme is active", () => {
    installDocumentMock(["dark", "kanagawa-dragon"]);

    expect(terminalThemeFromApp()).toEqual(
      expect.objectContaining({
        cursor: "#c5c9c5",
        red: "#c4746e",
        green: "#8a9a7b",
        blue: "#8ba4b0",
        scrollbarSliderBackground: "rgba(98, 94, 90, 0.4)",
      }),
    );
  });

  it("uses the Tokyonight Moon terminal palette when the app theme is active", () => {
    installDocumentMock(["dark", "tokyonight-moon"]);

    expect(terminalThemeFromApp()).toEqual(
      expect.objectContaining({
        cursor: "#c8d3f5",
        red: "#ff757f",
        green: "#c3e88d",
        blue: "#82aaff",
        scrollbarSliderBackground: "rgba(68, 74, 115, 0.55)",
      }),
    );
  });

  it("uses Dracula Pro terminal palettes when app variants are active", () => {
    for (const variant of DRACULA_PRO_VARIANTS) {
      installDocumentMock(["dark", variant.name]);

      expect(terminalThemeFromApp()).toEqual(
        expect.objectContaining({
          cursor: "#F8F8F2",
          black: variant.palette.selection,
          brightBlack: variant.palette.comment,
          red: "#FF9580",
          green: "#8AFF80",
          blue: "#9580FF",
          scrollbarSliderBackground: expect.stringContaining("rgba("),
        }),
      );

      vi.unstubAllGlobals();
    }
  });

  it("uses the Nord terminal palette when the app theme is active", () => {
    installDocumentMock(["dark", "nord"]);

    expect(terminalThemeFromApp()).toEqual(
      expect.objectContaining({
        cursor: "#d8dee9",
        red: "#bf616a",
        green: "#a3be8c",
        blue: "#81a1c1",
        scrollbarSliderBackground: "rgba(76, 86, 106, 0.65)",
      }),
    );
  });

  it("keeps terminal background and foreground derived from the app surface", () => {
    installDocumentMock(["dark", "kanagawa"], {
      backgroundColor: "rgb(24, 28, 36)",
      color: "rgb(228, 232, 240)",
    });

    expect(terminalThemeFromApp()).toEqual(
      expect.objectContaining({
        background: "rgb(24, 28, 36)",
        foreground: "rgb(228, 232, 240)",
        red: "#c34043",
      }),
    );
  });
});
