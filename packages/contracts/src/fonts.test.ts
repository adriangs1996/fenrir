import { describe, expect, it } from "vitest";
import {
  buildTerminalFontFamily,
  FULL_NERD_FONT_FALLBACK_FAMILIES,
  NERD_FONT_FALLBACK_FAMILIES,
  SYMBOL_NERD_FONT_FALLBACK_FAMILIES,
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

  it("prefers full nerd fonts before the bundled symbol-only fallback", () => {
    const fontFamily = buildTerminalFontFamily("MonoLisa");
    const firstFullFallback = FULL_NERD_FONT_FALLBACK_FAMILIES[0];
    const firstSymbolFallback = SYMBOL_NERD_FONT_FALLBACK_FAMILIES[0];
    expect(firstFullFallback).toBeDefined();
    expect(firstSymbolFallback).toBeDefined();
    expect(fontFamily.indexOf(firstFullFallback!)).toBeGreaterThan(-1);
    expect(fontFamily.indexOf(firstSymbolFallback!)).toBeGreaterThan(-1);
    expect(fontFamily.indexOf(firstFullFallback!)).toBeLessThan(
      fontFamily.indexOf(firstSymbolFallback!),
    );
  });

  it("includes explicit emoji fallbacks for prompt themes", () => {
    const fontFamily = buildTerminalFontFamily("MonoLisa");
    for (const family of TERMINAL_EMOJI_FALLBACK_FAMILIES) {
      expect(fontFamily).toContain(family);
    }
  });
});
