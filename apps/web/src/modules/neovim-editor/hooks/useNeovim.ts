import { useEffect, useRef, useState } from "react";
import { parseRedrawBatch } from "../protocol/RedrawParser";
import type { GridState, HlAttr, ModeInfo } from "../protocol/RedrawParser";
import { useNeovimStore } from "../stores/neovimStore";
import {
  debugEnabled,
  debugLog,
  debugWarn,
  moduleId as debugModuleId,
  recordDraw,
  recordEvent,
  recordRawEvent,
  recordScroll,
  setAttached,
  setBridge,
  setCursor,
  setCwd,
  setDefaultColors,
  setDims,
  setMode,
  snapshotGrids,
} from "../debug/debug";

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

function colorToHex(c: string | number): string {
  if (typeof c === "string") return c;
  if (c < 0) return "#000000";
  return `#${c.toString(16).padStart(6, "0")}`;
}

function getColor(value: number | undefined | null, defaultColor: string): string {
  if (value === undefined || value === null || value === -1) return defaultColor;
  return `#${value.toString(16).padStart(6, "0")}`;
}

function dimColor(hex: string): string {
  if (!hex.startsWith("#") || hex.length !== 7) return hex;
  const r = Math.round(parseInt(hex.slice(1, 3), 16) * 0.5);
  const g = Math.round(parseInt(hex.slice(3, 5), 16) * 0.5);
  const b = Math.round(parseInt(hex.slice(5, 7), 16) * 0.5);
  return `#${r.toString(16).padStart(2, "0")}${g.toString(16).padStart(2, "0")}${b.toString(16).padStart(2, "0")}`;
}

function makeGrid(width: number, height: number): GridState {
  return {
    cells: Array.from({ length: height }, () => Array(width).fill(" ")),
    hlIds: Array.from({ length: height }, () => Array(width).fill(0)),
    width,
    height,
    startRow: 0,
    startCol: 0,
    isFloat: false,
    zindex: 0,
    compindex: 0,
    hidden: false,
    hasCursor: false,
  };
}

