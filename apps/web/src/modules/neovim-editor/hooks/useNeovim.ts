import { useEffect, useRef, useState } from "react";
import { useNeovimStore } from "../stores/neovimStore";

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

export function useNeovim(cwd: string, cols: number, rows: number): NeovimHandle | null {
  const [handle, setHandle] = useState<NeovimHandle | null>(null);
  const handleRef = useRef<NeovimHandle | null>(null);
  const putText = useNeovimStore((s) => s.putText);
  const moveCursor = useNeovimStore((s) => s.moveCursor);
  const setGridSize = useNeovimStore((s) => s.setGridSize);

  useEffect(() => {
    const bridge = getDesktopBridge();
    console.log("[neovim] useNeovim effect — bridge:", !!bridge, "cols:", cols, "rows:", rows);
    if (!bridge) {
      console.warn("[neovim] desktopBridge not available — are you in the Electron app?");
      return;
    }
    if (cols === 0 || rows === 0) {
      console.log("[neovim] skipping attach — dimensions not ready yet");
      return;
    }

    let cancelled = false;
    let unsubRedraw: (() => void) | null = null;

    const h: NeovimHandle = {
      input: (keys) => {
        bridge.neovimInput(keys);
      },
      uiTryResize: (c, r) => {
        bridge.neovimResize(c, r);
      },
    };
    handleRef.current = h;
    setHandle(h);

    unsubRedraw = bridge.onNeovimRedraw((events) => {
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
              setGridSize(height, width);
            }
            break;
          case "grid_line":
            for (const argSet of argSets) {
              const [, row, colStart, cells] = argSet as [number, number, number, unknown[]];
              if (!Array.isArray(cells)) continue;
              let lastHlId = 0;
              let col = colStart as number;
              for (const cell of cells) {
                if (!Array.isArray(cell)) continue;
                const text = cell[0] as string;
                const hlId = (cell[1] ?? lastHlId) as number;
                const repeat = (cell[2] ?? 1) as number;
                lastHlId = hlId;
                for (let r = 0; r < repeat; r++) {
                  putText(row as number, col++, text);
                }
              }
            }
            break;
          case "grid_cursor_goto":
            for (const argSet of argSets) {
              const [, row, col] = argSet as [number, number, number];
              console.log("[neovim] cursor →", row, col);
              moveCursor(row, col);
            }
            break;
          case "grid_clear":
            console.log("[neovim] grid_clear");
            setGridSize(useNeovimStore.getState().rows, useNeovimStore.getState().cols);
            break;
          default:
            console.log("[neovim] unhandled event:", type);
        }
      }
    });

    console.log("[neovim] calling neovimAttach —", cwd, cols, rows);
    bridge.neovimAttach(cwd, cols, rows)
      .then(() => console.log("[neovim] neovimAttach resolved"))
      .catch((e: unknown) => console.error("[neovim] neovimAttach failed:", e));

    return () => {
      console.log("[neovim] cleanup — detaching");
      cancelled = true;
      unsubRedraw?.();
      handleRef.current = null;
      setHandle(null);
      bridge.neovimDetach().catch(console.error);
    };
  }, [cwd, cols, rows, putText, moveCursor, setGridSize]);

  return handle;
}
