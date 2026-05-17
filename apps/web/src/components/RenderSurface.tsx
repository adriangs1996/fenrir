import { useEffect, useMemo, useRef, useState } from "react";
import {
  type EditorFontMetrics,
  type Frame,
  type InputModifiers,
  type ResolvedKeybindingsConfig,
  NERD_FONT_FALLBACK_FAMILIES,
} from "@fenrir/contracts";
import { useSettings } from "~/hooks/useSettings";
import { ensureNerdFontLoaded } from "~/lib/nerdFont";
import { resolveShortcutCommand } from "~/keybindings";
import { GLRenderer } from "./render/glRenderer";

/**
 * Identify keyboard chords that belong to the app's keybinding layer, not nvim.
 * These events must bubble past the canvas so the document-level handler in
 * `keybindings.ts` can pick them up.
 *
 * Exported for testing.
 */
export function isAppShortcut(
  e: Pick<KeyboardEvent, "key" | "metaKey" | "ctrlKey" | "shiftKey" | "altKey">,
  keybindings: ResolvedKeybindingsConfig,
  options?: {
    terminalOpen?: boolean;
  },
): boolean {
  // Alt is reserved for nvim. On macOS especially, Option modifies `event.key`
  // into dead keys / symbols; the editor translator handles that via `event.code`.
  if (e.altKey) return false;

  // Let Cmd+V reach nvim for user-configured paste mappings.
  if (e.metaKey && !e.ctrlKey && !e.shiftKey && e.key.toLowerCase() === "v") {
    return false;
  }

  return (
    resolveShortcutCommand(e, keybindings, {
      context: {
        terminalFocus: false,
        terminalOpen: options?.terminalOpen ?? false,
      },
    }) !== null
  );
}

interface RenderSurfaceProps {
  fps?: number;
  className?: string;
  style?: React.CSSProperties;
  keybindings: ResolvedKeybindingsConfig;
  terminalOpen?: boolean;
  /**
   * When true, canvas auto-focuses so keystrokes flow straight to nvim. The
   * surface stays mounted across tab toggles via `display:none`, so we focus
   * on every false→true transition rather than only on mount.
   */
  visible?: boolean;
  focusRequestId?: number;
}

const NERD_FONT_FALLBACK = [...NERD_FONT_FALLBACK_FAMILIES, "monospace"];

interface EditorFontPrefs {
  family: string;
  size: number;
  lineHeight: number;
  weight: number;
  ligatures: boolean;
}

function buildFontChain(prefs: EditorFontPrefs): string {
  const family = `"${prefs.family.replace(/"/g, "")}"`;
  return [family, ...NERD_FONT_FALLBACK].join(", ");
}

function measureEditorMetrics(prefs: EditorFontPrefs): EditorFontMetrics {
  const chain = buildFontChain(prefs);
  // `font` carries no weight or style — those are composed per-glyph by the
  // renderer so bold/italic variants don't collide with the user's base weight.
  const fontNoWeight = `${prefs.size}px ${chain}`;
  const probe = document.createElement("canvas");
  const ctx = probe.getContext("2d");
  if (!ctx) {
    return {
      width: Math.max(1, Math.round(prefs.size * 0.6)),
      height: Math.max(1, Math.round(prefs.size * prefs.lineHeight)),
      ascent: Math.round(prefs.size * 0.8),
      font: fontNoWeight,
      fontWeight: prefs.weight,
      ligatures: prefs.ligatures,
    };
  }
  // Measure with the actual weight applied — width can shift slightly between
  // weights even on monospace faces.
  ctx.font = `${prefs.weight} ${fontNoWeight}`;
  ctx.textBaseline = "alphabetic";
  const probeText = ctx.measureText("M");
  const advance = ctx.measureText("MMMMMMMMMM");
  // Never round the cell width down. Even a subpixel underestimate becomes
  // visible because the GL glyph atlas clips every glyph to one cell; Nerd
  // Font icons are the first ones to show right-edge shaving.
  const width = Math.max(1, Math.ceil(advance.width / 10));
  const height = Math.max(1, Math.round(prefs.size * prefs.lineHeight));
  const fAscent = probeText.fontBoundingBoxAscent;
  const fDescent = probeText.fontBoundingBoxDescent ?? 0;
  let ascent: number;
  if (typeof fAscent === "number" && fAscent > 0) {
    const padding = (height - (fAscent + fDescent)) / 2;
    ascent = Math.round(padding + fAscent);
  } else {
    ascent = Math.round(height * 0.78);
  }
  return {
    width,
    height,
    ascent,
    font: fontNoWeight,
    fontWeight: prefs.weight,
    ligatures: prefs.ligatures,
  };
}

