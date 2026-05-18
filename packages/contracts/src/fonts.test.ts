import { describe, expect, it } from "vitest";
import {
  buildTerminalFontFamily,
  NERD_FONT_FALLBACK_FAMILIES,
  TERMINAL_EMOJI_FALLBACK_FAMILIES,
} from "./fonts";

describe("buildTerminalFontFamily", () => {
  it("keeps the user-selected font first", () => {
    expect(buildTerminalFontFamily("MonoLisa")).toMatch(/^"MonoLisa", /);
  });

  it("includes bundled nerd-font symbol fallbacks", () => {
    const fontFamily = buildTerminalFontFamily("MonoLisa");
    for (const family of NERD_FONT_FALLBACK_FAMILIES) {
      expect(fontFamily).toContain(family);
    }
  });

  it("includes explicit emoji fallbacks for prompt themes", () => {
    const fontFamily = buildTerminalFontFamily("MonoLisa");
    for (const family of TERMINAL_EMOJI_FALLBACK_FAMILIES) {
      expect(fontFamily).toContain(family);
    }
  });
});
