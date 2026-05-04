import { useEffect, useRef, useState } from "react";
import { FONT, type CellMetrics } from "../font";
import {
  parseRedrawBatch,
  type HlAttr,
  type ModeInfo,
  type RedrawEvent,
} from "../protocol/RedrawParser";

/**
 * Single-grid Neovim bridge + Canvas2D renderer.
 *
 * Architecture (deliberately flat — readability beats reuse here):
 *   - state in refs, not React state, so redraw events don't trigger re-renders
 *   - one full repaint on every `flush`, scheduled via rAF (or microtask
 *     fallback for environments that throttle rAF when occluded)
 *   - canvas is sized in *device pixels* (cssSize × DPR) and ctx.scale'd
 *     so 1 unit ≈ 1 CSS px throughout the draw code
 */

export interface NeovimHandle {
  input: (keys: string) => void;
  uiTryResize: (cols: number, rows: number) => void;
}

interface DesktopBridge {
  neovimAttach: (cwd: string, cols: number, rows: number) => Promise<void>;
  neovimDetach: () => Promise<void>;
  neovimInput: (keys: string) => Promise<void>;
  neovimResize: (cols: number, rows: number) => Promise<void>;
  onNeovimRedraw: (listener: (events: unknown[]) => void) => () => void;
}

function getDesktopBridge(): DesktopBridge | undefined {
  return (globalThis as { desktopBridge?: DesktopBridge }).desktopBridge;
}

interface GridState {
  width: number;
  height: number;
  cells: string[][]; // [row][col] → glyph (empty string = wide-char continuation)
  hlIds: number[][];
}

function makeGrid(width: number, height: number): GridState {
  return {
    width,
    height,
    cells: Array.from({ length: height }, () => Array.from<string>({ length: width }).fill(" ")),
    hlIds: Array.from({ length: height }, () => Array.from<number>({ length: width }).fill(0)),
  };
}

function resizeGrid(g: GridState, width: number, height: number): void {
  // Preserve content in the overlap region. Spec doesn't require clearing
  // (and neovide doesn't either: src/editor/grid.rs:38-47).
  const oldRows = g.cells.length;
  if (height < oldRows) {
    g.cells.length = height;
    g.hlIds.length = height;
  } else {
    for (let r = oldRows; r < height; r++) {
      g.cells.push(Array.from<string>({ length: width }).fill(" "));
      g.hlIds.push(Array.from<number>({ length: width }).fill(0));
    }
  }
  for (let r = 0; r < height; r++) {
    const row = g.cells[r]!;
    const hls = g.hlIds[r]!;
    if (row.length < width) {
      const grow = width - row.length;
      for (let i = 0; i < grow; i++) {
        row.push(" ");
        hls.push(0);
      }
    } else if (row.length > width) {
      row.length = width;
      hls.length = width;
    }
  }
  g.width = width;
  g.height = height;
}

function rgbToHex(rgb: number, fallback: string): string {
  if (!Number.isFinite(rgb) || rgb < 0) return fallback;
  return `#${rgb.toString(16).padStart(6, "0")}`;
}

