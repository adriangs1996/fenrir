/**
 * Bundled nerd-font loader.
 *
 * The terminal (xterm.js canvas/webgl renderer) and the neovim canvas
 * renderer measure cell width once at mount time. If our bundled
 * `Symbols Nerd Font Mono` face isn't decoded yet, the renderer measures
 * with a fallback face and PUA icon glyphs render as boxes.
 *
 * `document.fonts.load()` returns a promise that resolves once the face is
 * ready. Callers can `await ensureNerdFontLoaded()` then re-fit / re-measure
 * to upgrade glyph rendering once the font is available.
 *
 * The `@font-face` declaration lives in `apps/web/src/index.css`; the family
 * name must stay in sync with `NERD_FONT_FALLBACK_FAMILIES` in
 * `packages/contracts/src/fonts.ts`.
 */

const NERD_FONT_FAMILY = '"Symbols Nerd Font Mono"';
// Probe character: U+E0A0 is the Powerline branch glyph — present in any
// Symbols Nerd Font release. Loading at a representative size primes the
// browser's font cache for terminal/editor use.
const PROBE_SPEC = `16px ${NERD_FONT_FAMILY}`;

let cachedPromise: Promise<void> | null = null;

export function ensureNerdFontLoaded(): Promise<void> {
  if (cachedPromise) return cachedPromise;
  if (typeof document === "undefined" || !document.fonts?.load) {
    cachedPromise = Promise.resolve();
    return cachedPromise;
  }
  cachedPromise = document.fonts
    .load(PROBE_SPEC)
    .then(() => undefined)
    .catch(() => undefined);
  return cachedPromise;
}
