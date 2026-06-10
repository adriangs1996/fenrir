export const TERMINAL_FONT_PROBE_TEXT = "\u03bb\ue0a0\ue0b6\ue0b4\u2718\u276f +2018-16395 t3code";

const DEFAULT_TERMINAL_FONT_LOAD_TIMEOUT_MS = 1500;

interface TerminalFontLoadOptions {
  readonly fontFamily: string;
  readonly fontSize: number;
  readonly fontWeight: string | number;
  readonly timeoutMs?: number;
}

function fontFaceSet(): FontFaceSet | null {
  if (typeof document === "undefined") {
    return null;
  }
  return document.fonts ?? null;
}

export function buildTerminalFontLoadSpec({
  fontFamily,
  fontSize,
  fontWeight,
}: TerminalFontLoadOptions): string {
  return `normal ${String(fontWeight)} ${String(fontSize)}px ${fontFamily}`;
}

export function isTerminalFontLoaded(options: TerminalFontLoadOptions): boolean {
  const fonts = fontFaceSet();
  if (!fonts?.check) {
    return true;
  }
  return fonts.check(buildTerminalFontLoadSpec(options), TERMINAL_FONT_PROBE_TEXT);
}

export async function ensureTerminalFontLoaded(options: TerminalFontLoadOptions): Promise<boolean> {
  const fonts = fontFaceSet();
  if (!fonts?.load) {
    return true;
  }

  try {
    await fonts.load(buildTerminalFontLoadSpec(options), TERMINAL_FONT_PROBE_TEXT);
    return isTerminalFontLoaded(options);
  } catch (error) {
    console.warn("[terminal-font] Failed to load configured terminal font stack.", error);
    return false;
  }
}

export function waitForTerminalFontLoad(options: TerminalFontLoadOptions): Promise<boolean> {
  if (isTerminalFontLoaded(options)) {
    return Promise.resolve(true);
  }

  const timeoutMs = options.timeoutMs ?? DEFAULT_TERMINAL_FONT_LOAD_TIMEOUT_MS;
  return new Promise((resolve) => {
    const timer = globalThis.setTimeout(() => {
      resolve(isTerminalFontLoaded(options));
    }, timeoutMs);

    void ensureTerminalFontLoaded(options).then((loaded) => {
      globalThis.clearTimeout(timer);
      resolve(loaded || isTerminalFontLoaded(options));
    });
  });
}
