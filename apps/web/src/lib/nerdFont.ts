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
const NERD_FONT_LOG_SCOPE = "[nerd-font]";
// Probe character: U+E0A0 is the Powerline branch glyph — present in any
// Symbols Nerd Font release. Loading at a representative size primes the
// browser's font cache for terminal/editor use.
const PROBE_TEXT = "\uE0A0";
const PROBE_SPEC = `16px ${NERD_FONT_FAMILY}`;

let cachedPromise: Promise<boolean> | null = null;
let loadFailureWarningEmitted = false;

function warnNerdFontLoadFailure(message: string, error?: unknown): void {
  if (loadFailureWarningEmitted) {
    return;
  }
  loadFailureWarningEmitted = true;
  console.warn(`${NERD_FONT_LOG_SCOPE} ${message}`, error ?? "");
}

export function isNerdFontLoaded(): boolean {
  if (typeof document === "undefined" || !document.fonts?.check) {
    return true;
  }
  return document.fonts.check(PROBE_SPEC, PROBE_TEXT);
}

export function ensureNerdFontLoaded(): Promise<boolean> {
  if (cachedPromise) return cachedPromise;
  if (typeof document === "undefined" || !document.fonts?.load) {
    cachedPromise = Promise.resolve(true);
    return cachedPromise;
  }
  cachedPromise = document.fonts
    .load(PROBE_SPEC, PROBE_TEXT)
    .then(() => {
      const loaded = isNerdFontLoaded();
      if (!loaded) {
        warnNerdFontLoadFailure(
          "Bundled Symbols Nerd Font Mono did not report as loaded after document.fonts.load().",
        );
      }
      return loaded;
    })
    .catch((error) => {
      warnNerdFontLoadFailure("Failed to load bundled Symbols Nerd Font Mono.", error);
      return false;
    });
  return cachedPromise;
}

export function waitForNerdFontLoad(timeoutMs = 1500): Promise<boolean> {
  if (isNerdFontLoaded()) {
    return Promise.resolve(true);
  }

  return new Promise((resolve) => {
    const timer = window.setTimeout(() => {
      resolve(isNerdFontLoaded());
    }, timeoutMs);

    void ensureNerdFontLoaded().then((loaded) => {
      window.clearTimeout(timer);
      resolve(loaded);
    });
  });
}