export function RenderSurface({
  fps = 120,
  className,
  style,
  keybindings,
  terminalOpen = false,
  visible = true,
  focusRequestId = 0,
}: RenderSurfaceProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const rendererRef = useRef<GLRenderer | null>(null);
  const rafRef = useRef<number | null>(null);
  const compositeNeededRef = useRef(false);
  const keybindingsRef = useRef(keybindings);
  const terminalOpenRef = useRef(terminalOpen);
  const [bridgeMissing, setBridgeMissing] = useState(false);
  const [glError, setGlError] = useState<string | null>(null);

  const editorPrefs = useSettings(
    (s): EditorFontPrefs => ({
      family: s.editorFontFamily,
      size: s.editorFontSize,
      lineHeight: s.editorLineHeight,
      weight: s.editorFontWeight,
      ligatures: s.editorLigatures,
    }),
  );
  const editorPrefsKey = useMemo(
    () =>
      `${editorPrefs.family}|${editorPrefs.size}|${editorPrefs.lineHeight}|${editorPrefs.weight}|${editorPrefs.ligatures}`,
    [editorPrefs],
  );

  useEffect(() => {
    keybindingsRef.current = keybindings;
    terminalOpenRef.current = terminalOpen;
  }, [keybindings, terminalOpen]);

  // Initialise GL renderer once the canvas mounts.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    try {
      rendererRef.current = new GLRenderer(canvas);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error("[renderSurface] GL init failed:", err);
      setGlError(message);
      return;
    }
    return () => {
      rendererRef.current = null;
    };
  }, []);

  // Focus canvas whenever the surface becomes visible so keystrokes flow to
  // nvim without a click — covers initial mount with visible=true and every
  // tab switch back to the editor while the canvas stays mounted.
  useEffect(() => {
    if (!visible) return;
    canvasRef.current?.focus({ preventScroll: true });
  }, [visible, focusRequestId]);

  useEffect(() => {
    const bridge = window.desktopBridge;
    if (!bridge) return;
    let cancelled = false;
    const push = () => {
      if (cancelled) return;
      const metrics = measureEditorMetrics(editorPrefs);
      void bridge.setEditorFontMetrics(metrics);
    };
    // Push synchronous metrics first so the editor has *something* to render
    // with, then re-measure once the bundled nerd-font lands. Canvas
    // `measureText` returns slightly different metrics once icon glyphs from
    // the fallback face are available, so a second pass keeps cell sizing
    // consistent with the rendered glyphs.
    push();
    void ensureNerdFontLoaded().then(push);
    return () => {
      cancelled = true;
    };
  }, [editorPrefsKey, editorPrefs]);

  useEffect(() => {
    const bridge = window.desktopBridge;
    if (!bridge) {
      setBridgeMissing(true);
      return;
    }

    const off = bridge.onFrame((frame: Frame) => {
      const renderer = rendererRef.current;
      if (!renderer) return;
      applyFrame(renderer, frame);
      compositeNeededRef.current = true;
      if (rafRef.current === null) {
        rafRef.current = requestAnimationFrame(composite);
      }
    });

    void bridge.renderSetFps(fps);
    void bridge.renderStart();

    return () => {
      off();
      void bridge.renderStop();
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
    };
  }, [fps]);

  useEffect(() => {
    const bridge = window.desktopBridge;
    const container = containerRef.current;
    if (!bridge || !container) return;

    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) return;
      const { width, height } = entry.contentRect;
      const dpr = window.devicePixelRatio || 1;
      const w = Math.max(1, Math.floor(width));
      const h = Math.max(1, Math.floor(height));
      rendererRef.current?.resize(w, h, dpr);
      bridge.sendInput({ kind: "resize", w, h });
      compositeNeededRef.current = true;
      if (rafRef.current === null) {
        rafRef.current = requestAnimationFrame(composite);
      }
    });
    observer.observe(container);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    const bridge = window.desktopBridge;
    if (!canvas || !bridge) return;

    const mods = (e: KeyboardEvent | MouseEvent | WheelEvent): InputModifiers => ({
      ctrl: e.ctrlKey,
      alt: e.altKey,
      shift: e.shiftKey,
      meta: e.metaKey,
    });

    const onKeyDown = (e: KeyboardEvent) => {
      if (isAppShortcut(e, keybindingsRef.current, { terminalOpen: terminalOpenRef.current })) {
        return; // bubble to app keybinding layer
      }
      bridge.sendInput({
        kind: "key",
        type: "down",
        key: e.key,
        code: e.code,
        mods: mods(e),
      });
      e.preventDefault();
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (isAppShortcut(e, keybindingsRef.current, { terminalOpen: terminalOpenRef.current })) {
        return;
      }
      bridge.sendInput({
        kind: "key",
        type: "up",
        key: e.key,
        code: e.code,
        mods: mods(e),
      });
    };

    const localXY = (e: MouseEvent) => {
      const rect = canvas.getBoundingClientRect();
      return { x: e.clientX - rect.left, y: e.clientY - rect.top };
    };
    const buttonOf = (n: number): 0 | 1 | 2 => (n === 1 ? 1 : n === 2 ? 2 : 0);

    const onMouseDown = (e: MouseEvent) => {
      canvas.focus();
      const { x, y } = localXY(e);
      bridge.sendInput({
        kind: "mouse",
        type: "down",
        x,
        y,
        button: buttonOf(e.button),
        mods: mods(e),
      });
    };
    const onMouseUp = (e: MouseEvent) => {
      const { x, y } = localXY(e);
      bridge.sendInput({
        kind: "mouse",
        type: "up",
        x,
        y,
        button: buttonOf(e.button),
        mods: mods(e),
      });
    };
    const onMouseMove = (e: MouseEvent) => {
      const { x, y } = localXY(e);
      bridge.sendInput({ kind: "mouse", type: "move", x, y, mods: mods(e) });
    };
    const onWheel = (e: WheelEvent) => {
      const { x, y } = localXY(e);
      bridge.sendInput({
        kind: "mouse",
        type: "wheel",
        x,
        y,
        deltaX: e.deltaX,
        deltaY: e.deltaY,
        mods: mods(e),
      });
      e.preventDefault();
    };

    canvas.addEventListener("keydown", onKeyDown);
    canvas.addEventListener("keyup", onKeyUp);
    canvas.addEventListener("mousedown", onMouseDown);
    canvas.addEventListener("mouseup", onMouseUp);
    canvas.addEventListener("mousemove", onMouseMove);
    canvas.addEventListener("wheel", onWheel, { passive: false });
    return () => {
      canvas.removeEventListener("keydown", onKeyDown);
      canvas.removeEventListener("keyup", onKeyUp);
      canvas.removeEventListener("mousedown", onMouseDown);
      canvas.removeEventListener("mouseup", onMouseUp);
      canvas.removeEventListener("mousemove", onMouseMove);
      canvas.removeEventListener("wheel", onWheel);
    };
  }, []);

  const composite = () => {
    rafRef.current = null;
    if (!compositeNeededRef.current) return;
    compositeNeededRef.current = false;
    rendererRef.current?.composite();
  };

  if (bridgeMissing) {
    return (
      <div className={className} style={style}>
        <p>Render bridge unavailable (web mode).</p>
      </div>
    );
  }

  if (glError) {
    return (
      <div className={className} style={style}>
        <p>WebGL2 unavailable: {glError}</p>
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      className={className}
      style={{ width: "100%", height: "100%", ...style }}
    >
      <canvas
        ref={canvasRef}
        tabIndex={0}
        style={{ display: "block", outline: "none", background: "#000" }}
      />
    </div>
  );
}

export function applyFrame(renderer: GLRenderer, frame: Frame): void {
  if (frame.cellMetrics) renderer.setCellMetrics(frame.cellMetrics);
  if (frame.hl) renderer.upsertHl(frame.hl);
  if (frame.defaultColors) renderer.setDefaultColors(frame.defaultColors);
  if (frame.resizedGrids) {
    for (const r of frame.resizedGrids) renderer.ensureGrid(r.id, r.w, r.h);
  }
  if (frame.closedGrids) {
    for (const id of frame.closedGrids) renderer.removeGrid(id);
  }
  if (frame.gridDeltas) {
    for (const delta of frame.gridDeltas) {
      renderer.updateRows(
        delta.gridId,
        delta.rowIndexes,
        delta.cols,
        delta.cellChars,
        delta.cellHl,
      );
    }
  }
  if (frame.windows) renderer.setWindows(frame.windows);
  if (frame.cursor) renderer.setCursor(frame.cursor);
}
