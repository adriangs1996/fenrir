import { useEffect, useRef, useState } from "react";
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

export function useNeovim(
  cwd: string,
  cols: number,
  rows: number,
  canvasRef: React.RefObject<HTMLCanvasElement | null>,
): NeovimHandle | null {
  const [handle, setHandle] = useState<NeovimHandle | null>(null);

  // Mutable grid buffer — plain strings, no React state
  const gridRef = useRef<string[][]>([]);
  const cursorRef = useRef({ row: 0, col: 0 });
  const rowsRef = useRef(0);
  const colsRef = useRef(0);
  const fgRef = useRef("#cccccc");
  const bgRef = useRef("#1e1e2e");
  const rafRef = useRef<number | null>(null);

  // Track initial dimensions for attach — avoid putting cols/rows in effect deps
  const initialDimsRef = useRef<{ cols: number; rows: number } | null>(null);
  if (cols > 0 && rows > 0 && !initialDimsRef.current) {
    initialDimsRef.current = { cols, rows };
  }
  // Track whether dimensions are ready (non-zero)
  const dimsReady = cols > 0 && rows > 0;

  const setGridSize = useNeovimStore((s) => s.setGridSize);
  const moveCursor = useNeovimStore((s) => s.moveCursor);

  function resizeGrid(r: number, c: number) {
    rowsRef.current = r;
    colsRef.current = c;
    gridRef.current = Array.from({ length: r }, (_, row) => {
      const existing = gridRef.current[row];
      const newRow = Array.from({ length: c }, (_, col) => existing?.[col] ?? " ");
      return newRow;
    });
    setGridSize(r, c);
  }

  function clearGrid() {
    gridRef.current = Array.from({ length: rowsRef.current }, () =>
      Array.from({ length: colsRef.current }, () => " "),
    );
  }

  function drawFrame() {
    rafRef.current = null;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    ctx.fillStyle = bgRef.current;
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    ctx.font = `14px monospace`;
    ctx.fillStyle = fgRef.current;

    const r = rowsRef.current;
    const grid = gridRef.current;
    for (let row = 0; row < r; row++) {
      const line = grid[row]?.join("") ?? "";
      ctx.fillText(line, 0, row * CELL_H + CELL_H - 3);
    }

    const { row: cr, col: cc } = cursorRef.current;
    ctx.fillStyle = "rgba(255,255,255,0.35)";
    ctx.fillRect(cc * CELL_W, cr * CELL_H, CELL_W, CELL_H);
  }

  function scheduleFrame() {
    if (rafRef.current !== null) return;
    rafRef.current = requestAnimationFrame(drawFrame);
  }

  // Attach once when bridge is available and dimensions are ready.
  // Resize is handled separately by useResize → uiTryResize.
  useEffect(() => {
    const bridge = getDesktopBridge();
    const dims = initialDimsRef.current;
    console.log("[neovim] useNeovim effect — bridge:", !!bridge, "dimsReady:", dimsReady);
    if (!bridge) {
      console.warn("[neovim] desktopBridge not available — are you in the Electron app?");
      return;
    }
    if (!dims) {
      console.log("[neovim] skipping attach — dimensions not ready yet");
      return;
    }

    let cancelled = false;

    const h: NeovimHandle = {
      input: (keys) => bridge.neovimInput(keys),
      uiTryResize: (c, r) => bridge.neovimResize(c, r),
    };
    setHandle(h);

    const unsubRedraw = bridge.onNeovimRedraw((events) => {
      if (cancelled) return;
      console.log("[neovim] redraw batch — event count:", events.length, events.map((e: any) => Array.isArray(e) ? e[0] : e));

      for (const rawEvent of events) {
        if (!Array.isArray(rawEvent) || rawEvent.length === 0) continue;
        const [type, ...argSets] = rawEvent as [string, ...unknown[][]];

        switch (type) {
          case "grid_resize":
            for (const argSet of argSets) {
              const [, width, height] = argSet as [number, number, number];
              console.log("[neovim] grid_resize →", width, "x", height);
              resizeGrid(height, width);
            }
            break;

          case "grid_line":
            for (const argSet of argSets) {
              const [, row, colStart, cells] = argSet as [number, number, number, unknown[]];
              if (!Array.isArray(cells)) continue;
              const rowBuf = gridRef.current[row as number];
              if (!rowBuf) continue;
              let lastHlId = 0;
              let col = colStart as number;
              for (const cell of cells) {
                if (!Array.isArray(cell)) continue;
                const text = cell[0] as string;
                const hlId = (cell[1] ?? lastHlId) as number;
                const repeat = (cell[2] ?? 1) as number;
                lastHlId = hlId;
                for (let rep = 0; rep < repeat; rep++) {
                  if (col < rowBuf.length) rowBuf[col] = text;
                  col++;
                }
              }
            }
            break;

          case "grid_cursor_goto":
            for (const argSet of argSets) {
              const [, row, col] = argSet as [number, number, number];
              console.log("[neovim] cursor →", row, col);
              cursorRef.current = { row, col };
              moveCursor(row, col);
            }
            break;

          case "grid_clear":
            console.log("[neovim] grid_clear");
            clearGrid();
            break;

          case "default_colors_set":
            for (const argSet of argSets) {
              const [fg, bg] = argSet as [number, number];
              if (fg > 0) fgRef.current = `#${fg.toString(16).padStart(6, "0")}`;
              if (bg > 0) bgRef.current = `#${bg.toString(16).padStart(6, "0")}`;
            }
            break;

          case "flush":
            scheduleFrame();
            break;

          default:
            // ignored: option_set, hl_attr_define, hl_group_set, mode_info_set, mode_change, etc.
            break;
        }
      }
    });

    console.log("[neovim] calling neovimAttach —", cwd, dims.cols, dims.rows);
    bridge.neovimAttach(cwd, dims.cols, dims.rows)
      .then(() => console.log("[neovim] neovimAttach resolved"))
      .catch((e: unknown) => console.error("[neovim] neovimAttach failed:", e));

    return () => {
      console.log("[neovim] cleanup — detaching");
      cancelled = true;
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
      unsubRedraw();
      setHandle(null);
      bridge.neovimDetach().catch(console.error);
    };
    // Only re-run when cwd changes or dims first become ready.
    // Resizing is handled by useResize → uiTryResize, not by re-attaching.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cwd, dimsReady]);

  return handle;
}