export function useNeovim(
  cwd: string,
  cols: number,
  rows: number,
  canvasRef: React.RefObject<HTMLCanvasElement | null>,
): NeovimHandle | null {
  const [handle, setHandle] = useState<NeovimHandle | null>(null);

  const gridsRef = useRef<GridState[]>([]);
  const hlRef = useRef<Map<number, HlAttr>>(new Map());
  const cursorRef = useRef({ row: 0, col: 0 });
  const modeInfoRef = useRef<ModeInfo[]>([]);
  const activeModeIdxRef = useRef(0);
  const rowsRef = useRef(0);
  const colsRef = useRef(0);
  const fgRef = useRef("#cccccc");
  const bgRef = useRef("#1e1e2e");
  const drawScheduledRef = useRef(false);
  const frameCounterRef = useRef(0);

  const initialDimsRef = useRef<{ cols: number; rows: number } | null>(null);
  if (cols > 0 && rows > 0 && !initialDimsRef.current) {
    initialDimsRef.current = { cols, rows };
  }
  const dimsReady = cols > 0 && rows > 0;

  const setGridSize = useNeovimStore((s) => s.setGridSize);
  // moveCursor removed — cursor position lives in cursorRef only

  function drawCursor(
    ctx: CanvasRenderingContext2D,
    grid: GridState,
    cellWidth: number,
    cellHeight: number,
    offsetX: number,
    offsetY: number,
  ) {
    const { row, col } = cursorRef.current;
    const modeInfo = modeInfoRef.current[activeModeIdxRef.current];
    if (!modeInfo) return;

    const x = offsetX + col * cellWidth;
    const y = offsetY + row * cellHeight;
    const pct = (modeInfo.cellPercentage ?? 100) / 100;

    if (debugEnabled() && (row >= grid.height || col >= grid.width || row < 0 || col < 0)) {
      debugWarn(
        "cursor",
        `cursor out of grid bounds: (${row},${col}) grid ${grid.width}x${grid.height}`,
      );
    }

    ctx.fillStyle = colorToHex(fgRef.current);

    switch (modeInfo.cursorShape) {
      case "block":
        ctx.fillRect(x, y, cellWidth, cellHeight);
        // Re-draw char in background color so it's visible on cursor block.
        ctx.font = `${cellHeight - 2}px monospace`;
        ctx.fillStyle = colorToHex(bgRef.current);
        ctx.fillText(grid.cells[row]?.[col] ?? " ", x, y + cellHeight - 4);
        break;
      case "horizontal":
        ctx.fillRect(x, y + cellHeight * (1 - pct), cellWidth, cellHeight * pct);
        break;
      case "vertical":
        ctx.fillRect(x, y, Math.max(1, cellWidth * pct), cellHeight);
        break;
    }
  }

  // Visible-when-debugging fallback so cursor presence/position can be
  // verified even when modeInfo hasn't arrived yet or shape data is wrong.
  function drawDebugCursorOutline(
    ctx: CanvasRenderingContext2D,
    cellWidth: number,
    cellHeight: number,
    offsetX: number,
    offsetY: number,
  ) {
    if (!debugEnabled()) return;
    const { row, col } = cursorRef.current;
    const x = offsetX + col * cellWidth;
    const y = offsetY + row * cellHeight;
    ctx.save();
    ctx.strokeStyle = "#ff5577";
    ctx.lineWidth = 1;
    ctx.setLineDash([2, 2]);
    ctx.strokeRect(x + 0.5, y + 0.5, cellWidth - 1, cellHeight - 1);
    ctx.restore();
  }

  function drawGrid(
    ctx: CanvasRenderingContext2D,
    grid: GridState,
    cellWidth: number,
    cellHeight: number,
  ) {
    const offsetX = grid.startCol * cellWidth;
    const offsetY = grid.startRow * cellHeight;
    const defaultBgHex = colorToHex(bgRef.current);

    for (let row = 0; row < grid.height; row++) {
      const rowBuf = grid.cells[row];
      const hlRow = grid.hlIds[row];
      if (!rowBuf || !hlRow) continue;

      let runStart = 0;
      let runHlId = hlRow[0] ?? 0;

      const flushRun = (runEnd: number) => {
        const attr = hlRef.current.get(runHlId) ?? {};
        const fg = attr.reverse
          ? getColor(attr.background, bgRef.current)
          : getColor(attr.foreground, fgRef.current);
        const bg = attr.reverse
          ? getColor(attr.foreground, fgRef.current)
          : getColor(attr.background, bgRef.current);
        const text = rowBuf.slice(runStart, runEnd).join("");
        const x = offsetX + runStart * cellWidth;
        const y = offsetY + row * cellHeight;
        const runWidth = (runEnd - runStart) * cellWidth;

        // Background
        if (bg !== defaultBgHex) {
          ctx.fillStyle = bg;
          ctx.fillRect(x, y, runWidth, cellHeight);
        }

        // Font style
        const fontStyle = [attr.bold ? "bold" : "", attr.italic ? "italic" : ""]
          .filter(Boolean)
          .join(" ");
        ctx.font = `${fontStyle} ${cellHeight - 2}px monospace`.trim();
        ctx.fillStyle = attr.dim ? dimColor(fg) : fg;

        // Text (skip if conceal attr set)
        const concealed = (attr as { conceal?: boolean }).conceal === true;
        if (!concealed) {
          ctx.fillText(text, x, y + cellHeight - 4);
        }

        // Decorations
        const specialColor = getColor(attr.special, fg);
        const baseY = y + cellHeight - 2;

        if (attr.underline) {
          ctx.strokeStyle = specialColor;
          ctx.lineWidth = 1;
          ctx.setLineDash([]);
          ctx.beginPath();
          ctx.moveTo(x, baseY);
          ctx.lineTo(x + runWidth, baseY);
          ctx.stroke();
        }

        if (attr.undercurl) {
          ctx.strokeStyle = specialColor;
          ctx.lineWidth = 1;
          ctx.setLineDash([]);
          ctx.beginPath();
          for (let wx = 0; wx < runWidth; wx += 4) {
            const wy = wx % 8 < 4 ? baseY - 1 : baseY + 1;
            if (wx === 0) ctx.moveTo(x + wx, wy);
            else ctx.lineTo(x + wx, wy);
          }
          ctx.stroke();
        }

        if (attr.strikethrough) {
          ctx.strokeStyle = fg;
          ctx.lineWidth = 1;
          ctx.setLineDash([]);
          ctx.beginPath();
          ctx.moveTo(x, y + cellHeight / 2);
          ctx.lineTo(x + runWidth, y + cellHeight / 2);
          ctx.stroke();
        }

        if (attr.underdouble) {
          ctx.strokeStyle = specialColor;
          ctx.lineWidth = 1;
          ctx.setLineDash([]);
          // Top line
          ctx.beginPath();
          ctx.moveTo(x, baseY - 2);
          ctx.lineTo(x + runWidth, baseY - 2);
          ctx.stroke();
          // Bottom line
          ctx.beginPath();
          ctx.moveTo(x, baseY);
          ctx.lineTo(x + runWidth, baseY);
          ctx.stroke();
        }

        if (attr.underdotted) {
          ctx.strokeStyle = specialColor;
          ctx.lineWidth = 1;
          ctx.setLineDash([1, 2]);
          ctx.beginPath();
          ctx.moveTo(x, baseY);
          ctx.lineTo(x + runWidth, baseY);
          ctx.stroke();
          ctx.setLineDash([]);
        }

        if (attr.underdashed) {
          ctx.strokeStyle = specialColor;
          ctx.lineWidth = 1;
          ctx.setLineDash([4, 3]);
          ctx.beginPath();
          ctx.moveTo(x, baseY);
          ctx.lineTo(x + runWidth, baseY);
          ctx.stroke();
          ctx.setLineDash([]);
        }
      };

      // Iterate cols 1..width inclusive; sentinel hlId = -1 at width forces final flush.
      for (let col = 1; col <= grid.width; col++) {
        const hlId = col < grid.width ? (hlRow[col] ?? 0) : -1;
        if (hlId !== runHlId) {
          flushRun(col);
          runStart = col;
          runHlId = hlId;
        }
      }
    }

    if (grid.hasCursor) {
      drawCursor(ctx, grid, cellWidth, cellHeight, offsetX, offsetY);
      drawDebugCursorOutline(ctx, cellWidth, cellHeight, offsetX, offsetY);
    }
  }

  function drawFrame() {
    drawScheduledRef.current = false;
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!ctx || !canvas) {
      debugWarn("draw", "skipped: ctx or canvas null");
      return;
    }
    recordDraw(canvas.width, canvas.height);

    const cellWidth = CELL_W;
    const cellHeight = CELL_H;

    // 1. Background fill
    ctx.fillStyle = colorToHex(bgRef.current);
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // Debug: tiny "alive" indicator (8×8) in top-LEFT corner. Color cycles per
    // frame so it's obvious from the screenshot if drawFrame is firing.
    if (debugEnabled()) {
      frameCounterRef.current = (frameCounterRef.current + 1) & 0xff;
      const hue = frameCounterRef.current * 4;
      ctx.fillStyle = `hsl(${hue}, 100%, 50%)`;
      ctx.fillRect(0, 0, 8, 8);
    }

    // 2. Partition grids
    const allGrids = gridsRef.current.filter((g): g is GridState => !!g && !g.hidden);
    const normalGrids = allGrids
      .filter((g) => !g.isFloat)
      .toSorted((a, b) => a.compindex - b.compindex);
    const floatGrids = allGrids
      .filter((g) => g.isFloat)
      .toSorted((a, b) => a.compindex - b.compindex);

    // 3. Paint in order: non-floats (incl. msg grid by zindex/compindex) → floats
    for (const grid of [...normalGrids, ...floatGrids]) {
      drawGrid(ctx, grid, cellWidth, cellHeight);
    }
  }

  function scheduleFrame() {
    if (drawScheduledRef.current) return;
    drawScheduledRef.current = true;
    // queueMicrotask instead of requestAnimationFrame: rAF gets throttled or
    // paused when the Electron window is occluded/unfocused, leaving the flag
    // stuck and starving subsequent flushes. Microtasks always fire after the
    // current task, regardless of window state. Multiple flushes within the
    // same task still coalesce via the flag.
    queueMicrotask(drawFrame);
  }

  useEffect(() => {
    const bridge = getDesktopBridge();
    setBridge(!!bridge);
    setCwd(cwd);
    const dims = initialDimsRef.current;
    if (!bridge) {
      console.warn("[neovim] desktopBridge not available — are you in the Electron app?");
      setAttached(false, "desktopBridge missing on window");
      return;
    }
    if (!dims) {
      debugLog("attach", "skipping — initial dims not ready");
      return;
    }
    setDims(dims.cols, dims.rows);
    debugLog("attach", `cwd=${cwd} ${dims.cols}x${dims.rows} debugModuleId=${debugModuleId}`);

    let cancelled = false;

    // Grid 1 is the global background grid, always present.
    // Its startRow/startCol are always 0 and compindex is 0 (rendered behind everything).
    rowsRef.current = dims.rows;
    colsRef.current = dims.cols;
    gridsRef.current[1] = makeGrid(dims.cols, dims.rows);

    const h: NeovimHandle = {
      input: (keys) => bridge.neovimInput(keys),
      uiTryResize: (c, r) => bridge.neovimResize(c, r),
    };
    setHandle(h);

    let rawBatchesLogged = 0;
    const unsubRedraw = bridge.onNeovimRedraw((rawEvents) => {
      if (cancelled) return;

      // Pre-parse raw counter — counts every event nvim sends, even ones the
      // parser drops. If raw shows grid_cursor_goto but parsed doesn't, parser
      // is broken. If raw also lacks it, nvim isn't emitting it.
      if (debugEnabled() && Array.isArray(rawEvents)) {
        for (const raw of rawEvents) {
          if (Array.isArray(raw) && raw.length > 0 && typeof raw[0] === "string") {
            recordRawEvent(raw[0]);
          } else {
            recordRawEvent("(non-array-or-bad-shape)");
          }
        }
        // Print first few raw batches verbatim so we can see the shape.
        if (rawBatchesLogged < 6) {
          rawBatchesLogged++;
          const types = rawEvents
            .map((e) => (Array.isArray(e) && typeof e[0] === "string" ? e[0] : "?"))
            .join(",");
          debugLog("raw", `batch#${rawBatchesLogged} len=${rawEvents.length} [${types}]`);
        }
      }

      for (const event of parseRedrawBatch(rawEvents)) {
        recordEvent(event.type);
        switch (event.type) {
          case "hl_attr_define":
            hlRef.current.set(event.id, event.rgbAttr);
            break;

          case "default_colors_set":
            // -1 means "unset, use terminal default" (ext_termcolors mode);
            // 0 is valid (pure black), so check !== -1, not > 0.
            if (event.rgbFg !== -1) fgRef.current = colorToHex(event.rgbFg);
            if (event.rgbBg !== -1) bgRef.current = colorToHex(event.rgbBg);
            setDefaultColors(fgRef.current, bgRef.current);
            break;

          case "grid_resize": {
            const { grid, width, height } = event;
            const existing = gridsRef.current[grid];
            if (existing) {
              existing.width = width;
              existing.height = height;
              while (existing.cells.length < height) {
                existing.cells.push(Array(width).fill(" "));
                existing.hlIds.push(Array(width).fill(0));
              }
              existing.cells.length = height;
              existing.hlIds.length = height;
              for (let r = 0; r < height; r++) {
                const cellRow = existing.cells[r];
                const hlRow = existing.hlIds[r];
                if (!cellRow || !hlRow) {
                  existing.cells[r] = Array(width).fill(" ");
                  existing.hlIds[r] = Array(width).fill(0);
                } else {
                  const oldLen = cellRow.length;
                  cellRow.length = width;
                  hlRow.length = width;
                  if (width > oldLen) {
                    cellRow.fill(" ", oldLen, width);
                    hlRow.fill(0, oldLen, width);
                  }
                }
              }
            } else {
              gridsRef.current[grid] = makeGrid(width, height);
            }
            if (grid === 1) {
              rowsRef.current = height;
              colsRef.current = width;
              setGridSize(height, width);
              setDims(width, height);
            }
            break;
          }

          case "grid_line": {
            const g = gridsRef.current[event.grid];
            if (!g) break;
            const rowBuf = g.cells[event.row];
            const hlRow = g.hlIds[event.row];
            if (!rowBuf || !hlRow) break;
            let col = event.colStart;
            for (const cell of event.cells) {
              for (let rep = 0; rep < cell.repeat; rep++) {
                if (col < g.width) {
                  rowBuf[col] = cell.text;
                  hlRow[col] = cell.hlId;
                }
                col++;
              }
            }
            break;
          }

          case "grid_scroll": {
            const { grid, top, bot, left, right, rows } = event;
            recordScroll(grid, top, bot, left, right, rows);
            const g = gridsRef.current[grid];
            if (!g) {
              debugWarn("scroll", `grid ${grid} missing for grid_scroll`);
              break;
            }
            if (rows > 0) {
              for (let r = top; r < bot - rows; r++) {
                const dst = g.cells[r];
                const dstHl = g.hlIds[r];
                const src = g.cells[r + rows];
                const srcHl = g.hlIds[r + rows];
                if (!dst || !dstHl || !src || !srcHl) continue;
                for (let c = left; c < right; c++) {
                  dst[c] = src[c] ?? " ";
                  dstHl[c] = srcHl[c] ?? 0;
                }
              }
              for (let r = bot - rows; r < bot; r++) {
                const dst = g.cells[r];
                const dstHl = g.hlIds[r];
                if (!dst || !dstHl) continue;
                for (let c = left; c < right; c++) {
                  dst[c] = " ";
                  dstHl[c] = 0;
                }
              }
            } else if (rows < 0) {
              const abs = -rows;
              for (let r = bot - 1; r >= top + abs; r--) {
                const dst = g.cells[r];
                const dstHl = g.hlIds[r];
                const src = g.cells[r - abs];
                const srcHl = g.hlIds[r - abs];
                if (!dst || !dstHl || !src || !srcHl) continue;
                for (let c = left; c < right; c++) {
                  dst[c] = src[c] ?? " ";
                  dstHl[c] = srcHl[c] ?? 0;
                }
              }
              for (let r = top; r < top + abs; r++) {
                const dst = g.cells[r];
                const dstHl = g.hlIds[r];
                if (!dst || !dstHl) continue;
                for (let c = left; c < right; c++) {
                  dst[c] = " ";
                  dstHl[c] = 0;
                }
              }
            }
            break;
          }

          case "grid_cursor_goto": {
            for (const g of gridsRef.current) {
              if (g) g.hasCursor = false;
            }
            const g = gridsRef.current[event.grid];
            if (g) {
              g.hasCursor = true;
            } else {
              debugWarn(
                "cursor",
                `grid_cursor_goto for missing grid ${event.grid} (${event.row},${event.col})`,
              );
            }
            cursorRef.current = { row: event.row, col: event.col };
            setCursor(event.grid, event.row, event.col);
            break;
          }

          case "grid_clear": {
            const g = gridsRef.current[event.grid];
            if (!g) break;
            for (let r = 0; r < g.height; r++) {
              g.cells[r]?.fill(" ");
              g.hlIds[r]?.fill(0);
            }
            break;
          }

          case "grid_destroy":
            gridsRef.current[event.grid] = undefined as unknown as GridState;
            break;

          case "mode_info_set":
            modeInfoRef.current = event.modeInfo;
            setMode(activeModeIdxRef.current, modeInfoRef.current[activeModeIdxRef.current]);
            debugLog("mode", `mode_info_set: ${event.modeInfo.length} modes`);
            break;

          case "mode_change":
            activeModeIdxRef.current = event.modeIdx;
            setMode(event.modeIdx, modeInfoRef.current[event.modeIdx]);
            debugLog("mode", `mode_change → ${event.modeName} (idx ${event.modeIdx})`);
            break;

          case "flush":
            snapshotGrids(gridsRef.current);
            scheduleFrame();
            break;

          case "set_title": {
            const t = event.title;
            document.title = t ? `${t} — Neovim` : "Neovim";
            break;
          }

          case "win_pos": {
            const g = gridsRef.current[event.grid];
            if (!g) break;
            g.startRow = event.startRow;
            g.startCol = event.startCol;
            g.width = event.width;
            g.height = event.height;
            g.isFloat = false;
            g.hidden = false;
            // win_pos has no compindex; non-float windows don't overlap, so
            // grid id gives a stable ordering.
            g.compindex = event.grid;
            g.zindex = 0;
            break;
          }

          case "win_float_pos": {
            const g = gridsRef.current[event.grid];
            if (!g) break;
            g.startRow = event.screenRow;
            g.startCol = event.screenCol;
            g.isFloat = true;
            g.zindex = event.zindex;
            g.compindex = event.compindex;
            g.hidden = false;
            break;
          }

          case "win_external_pos": {
            const g = gridsRef.current[event.grid];
            if (g) g.hidden = true;
            break;
          }

          case "win_hide": {
            const g = gridsRef.current[event.grid];
            if (g) g.hidden = true;
            break;
          }

          case "win_close": {
            gridsRef.current[event.grid] = undefined as unknown as GridState;
            break;
          }

          case "msg_set_pos": {
            const g = gridsRef.current[event.grid];
            if (!g) break;
            g.startRow = event.row;
            g.startCol = 0;
            g.isFloat = false;
            g.zindex = event.zindex;
            g.compindex = event.compindex;
            g.hidden = false;
            break;
          }

          // Phase 4: busy_start/stop, bell, chdir → store updates
        }
      }
    });

    bridge
      .neovimAttach(cwd, dims.cols, dims.rows)
      .then(() => {
        if (!cancelled) {
          setAttached(true);
          debugLog("attach", "ok");
        }
      })
      .catch((e: unknown) => {
        console.error("[neovim] attach failed:", e);
        const msg = e instanceof Error ? e.message : String(e);
        setAttached(false, msg);
      });

    return () => {
      cancelled = true;
      // Pending microtask, if any, will fire after this cleanup. drawFrame
      // safely no-ops when canvasRef.current is null after unmount, so no
      // explicit cancel needed.
      drawScheduledRef.current = false;
      unsubRedraw();
      setHandle(null);
      setAttached(false);
      document.title = "Fenrir";
      bridge.neovimDetach().catch(console.error);
    };
    // Resize is handled by useResize → uiTryResize, not by re-attaching.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cwd, dimsReady]);

  return handle;
}
