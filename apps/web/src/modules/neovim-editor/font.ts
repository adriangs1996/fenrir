/**
 * Single source of truth for the editor font and its measured cell metrics.
 *
 * Hardcoded family + size to keep this layer minimal. `:set guifont=...` from
 * inside Neovim is intentionally not honoured yet — it's the next layer up.
 */

export const FONT_SIZE = 14;
export const FONT_FAMILY = `ui-monospace, SFMono-Regular, Menlo, Consolas, "Liberation Mono", monospace`;
export const FONT = `${FONT_SIZE}px ${FONT_FAMILY}`;

export interface CellMetrics {
  /** Width of one cell in CSS pixels. */
  width: number;
  /** Height of one cell in CSS pixels. */
  height: number;
  /** Vertical offset from cell top to the font's text baseline. */
  baseline: number;
}

let cached: CellMetrics | null = null;

/**
 * Measure cell metrics from an offscreen 2D context. Cached across calls;
 * fonts are assumed not to change at runtime.
 */
export function measureCell(): CellMetrics {
  if (cached) return cached;

  if (typeof document === "undefined") {
    // SSR / Node test fallback so unit tests can import this module.
    cached = {
      width: Math.round(FONT_SIZE * 0.6),
      height: Math.round(FONT_SIZE * 1.3),
      baseline: Math.round(FONT_SIZE * 1.0),
    };
    return cached;
  }

  const c = document.createElement("canvas");
  const ctx = c.getContext("2d");
  if (!ctx) {
    cached = {
      width: Math.round(FONT_SIZE * 0.6),
      height: Math.round(FONT_SIZE * 1.3),
      baseline: Math.round(FONT_SIZE * 1.0),
    };
    return cached;
  }

  ctx.font = FONT;
  ctx.textBaseline = "top";
  const m = ctx.measureText("M");
  // `actualBoundingBox*` are widely supported (Chrome 77+, Safari 11.1+, FF 74+).
  // Fall back to fontBoundingBox or font size if missing.
  const ascent =
    m.actualBoundingBoxAscent ?? (m as TextMetrics).fontBoundingBoxAscent ?? FONT_SIZE * 0.8;
  const descent =
    m.actualBoundingBoxDescent ?? (m as TextMetrics).fontBoundingBoxDescent ?? FONT_SIZE * 0.2;

  const width = Math.max(1, Math.round(m.width));
  // Add a small linespace (~10%) so descenders + cursor block don't touch.
  const height = Math.max(1, Math.round((ascent + descent) * 1.1));
  const baseline = Math.round(ascent * 1.05);

  cached = { width, height, baseline };
  return cached;
}

/** Test-only hook to reset memoisation. Kept tiny on purpose. */
export function _resetCellMetricsForTests(): void {
  cached = null;
}
