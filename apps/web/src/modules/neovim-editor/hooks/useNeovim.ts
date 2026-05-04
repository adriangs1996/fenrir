import { useEffect, useRef, useState } from "react";
import { parseRedrawBatch } from "../protocol/RedrawParser";
import type { HlAttr, ModeInfo } from "../protocol/RedrawParser";
import { useNeovimStore } from "../stores/neovimStore";

const CELL_W = 10;
const CELL_H = 18;

export interface NeovimHandle {
  input: (keys: string) => void;
  uiTryResize: (cols: number, rows: number) => void;
}

function getDesktopBridge() {
  return (window as any).desktopBridge as
    | {
        neovimAttach: (cwd: string, cols: number, rows: number) => Promise<void>;
        neovimDetach: () => Promise<void>;
        neovimInput: (keys: string) => Promise<void>;
        neovimResize: (cols: number, rows: number) => Promise<void>;
        onNeovimRedraw: (listener: (events: unknown[]) => void) => () => void;
      }
    | undefined;
}

function numToColor(n: number): string | null {
  if (n === -1) return null;
  return `#${n.toString(16).padStart(6, "0")}`;
}

export function useNeovim(
  cwd: string,
  cols: number,
  rows: number,
  canvasRef: React.RefObject<HTMLCanvasElement | null>,
): NeovimHandle | null {
  const [handle, setHandle] = useState<NeovimHandle | null>(null);

  const gridRef = useRef<string[][]>([]);
  const cellHlRef = useRef<number[][]>([]);
  const hlRef = useRef<Map<number, HlAttr>>(new Map());
  const cursorRef = useRef({ row: 0, col: 0 });
  const modeInfoRef = useRef<ModeInfo[]>([]);
  const activeModeIdxRef = useRef(0);
  const rowsRef = useRef(0);
  const colsRef = useRef(0);
  const fgRef = useRef("#cccccc");
  const bgRef = useRef("#1e1e2e");
  const rafRef = useRef<number | null>(null);

  const initialDimsRef = useRef<{ cols: number; rows: number } | null>(null);
  if (cols > 0 && rows > 0 && !initialDimsRef.current) {
    initialDimsRef.current = { cols, rows };
  }
  const dimsReady = cols > 0 && rows > 0;

  const setGridSize = useNeovimStore((s) => s.setGridSize);
  const moveCursor = useNeovimStore((s) => s.moveCursor);

  function resizeGrid(r: number, c: number) {
    rowsRef.current = r;
    colsRef.current = c;
    gridRef.current = Array.from({ length: r }, (_, row) => {
      const existing = gridRef.current[row];
      return Array.from({ length: c }, (_, col) => existing?.[col] ?? " ");
    });
    cellHlRef.current = Array.from({ length: r }, (_, row) => {
      const existing = cellHlRef.current[row];
      return Array.from({ length: c }, (_, col) => existing?.[col] ?? 0);
    });
    setGridSize(r, c);
  }

  function clearGrid() {
    gridRef.current = Array.from({ length: rowsRef.current }, () =>
      Array.from({ length: colsRef.current }, () => " "),
    );
    cellHlRef.current = Array.from({ length: rowsRef.current }, () =>
      Array.from({ length: colsRef.current }, () => 0),
    );
  }

  function resolveHL(hlId: number): {
    fg: string;
    bg: string;
    bold: boolean;
    italic: boolean;
    underline: boolean;
    undercurl: boolean;
    strikethrough: boolean;
    dim: boolean;
    special: string | null;
  } {
    const defaultFg = fgRef.current;
    const defaultBg = bgRef.current;

    const attr = hlRef.current.get(hlId);
    if (!attr) {
      return { fg: defaultFg, bg: defaultBg, bold: false, italic: false, underline: false, undercurl: false, strikethrough: false, dim: false, special: null };
    }

    let fg = numToColor(attr.foreground ?? -1) ?? defaultFg;
    let bg = numToColor(attr.background ?? -1) ?? defaultBg;
    const special = numToColor(attr.special ?? -1);

    if (attr.reverse) [fg, bg] = [bg, fg];

    return {
      fg,
      bg,
      bold: attr.bold ?? false,
      italic: attr.italic ?? false,
      underline: attr.underline ?? false,
      undercurl: attr.undercurl ?? false,
      strikethrough: attr.strikethrough ?? false,
      dim: attr.dim ?? false,
      special,
    };
  }

  function drawFrame() {
    rafRef.current = null;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const defaultBg = bgRef.current;
    const defaultFg = fgRef.current;

    ctx.fillStyle = defaultBg;
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    const r = rowsRef.current;
    const c = colsRef.current;
    const grid = gridRef.current;
    const cellHl = cellHlRef.current;

    for (let row = 0; row < r; row++) {
      const rowBuf = grid[row];
      const hlRow = cellHl[row];
      if (!rowBuf || !hlRow) continue;

      let runStart = 0;
      let runHl = hlRow[0] ?? 0;

      const flushRun = (end: number) => {
        const hl = resolveHL(runHl);

        if (hl.bg !== defaultBg) {
          ctx.fillStyle = hl.bg;
          ctx.fillRect(runStart * CELL_W, row * CELL_H, (end - runStart) * CELL_W, CELL_H);
        }

        let fontStr = "14px monospace";
        if (hl.bold && hl.italic) fontStr = "bold italic 14px monospace";
        else if (hl.bold) fontStr = "bold 14px monospace";
        else if (hl.italic) fontStr = "italic 14px monospace";
        ctx.font = fontStr;

        const text = rowBuf.slice(runStart, end).join("");
        if (hl.dim) ctx.globalAlpha = 0.5;
        ctx.fillStyle = hl.fg;
        ctx.fillText(text, runStart * CELL_W, row * CELL_H + CELL_H - 3);
        if (hl.dim) ctx.globalAlpha = 1.0;

        if (hl.underline) {
          const lineY = row * CELL_H + CELL_H - 2;
          ctx.strokeStyle = hl.special ?? hl.fg;
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.moveTo(runStart * CELL_W, lineY);
          ctx.lineTo(end * CELL_W, lineY);
          ctx.stroke();
        }

        if (hl.undercurl && !hl.underline) {
          const lineY = row * CELL_H + CELL_H - 2;
          ctx.strokeStyle = hl.special ?? hl.fg;
          ctx.lineWidth = 1;
          ctx.setLineDash([2, 2]);
          ctx.beginPath();
          ctx.moveTo(runStart * CELL_W, lineY);
          ctx.lineTo(end * CELL_W, lineY);
          ctx.stroke();
          ctx.setLineDash([]);
        }

        if (hl.strikethrough) {
          const midY = row * CELL_H + CELL_H / 2;
          ctx.strokeStyle = hl.fg;
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.moveTo(runStart * CELL_W, midY);
          ctx.lineTo(end * CELL_W, midY);
          ctx.stroke();
        }
      };

      for (let col = 1; col < c; col++) {
        const hl = hlRow[col] ?? 0;
        if (hl !== runHl) {
          flushRun(col);
          runStart = col;
          runHl = hl;
        }
      }
      flushRun(c);
    }

    // Reset font to default after row rendering before cursor
    ctx.font = "14px monospace";
    ctx.fillStyle = defaultFg;

    // Cursor — shape driven by active mode
    const { row: cr, col: cc } = cursorRef.current;
    const modeInfo = modeInfoRef.current[activeModeIdxRef.current];
    const shape = modeInfo?.cursorShape ?? "block";
    const pct = (modeInfo?.cellPercentage ?? 100) / 100;

    ctx.fillStyle = "rgba(255,255,255,0.7)";
    switch (shape) {
      case "block":
        ctx.fillRect(cc * CELL_W, cr * CELL_H, CELL_W, CELL_H);
        break;
      case "horizontal":
        ctx.fillRect(cc * CELL_W, cr * CELL_H + CELL_H * (1 - pct), CELL_W, CELL_H * pct);
        break;
      case "vertical":
        ctx.fillRect(cc * CELL_W, cr * CELL_H, Math.max(1, CELL_W * pct), CELL_H);
        break;
    }
  }

  function scheduleFrame() {
    if (rafRef.current !== null) return;
    rafRef.current = requestAnimationFrame(drawFrame);
  }

  useEffect(() => {
    const bridge = getDesktopBridge();
    const dims = initialDimsRef.current;
    if (!bridge) {
      console.warn("[neovim] desktopBridge not available — are you in the Electron app?");
      return;
    }
    if (!dims) return;

    let cancelled = false;

    const h: NeovimHandle = {
      input: (keys) => bridge.neovimInput(keys),
      uiTryResize: (c, r) => bridge.neovimResize(c, r),
    };
    setHandle(h);

    const unsubRedraw = bridge.onNeovimRedraw((rawEvents) => {
      if (cancelled) return;

      for (const event of parseRedrawBatch(rawEvents)) {
        switch (event.type) {
          case "hl_attr_define":
            hlRef.current.set(event.id, event.rgbAttr);
            break;

          case "default_colors_set":
            // -1 means "unset, use terminal default" (ext_termcolors mode);
            // 0 is valid (pure black), so check !== -1, not > 0.
            if (event.rgbFg !== -1) fgRef.current = `#${event.rgbFg.toString(16).padStart(6, "0")}`;
            if (event.rgbBg !== -1) bgRef.current = `#${event.rgbBg.toString(16).padStart(6, "0")}`;
            break;

          case "grid_resize":
            resizeGrid(event.height, event.width);
            break;

          case "grid_line": {
            const rowBuf = gridRef.current[event.row];
            const hlRow = cellHlRef.current[event.row];
            if (!rowBuf || !hlRow) break;
            let col = event.colStart;
            for (const cell of event.cells) {
              for (let rep = 0; rep < cell.repeat; rep++) {
                if (col < rowBuf.length) {
                  rowBuf[col] = cell.text;
                  hlRow[col] = cell.hlId;
                }
                col++;
              }
            }
            break;
          }

          case "grid_scroll": {
            const { top, bot, left, right, rows } = event;
            const g = gridRef.current;
            const hl = cellHlRef.current;
            if (rows > 0) {
              for (let row = top; row < bot - rows; row++) {
                for (let col = left; col < right; col++) {
                  if (g[row] && g[row + rows]) {
                    g[row]![col] = g[row + rows]![col] ?? " ";
                    hl[row]![col] = hl[row + rows]?.[col] ?? 0;
                  }
                }
              }
              for (let row = bot - rows; row < bot; row++) {
                for (let col = left; col < right; col++) {
                  if (g[row]) { g[row]![col] = " "; hl[row]![col] = 0; }
                }
              }
            } else if (rows < 0) {
              const abs = -rows;
              for (let row = bot - 1; row >= top + abs; row--) {
                for (let col = left; col < right; col++) {
                  if (g[row] && g[row - abs]) {
                    g[row]![col] = g[row - abs]![col] ?? " ";
                    hl[row]![col] = hl[row - abs]?.[col] ?? 0;
                  }
                }
              }
              for (let row = top; row < top + abs; row++) {
                for (let col = left; col < right; col++) {
                  if (g[row]) { g[row]![col] = " "; hl[row]![col] = 0; }
                }
              }
            }
            break;
          }

          case "grid_cursor_goto":
            cursorRef.current = { row: event.row, col: event.col };
            moveCursor(event.row, event.col);
            break;

          case "grid_clear":
            clearGrid();
            break;

          case "grid_destroy":
            if (event.grid === 1) clearGrid();
            break;

          case "mode_info_set":
            modeInfoRef.current = event.modeInfo;
            break;

          case "mode_change":
            activeModeIdxRef.current = event.modeIdx;
            break;

          case "flush":
            scheduleFrame();
            break;

          // Phase 4: set_title, busy_start/stop, bell, chdir → store updates
          // Phase 5: win_pos, win_float_pos, win_hide, win_close → multigrid compositor
        }
      }
    });

    bridge.neovimAttach(cwd, dims.cols, dims.rows).catch((e: unknown) =>
      console.error("[neovim] attach failed:", e),
    );

    return () => {
      cancelled = true;
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
      unsubRedraw();
      setHandle(null);
      bridge.neovimDetach().catch(console.error);
    };
    // Resize is handled by useResize → uiTryResize, not by re-attaching.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cwd, dimsReady]);

  return handle;
}
