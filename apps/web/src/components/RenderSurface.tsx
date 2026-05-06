import { useEffect, useMemo, useRef, useState } from "react";
import type {
  CellMetrics,
  CursorEntry,
  DefaultColorsEntry,
  EditorFontMetrics,
  Frame,
  HlAttrEntry,
  InputModifiers,
  WindowEntry,
} from "@fenrir/contracts";
import { useSettings } from "~/hooks/useSettings";

interface RenderSurfaceProps {
  fps?: number;
  className?: string;
  style?: React.CSSProperties;
}

const NERD_FONT_FALLBACK = [
  '"Symbols Nerd Font Mono"',
  '"Symbols Nerd Font"',
  '"GeistMono Nerd Font"',
  "monospace",
];

interface EditorFontPrefs {
  family: string;
  size: number;
  lineHeight: number;
  weight: number;
  ligatures: boolean;
}

function buildFontCss(prefs: EditorFontPrefs): string {
  const family = `"${prefs.family.replace(/"/g, "")}"`;
  const chain = [family, ...NERD_FONT_FALLBACK].join(", ");
  return `${prefs.weight} ${prefs.size}px ${chain}`;
}

function measureEditorMetrics(prefs: EditorFontPrefs): EditorFontMetrics {
  const fontCss = buildFontCss(prefs);
  const probe = document.createElement("canvas");
  const ctx = probe.getContext("2d");
  if (!ctx) {
    return {
      width: Math.max(1, Math.round(prefs.size * 0.6)),
      height: Math.max(1, Math.round(prefs.size * prefs.lineHeight)),
      ascent: Math.round(prefs.size * 0.8),
      font: fontCss,
      ligatures: prefs.ligatures,
    };
  }
  ctx.font = fontCss;
  ctx.textBaseline = "alphabetic";
  const probeText = ctx.measureText("M");
  const advance = ctx.measureText("MMMMMMMMMM");
  const width = Math.max(1, Math.round(advance.width / 10));
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
  return { width, height, ascent, font: fontCss, ligatures: prefs.ligatures };
}

interface GridCanvas {
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  cols: number;
  rows: number;
}

interface SurfaceState {
  metrics: CellMetrics | null;
  hl: Map<number, HlAttrEntry>;
  defaultColors: DefaultColorsEntry;
  grids: Map<number, GridCanvas>;
  windows: WindowEntry[];
  cursor: CursorEntry | null;
  atlas: GlyphAtlas | null;
  dpr: number;
}

const ATLAS_COLS = 64;
const ATLAS_ROWS = 64;

class GlyphAtlas {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private map = new Map<string, { ax: number; ay: number }>();
  private nextAx = 0;
  private nextAy = 0;
  private overflow = false;

  constructor(
    private readonly metrics: CellMetrics,
    private readonly dpr: number,
  ) {
    this.canvas = document.createElement("canvas");
    this.canvas.width = ATLAS_COLS * metrics.width * dpr;
    this.canvas.height = ATLAS_ROWS * metrics.height * dpr;
    const ctx = this.canvas.getContext("2d");
    if (!ctx) throw new Error("atlas context failed");
    this.ctx = ctx;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.textBaseline = "alphabetic";
  }

  ensure(
    ch: string,
    hlId: number,
    hl: HlAttrEntry | undefined,
    defaultColors: DefaultColorsEntry,
  ): { ax: number; ay: number } | null {
    if (this.overflow) return null;
    const key = `${hlId}|${ch}`;
    const cached = this.map.get(key);
    if (cached) return cached;
    if (this.nextAy >= ATLAS_ROWS) {
      console.warn("[glyphAtlas] full, falling back to fillText");
      this.overflow = true;
      return null;
    }
    const ax = this.nextAx;
    const ay = this.nextAy;
    this.nextAx += 1;
    if (this.nextAx >= ATLAS_COLS) {
      this.nextAx = 0;
      this.nextAy += 1;
    }

    const fgN = (hl?.reverse ? hl?.bg : hl?.fg) ?? defaultColors.fg;
    const fontParts: string[] = [];
    if (hl?.italic) fontParts.push("italic");
    if (hl?.bold) fontParts.push("bold");
    fontParts.push(this.metrics.font);

    const m = this.metrics;
    this.ctx.save();
    this.ctx.clearRect(ax * m.width, ay * m.height, m.width, m.height);
    this.ctx.font = fontParts.join(" ");
    this.ctx.fillStyle = colorToCss(fgN);
    this.ctx.fillText(ch, ax * m.width, ay * m.height + m.ascent);
    this.ctx.restore();

    const pos = { ax, ay };
    this.map.set(key, pos);
    return pos;
  }