export function useNeovim(
  cwd: string,
  cols: number,
  rows: number,
  cell: CellMetrics,
  canvasRef: React.RefObject<HTMLCanvasElement | null>,
): NeovimHandle | null {
  const [handle, setHandle] = useState<NeovimHandle | null>(null);

  // Persistent state across redraw events
  const gridRef = useRef<GridState>(makeGrid(cols || 1, rows || 1));
  const hlRef = useRef<Map<number, HlAttr>>(new Map());
  const fgRef = useRef("#cdd6f4");
  const bgRef = useRef("#1e1e2e");
  const spRef = useRef("#f38ba8");
  const cursorRef = useRef({ row: 0, col: 0 });
  const modeListRef = useRef<ModeInfo[]>([]);
  const modeIdxRef = useRef(0);
  const drawScheduledRef = useRef(false);

  // Track latest cell metrics for the paint loop without re-running the
  // attach effect when the font is remeasured (it shouldn't change in
  // practice, but bind safely all the same).
  const cellRef = useRef(cell);
  cellRef.current = cell;

  // Capture the dimensions present at first attach. The component may render
  // with cols=0/rows=0 before the ResizeObserver fires; we want to wait for
  // a real measurement before issuing `nvim_ui_attach`.
  const initialDimsRef = useRef<{ cols: number; rows: number } | null>(null);
  if (!initialDimsRef.current && cols > 0 && rows > 0) {
    initialDimsRef.current = { cols, rows };
  }
  const ready = cols > 0 && rows > 0;

  // ──────────────────────────────────────────────────────────────────────
  // Paint
  // ──────────────────────────────────────────────────────────────────────

  function scheduleFrame(): void {
    if (drawScheduledRef.current) return;
    drawScheduledRef.current = true;
    const fn = () => {
      drawScheduledRef.current = false;
      paintFrame();
    };
    if (typeof requestAnimationFrame === "function") {
      requestAnimationFrame(fn);
    } else {
      queueMicrotask(fn);
    }
  }

  function paintFrame(): void {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const grid = gridRef.current;
    const c = cellRef.current;
    const dpr = typeof window === "undefined" ? 1 : window.devicePixelRatio || 1;

    const cssW = grid.width * c.width;
    const cssH = grid.height * c.height;
    const bufW = Math.max(1, Math.round(cssW * dpr));
    const bufH = Math.max(1, Math.round(cssH * dpr));

    if (canvas.width !== bufW || canvas.height !== bufH) {
      canvas.width = bufW;
      canvas.height = bufH;
    }
    canvas.style.width = `${cssW}px`;
    canvas.style.height = `${cssH}px`;

    // Fresh transform matrix. Setting font / textBaseline is cheap but
    // resetTransform isn't — do it once per frame and never per run.
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.font = FONT;
    ctx.textBaseline = "top";

    // Background fill
    ctx.fillStyle = bgRef.current;
    ctx.fillRect(0, 0, cssW, cssH);

    // Render row by row, batching cells with the same hlId into runs.
    for (let row = 0; row < grid.height; row++) {
      paintRow(ctx, grid, row, c);
    }

    paintCursor(ctx, grid, c);
  }

  function paintRow(
    ctx: CanvasRenderingContext2D,
    grid: GridState,
    row: number,
    c: CellMetrics,
  ): void {
    const cells = grid.cells[row];
    const hls = grid.hlIds[row];
    if (!cells || !hls) return;

    let runStart = 0;
    let runHl = hls[0] ?? 0;
    const flush = (end: number) => {
      const attr = hlRef.current.get(runHl) ?? {};
      const fgN = attr.reverse ? attr.background : attr.foreground;
      const bgN = attr.reverse ? attr.foreground : attr.background;
      const fg = rgbToHex(fgN ?? Number.NaN, fgRef.current);
      const bg = rgbToHex(bgN ?? Number.NaN, bgRef.current);

      const x = runStart * c.width;
      const y = row * c.height;
      const w = (end - runStart) * c.width;

      // Background — skip when matching default to save fill calls.
      if (bg !== bgRef.current) {
        ctx.fillStyle = bg;
        ctx.fillRect(x, y, w, c.height);
      }

      const text = cells.slice(runStart, end).join("");
      if (text.trim() !== "" || attr.underline || attr.undercurl || attr.strikethrough) {
        ctx.fillStyle = fg;
        // Style adjustments (bold/italic) use a per-run font assignment.
        const variants: string[] = [];
        if (attr.italic) variants.push("italic");
        if (attr.bold) variants.push("bold");
        if (variants.length > 0) {
          ctx.font = `${variants.join(" ")} ${FONT}`;
          ctx.fillText(text, x, y);
          ctx.font = FONT;
        } else {
          ctx.fillText(text, x, y);
        }

        const sp = rgbToHex(attr.special ?? Number.NaN, spRef.current);
        const underY = y + c.baseline + 2;
        if (attr.underline || attr.undercurl || attr.underdouble) {
          ctx.strokeStyle = sp;
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.moveTo(x, underY);
          ctx.lineTo(x + w, underY);
          ctx.stroke();
        }
        if (attr.strikethrough) {
          ctx.strokeStyle = fg;
          ctx.lineWidth = 1;
          ctx.beginPath();
          const midY = y + c.height / 2;
          ctx.moveTo(x, midY);
          ctx.lineTo(x + w, midY);
          ctx.stroke();
        }
      }
    };

    for (let col = 1; col <= grid.width; col++) {
      const id = col < grid.width ? (hls[col] ?? 0) : Number.NaN; // sentinel
      if (id !== runHl) {
        flush(col);
        runStart = col;
        runHl = id;
      }
    }
  }

  function paintCursor(ctx: CanvasRenderingContext2D, grid: GridState, c: CellMetrics): void {
    const { row, col } = cursorRef.current;
    if (row < 0 || row >= grid.height || col < 0 || col >= grid.width) return;
    const mode = modeListRef.current[modeIdxRef.current];
    const shape = mode?.cursorShape ?? "block";
    const pct = (mode?.cellPercentage ?? 100) / 100;

    const x = col * c.width;
    const y = row * c.height;

    // Cursor colour: if mode has an attr_id, use that highlight; else
    // reverse the underlying cell's fg/bg (Neovim's default).
    const attr = mode && mode.attrId > 0 ? (hlRef.current.get(mode.attrId) ?? {}) : {};
    const cursorBg = rgbToHex(attr.background ?? Number.NaN, fgRef.current);
    const cursorFg = rgbToHex(attr.foreground ?? Number.NaN, bgRef.current);

    ctx.fillStyle = cursorBg;
    if (shape === "block") {
      ctx.fillRect(x, y, c.width, c.height);
      const cellChar = grid.cells[row]?.[col] ?? " ";
      if (cellChar.trim() !== "") {
        ctx.fillStyle = cursorFg;
        ctx.fillText(cellChar, x, y);
      }
    } else if (shape === "horizontal") {
      const h = Math.max(1, Math.round(c.height * pct));
      ctx.fillRect(x, y + c.height - h, c.width, h);
    } else {
      const w = Math.max(1, Math.round(c.width * pct));
      ctx.fillRect(x, y, w, c.height);
    }
  }

  // ──────────────────────────────────────────────────────────────────────
  // Event application
  // ──────────────────────────────────────────────────────────────────────

  function applyEvent(ev: RedrawEvent): void {
    const grid = gridRef.current;
    switch (ev.type) {
      case "grid_resize":
        resizeGrid(grid, ev.width, ev.height);
        break;

      case "grid_clear":
        for (let r = 0; r < grid.height; r++) {
          grid.cells[r]?.fill(" ");
          grid.hlIds[r]?.fill(0);
        }
        break;

      case "grid_cursor_goto":
        cursorRef.current = { row: ev.row, col: ev.col };
        break;

      case "grid_line": {
        const row = grid.cells[ev.row];
        const hls = grid.hlIds[ev.row];
        if (!row || !hls) break;
        let col = ev.colStart;
        for (const c of ev.cells) {
          for (let i = 0; i < c.repeat; i++) {
            if (col < grid.width) {
              row[col] = c.text;
              hls[col] = c.hlId;
            }
            col++;
          }
        }
        break;
      }

      case "grid_scroll": {
        // Spec: copy region [top, bot) × [left, right) up by `rows` (down if
        // rows<0). Cleared region NOT zeroed by this event — subsequent
        // grid_line events fill it.
        const { top, bot, left, right, rows: scroll } = ev;
        if (scroll > 0) {
          for (let r = top; r < bot - scroll; r++) {
            const dst = grid.cells[r];
            const dstHl = grid.hlIds[r];
            const src = grid.cells[r + scroll];
            const srcHl = grid.hlIds[r + scroll];
            if (!dst || !dstHl || !src || !srcHl) continue;
            for (let col = left; col < right; col++) {
              dst[col] = src[col] ?? " ";
              dstHl[col] = srcHl[col] ?? 0;
            }
          }
        } else if (scroll < 0) {
          const abs = -scroll;
          for (let r = bot - 1; r >= top + abs; r--) {
            const dst = grid.cells[r];
            const dstHl = grid.hlIds[r];
            const src = grid.cells[r - abs];
            const srcHl = grid.hlIds[r - abs];
            if (!dst || !dstHl || !src || !srcHl) continue;
            for (let col = left; col < right; col++) {
              dst[col] = src[col] ?? " ";
              dstHl[col] = srcHl[col] ?? 0;
            }
          }
        }
        break;
      }

      case "hl_attr_define":
        hlRef.current.set(ev.id, ev.rgbAttr);
        break;

      case "default_colors_set":
        if (ev.rgbFg >= 0) fgRef.current = rgbToHex(ev.rgbFg, fgRef.current);
        if (ev.rgbBg >= 0) bgRef.current = rgbToHex(ev.rgbBg, bgRef.current);
        if (ev.rgbSp >= 0) spRef.current = rgbToHex(ev.rgbSp, spRef.current);
        break;

      case "mode_info_set":
        modeListRef.current = ev.modeInfo;
        break;
      case "mode_change":
        modeIdxRef.current = ev.modeIdx;
        break;

      case "set_title":
        document.title = ev.title ? `${ev.title} — Fenrir` : "Fenrir";
        break;

      case "flush":
        scheduleFrame();
        break;

      // bell, busy_*: no UI feedback yet (intentional — kept minimal).
      case "bell":
      case "busy_start":
      case "busy_stop":
        break;
    }
  }

  // ──────────────────────────────────────────────────────────────────────
  // Attach lifecycle
  // ──────────────────────────────────────────────────────────────────────

  useEffect(() => {
    if (!ready) return;
    const dims = initialDimsRef.current;
    if (!dims) return;

    const bridge = getDesktopBridge();
    if (!bridge) {
      // Browser-only mode: no nvim available. Leave `handle` null; the
      // Canvas just shows the empty default background.
      console.warn("[neovim] desktopBridge not available — running outside Electron?");
      return;
    }

    let cancelled = false;

    // Reset state for this attach
    gridRef.current = makeGrid(dims.cols, dims.rows);
    hlRef.current = new Map();
    cursorRef.current = { row: 0, col: 0 };
    modeListRef.current = [];
    modeIdxRef.current = 0;

    const unsub = bridge.onNeovimRedraw((rawEvents) => {
      if (cancelled) return;
      for (const ev of parseRedrawBatch(rawEvents)) applyEvent(ev);
    });

    bridge
      .neovimAttach(cwd, dims.cols, dims.rows)
      .then(() => {
        if (cancelled) return;
        setHandle({
          input: (keys) => {
            void bridge.neovimInput(keys).catch((e) => console.warn("[neovim] input failed:", e));
          },
          uiTryResize: (c2, r2) => {
            void bridge
              .neovimResize(c2, r2)
              .catch((e) => console.warn("[neovim] resize failed:", e));
          },
        });
      })
      .catch((e: unknown) => {
        console.error("[neovim] attach failed:", e);
      });

    return () => {
      cancelled = true;
      drawScheduledRef.current = false;
      unsub();
      setHandle(null);
      void bridge.neovimDetach().catch((e) => console.warn("[neovim] detach failed:", e));
      // Reset initial-dims so a remount with different cwd captures fresh
      // measurements rather than reusing the previous attach's size.
      initialDimsRef.current = null;
    };
    // `cell.width` / `cell.height` deliberately excluded from deps: they're
    // read live via `cellRef` during paint, and changing them must not
    // tear down + reattach the embedded Neovim process.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cwd, ready]);

  return handle;
}
