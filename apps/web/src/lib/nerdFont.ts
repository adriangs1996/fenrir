/**
 * Bundled nerd-font loader.
 *
 * The terminal (xterm.js canvas/webgl renderer) and the neovim canvas
 * renderer measure cell width once at mount time. If our bundled
 * `Symbols Nerd Font Mono` face isn't decoded yet, the renderer measures
 * with a fallback face and PUA icon glyphs render as boxes.
 *
 * The face is registered programmatically via the `FontFace` API instead of
 * a CSS `@font-face` rule. A CSS rule only exists once the stylesheet is
 * parsed; in the packaged desktop app the `<link>` stylesheet can land after
 * this module evaluates, and `document.fonts.load()` silently no-ops when no
 * face matches (and `document.fonts.check()` returns true for an unknown
 * family). Canvas renderers never trigger CSS font loading on their own, so
 * the face would stay unloaded forever and icons would never appear.
 * Registering the face here removes that race entirely.
 *
 * The family name must stay in sync with `NERD_FONT_FALLBACK_FAMILIES` in
 * `packages/contracts/src/fonts.ts`.
 */

import nerdFontUrl from "../assets/fonts/SymbolsNerdFontMono-Regular.ttf";

const NERD_FONT_FAMILY = "Symbols Nerd Font Mono";
const NERD_FONT_LOG_SCOPE = "[nerd-font]";

let registeredFace: FontFace | null = null;
let cachedPromise: Promise<boolean> | null = null;
let loadFailureWarningEmitted = false;

function warnNerdFontLoadFailure(message: string, error?: unknown): void {
  if (loadFailureWarningEmitted) {
    return;
  }
  loadFailureWarningEmitted = true;
  console.warn(`${NERD_FONT_LOG_SCOPE} ${message}`, error ?? "");
}

function registerNerdFontFace(): FontFace | null {
  if (registeredFace) {
    return registeredFace;
  }
  if (typeof document === "undefined" || typeof FontFace === "undefined" || !document.fonts?.add) {
    return null;
  }
  registeredFace = new FontFace(NERD_FONT_FAMILY, `url("${nerdFontUrl}") format("truetype")`, {
    style: "normal",
    weight: "normal",
    display: "swap",
  });
  document.fonts.add(registeredFace);
  return registeredFace;
}

export function isNerdFontLoaded(): boolean {
  const face = registerNerdFontFace();
  // Non-browser environments (tests, SSR) have no fonts to wait for.
  if (!face) {
    return true;
  }
  return face.status === "loaded";
}

export function ensureNerdFontLoaded(): Promise<boolean> {
  if (cachedPromise) return cachedPromise;
  const face = registerNerdFontFace();
  if (!face) {
    cachedPromise = Promise.resolve(true);
    return cachedPromise;
  }
  cachedPromise = face
    .load()
    .then(() => {
      const loaded = face.status === "loaded";
      if (!loaded) {
        warnNerdFontLoadFailure(
          "Bundled Symbols Nerd Font Mono did not report as loaded after FontFace.load().",
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
