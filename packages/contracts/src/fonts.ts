import * as Schema from "effect/Schema";

export const SystemFontSchema = Schema.Struct({
  family: Schema.String,
  category: Schema.Literals(["monospace", "sans-serif", "serif", "other"]),
});

export type SystemFont = typeof SystemFontSchema.Type;

export const SystemFontListSchema = Schema.Array(SystemFontSchema);
export type SystemFontList = typeof SystemFontListSchema.Type;

/**
 * Fallback font families appended after the user-selected terminal font.
 * Shared between all terminal instances for consistency.
 */
export const TERMINAL_FONT_FALLBACKS =
  '"GeistMono NFM", "Geist Mono", "SFMono-Regular", Consolas, "Liberation Mono", Menlo, monospace';

/** Build a full CSS `font-family` value for terminal usage. */
export function buildTerminalFontFamily(userFont: string): string {
  return `"${userFont}", ${TERMINAL_FONT_FALLBACKS}`;
}
