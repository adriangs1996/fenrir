import * as Schema from "effect/Schema";

export const SystemFontSchema = Schema.Struct({
  family: Schema.String,
  category: Schema.Literals(["monospace", "sans-serif", "serif", "other"]),
});

export type SystemFont = typeof SystemFontSchema.Type;

export const SystemFontListSchema = Schema.Array(SystemFontSchema);
export type SystemFontList = typeof SystemFontListSchema.Type;

/**
 * Symbol-only nerd fonts that ship Private Use Area (PUA) icon glyphs.
 * Used as a glyph-level fallback so icons render even when the user picks
 * a base font without nerd-font glyphs. Order matters — browser walks the
 * chain per-codepoint and uses the first family that has the glyph.
 */
export const NERD_FONT_FALLBACK_FAMILIES = [
  '"Symbols Nerd Font Mono"',
  '"Symbols Nerd Font"',
  '"GeistMono Nerd Font"',
  '"GeistMono NFM"',
] as const;

/**
 * Color-emoji families used when prompt themes emit real Unicode emoji
 * alongside Nerd Font PUA symbols.
 */
export const TERMINAL_EMOJI_FALLBACK_FAMILIES = [
  '"Apple Color Emoji"',
  '"Segoe UI Emoji"',
  '"Segoe UI Symbol"',
  '"Noto Color Emoji"',
] as const;

/**
 * Fallback font families appended after the user-selected terminal font.
 * Shared between all terminal instances for consistency.
 *
 * Nerd-font symbol families come first so PUA icon codepoints (git branch,
 * language logos, powerline arrows, etc.) resolve regardless of the user's
 * chosen base font. Emoji families follow for prompt themes that mix in real
 * Unicode emoji. Generic monospace families remain the final text fallback.
 */
export const TERMINAL_FONT_FALLBACKS = [
  ...NERD_FONT_FALLBACK_FAMILIES,
  ...TERMINAL_EMOJI_FALLBACK_FAMILIES,
  '"Geist Mono"',
  '"SFMono-Regular"',
  "Consolas",
  '"Liberation Mono"',
  "Menlo",
  "monospace",
].join(", ");

/** Build a full CSS `font-family` value for terminal usage. */
export function buildTerminalFontFamily(userFont: string): string {
  return `"${userFont}", ${TERMINAL_FONT_FALLBACKS}`;
}