  blit(
    dst: CanvasRenderingContext2D,
    pos: { ax: number; ay: number },
    dx: number,
    dy: number,
  ): void {
    const m = this.metrics;
    const sx = pos.ax * m.width * this.dpr;
    const sy = pos.ay * m.height * this.dpr;
    const sw = m.width * this.dpr;
    const sh = m.height * this.dpr;
    dst.drawImage(this.canvas, sx, sy, sw, sh, dx, dy, m.width, m.height);
  }
}

export function RenderSurface({ fps = 120, className, style }: RenderSurfaceProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const stateRef = useRef<SurfaceState>({
    metrics: null,
    hl: new Map(),
    defaultColors: { fg: 0xe8e8ea, bg: 0x0e0f13, sp: 0xff453a },
    grids: new Map(),
    windows: [],
    cursor: null,
    atlas: null,
    dpr: typeof window === "undefined" ? 1 : window.devicePixelRatio || 1,
  });
  const rafRef = useRef<number | null>(null);
  const compositeNeededRef = useRef(false);
  const profileRef = useRef({
    start: performance.now(),
    frames: 0,
    paintMs: 0,
    rows: 0,
    runs: 0,
    glyphs: 0,
  });
  const [bridgeMissing, setBridgeMissing] = useState(false);

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
    const bridge = window.desktopBridge;
    if (!bridge) return;
    const metrics = measureEditorMetrics(editorPrefs);
    void bridge.setEditorFontMetrics(metrics);
  }, [editorPrefsKey, editorPrefs]);

  useEffect(() => {
    const bridge = window.desktopBridge;
    if (!bridge) {
      setBridgeMissing(true);
      return;
    }

    const off = bridge.onFrame((frame) => {
      applyFrame(stateRef.current, frame, profileRef.current);
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
      stateRef.current.dpr = dpr;
      const w = Math.max(1, Math.floor(width));
      const h = Math.max(1, Math.floor(height));
      const canvas = canvasRef.current;
      if (canvas) {
        canvas.width = Math.floor(w * dpr);
        canvas.height = Math.floor(h * dpr);
        canvas.style.width = `${w}px`;
        canvas.style.height = `${h}px`;
      }
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
    const canvas = canvasRef.current;
    const state = stateRef.current;
    if (!canvas || !state.metrics) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const t0 = performance.now();
    const dpr = state.dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const cssW = canvas.width / dpr;
    const cssH = canvas.height / dpr;

    ctx.fillStyle = colorToCss(state.defaultColors.bg);
    ctx.fillRect(0, 0, cssW, cssH);

    const m = state.metrics;
    const visible = state.windows.filter((w) => !w.hidden);
    visible.sort((a, b) => a.zIndex - b.zIndex);
    for (const win of visible) {
      const grid = state.grids.get(win.gridId);
      if (!grid) continue;
      const dx = win.col * m.width;
      const dy = win.row * m.height;
      ctx.drawImage(
        grid.canvas,
        0,
        0,
        grid.canvas.width,
        grid.canvas.height,
        dx,
        dy,
        grid.cols * m.width,
        grid.rows * m.height,
      );
    }

    if (state.cursor) {
      paintCursor(ctx, state, state.cursor);
    }

    const t1 = performance.now();
    const p = profileRef.current;
    p.frames += 1;
    p.paintMs += t1 - t0;
    if (t1 - p.start >= 1000) {
      console.log(
        `[renderSurface] ${(t1 - p.start).toFixed(0)}ms frames=${p.frames}` +
          ` rows=${p.rows} runs=${p.runs} glyphs=${p.glyphs}` +
          ` paint=${p.paintMs.toFixed(2)}ms`,
      );
      p.start = t1;
      p.frames = 0;
      p.paintMs = 0;
      p.rows = 0;
      p.runs = 0;
      p.glyphs = 0;
    }
  };

  if (bridgeMissing) {
    return (
      <div className={className} style={style}>
        <p>Render bridge unavailable (web mode).</p>
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

function applyFrame(
  state: SurfaceState,
  frame: Frame,
  profile: { rows: number; runs: number; glyphs: number },
): void {
  if (frame.cellMetrics) {
    state.metrics = frame.cellMetrics;
    state.atlas = new GlyphAtlas(frame.cellMetrics, state.dpr);
    state.grids.clear();
  }
  if (frame.hl) {
    for (const entry of frame.hl) {
      state.hl.set(entry.id, entry);
    }
  }
  if (frame.defaultColors) {
    state.defaultColors = frame.defaultColors;
  }
  if (frame.resizedGrids) {
    for (const r of frame.resizedGrids) {
      ensureGrid(state, r.id, r.w, r.h);
    }
  }
  if (frame.closedGrids) {
    for (const id of frame.closedGrids) state.grids.delete(id);
  }
  if (frame.gridDeltas && state.metrics && state.atlas) {
    for (const delta of frame.gridDeltas) {
      const grid = state.grids.get(delta.gridId);
      if (!grid) continue;
      profile.rows += delta.rows.length;
      for (const row of delta.rows) {
        paintRow(state, grid, row.row, row.runs, profile);
      }
    }
  }
  if (frame.windows) {
    state.windows = frame.windows;
  }
  if (frame.cursor) {
    state.cursor = frame.cursor;
  }
}

function ensureGrid(state: SurfaceState, id: number, cols: number, rows: number): void {
  if (!state.metrics) return;
  const m = state.metrics;
  const dpr = state.dpr;
  const existing = state.grids.get(id);
  if (existing && existing.cols === cols && existing.rows === rows) return;
  const canvas = document.createElement("canvas");
  canvas.width = cols * m.width * dpr;
  canvas.height = rows * m.height * dpr;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.fillStyle = colorToCss(state.defaultColors.bg);
  ctx.fillRect(0, 0, cols * m.width, rows * m.height);
  state.grids.set(id, { canvas, ctx, cols, rows });
}

function paintRow(
  state: SurfaceState,
  grid: GridCanvas,
  rowIdx: number,
  runs: { col: number; len: number; text: string; hlId: number }[],
  profile: { runs: number; glyphs: number },
): void {
  if (!state.metrics || !state.atlas) return;
  const m = state.metrics;
  const ctx = grid.ctx;
  const y = rowIdx * m.height;
  ctx.fillStyle = colorToCss(state.defaultColors.bg);
  ctx.fillRect(0, y, grid.cols * m.width, m.height);

  for (const run of runs) {
    profile.runs += 1;
    const hl = state.hl.get(run.hlId);
    const bgN = (hl?.reverse ? hl?.fg : hl?.bg) ?? state.defaultColors.bg;
    if (bgN !== state.defaultColors.bg) {
      ctx.fillStyle = colorToCss(bgN);
      ctx.fillRect(run.col * m.width, y, run.len * m.width, m.height);
    }
    if (m.ligatures) {
      // Ligatures require multi-char shaping. Atlas can't represent that, so
      // paint the run as a single fillText and skip the per-glyph blit.
      if (run.text.trim().length > 0) {
        const fgN = (hl?.reverse ? hl?.bg : hl?.fg) ?? state.defaultColors.fg;
        const parts: string[] = [];
        if (hl?.italic) parts.push("italic");
        if (hl?.bold) parts.push("bold");
        parts.push(m.font);
        ctx.font = parts.join(" ");
        ctx.fillStyle = colorToCss(fgN);
        ctx.textBaseline = "alphabetic";
        ctx.fillText(run.text, run.col * m.width, y + m.ascent);
        profile.glyphs += run.text.length;
      }
    } else {
      let visualCol = run.col;
      for (const ch of run.text) {
        if (ch !== " ") {
          const pos = state.atlas.ensure(ch, run.hlId, hl, state.defaultColors);
          const dx = visualCol * m.width;
          if (pos) {
            state.atlas.blit(ctx, pos, dx, y);
          } else {
            const fgN = (hl?.reverse ? hl?.bg : hl?.fg) ?? state.defaultColors.fg;
            const parts: string[] = [];
            if (hl?.italic) parts.push("italic");
            if (hl?.bold) parts.push("bold");
            parts.push(m.font);
            ctx.font = parts.join(" ");
            ctx.fillStyle = colorToCss(fgN);
            ctx.textBaseline = "alphabetic";
            ctx.fillText(ch, dx, y + m.ascent);
          }
          profile.glyphs += 1;
        }
        visualCol += 1;
      }
    }
  }
}

function paintCursor(
  ctx: CanvasRenderingContext2D,
  state: SurfaceState,
  cursor: CursorEntry,
): void {
  if (!state.metrics) return;
  const m = state.metrics;
  const win = state.windows.find((w) => w.gridId === cursor.gridId);
  if (!win) return;
  const baseX = (win.col + cursor.col) * m.width;
  const baseY = (win.row + cursor.row) * m.height;
  ctx.fillStyle = colorToCss(state.defaultColors.fg);
  if (cursor.shape === "vertical") {
    ctx.fillRect(baseX, baseY, 2, m.height);
  } else if (cursor.shape === "horizontal") {
    ctx.fillRect(baseX, baseY + m.height - 2, m.width, 2);
  } else {
    ctx.fillRect(baseX, baseY, m.width, m.height);
    if (cursor.text) {
      ctx.fillStyle = colorToCss(state.defaultColors.bg);
      ctx.font = m.font;
      ctx.textBaseline = "alphabetic";
      ctx.fillText(cursor.text, baseX, baseY + m.ascent);
    }
  }
}

function colorToCss(n: number): string {
  if (typeof n !== "number" || n < 0) return "#000000";
  return "#" + (n & 0xffffff).toString(16).padStart(6, "0");
}
