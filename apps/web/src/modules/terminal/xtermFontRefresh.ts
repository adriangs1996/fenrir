import type { FitAddon } from "@xterm/addon-fit";
import type { Terminal } from "@xterm/xterm";

interface TerminalInternalCore {
  _charSizeService?: {
    measure?: () => void;
  };
  _renderService?: {
    clear?: () => void;
    handleCharSizeChanged?: () => void;
  };
}

interface InternalTerminal extends Terminal {
  _core?: TerminalInternalCore;
}

interface TextureAtlasRefreshTarget {
  clearTextureAtlas?: () => void;
}

function preserveBottomScroll(terminal: Terminal, refresh: () => void): void {
  const wasAtBottom = terminal.buffer.active.viewportY >= terminal.buffer.active.baseY;
  refresh();
  if (wasAtBottom) {
    terminal.scrollToBottom();
  }
}

/**
 * xterm's public API lacks a "font metrics changed, please re-measure now"
 * hook. In the packaged Electron app the DOM renderer can measure before the
 * final font face is ready, which leaves glyphs clipped until the next real
 * metrics pass. Reach into xterm internals and force that pass explicitly.
 */
export function refreshTerminalFontMetrics(
  terminal: Terminal,
  fitAddon: Pick<FitAddon, "fit"> | null | undefined,
  textureAtlasTarget?: TextureAtlasRefreshTarget | null,
): void {
  const internalTerminal = terminal as InternalTerminal;

  preserveBottomScroll(terminal, () => {
    try {
      internalTerminal._core?._charSizeService?.measure?.();
      internalTerminal._core?._renderService?.handleCharSizeChanged?.();
      internalTerminal._core?._renderService?.clear?.();
      textureAtlasTarget?.clearTextureAtlas?.();
      terminal.clearTextureAtlas?.();
      fitAddon?.fit();
      terminal.refresh(0, Math.max(terminal.rows - 1, 0));
    } catch {
      // xterm re-measure/fit can throw during layout transitions
    }
  });
}

export function observeTerminalFontMetrics(
  terminal: Terminal,
  fitAddon: Pick<FitAddon, "fit"> | null | undefined,
  textureAtlasTarget?: TextureAtlasRefreshTarget | null,
): () => void {
  if (typeof window === "undefined") {
    return () => undefined;
  }

  let disposed = false;
  const refresh = () => {
    if (!disposed) {
      refreshTerminalFontMetrics(terminal, fitAddon, textureAtlasTarget);
    }
  };

  const timeouts = [
    window.setTimeout(refresh, 0),
    window.setTimeout(refresh, 120),
    window.setTimeout(refresh, 500),
  ];

  const fontFaceSet = typeof document === "undefined" ? null : document.fonts;
  const handleLoadingDone = () => refresh();
  const handleLoadingError = () => refresh();

  if (fontFaceSet?.addEventListener) {
    fontFaceSet.addEventListener("loadingdone", handleLoadingDone);
    fontFaceSet.addEventListener("loadingerror", handleLoadingError);
  }

  void fontFaceSet?.ready.then(() => {
    refresh();
  });

  return () => {
    disposed = true;
    for (const timeout of timeouts) {
      window.clearTimeout(timeout);
    }
    if (fontFaceSet?.removeEventListener) {
      fontFaceSet.removeEventListener("loadingdone", handleLoadingDone);
      fontFaceSet.removeEventListener("loadingerror", handleLoadingError);
    }
  };
}
