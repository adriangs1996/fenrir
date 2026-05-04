import { useEffect, useState } from "react";
import type { CellMetrics } from "../font";

interface EditorSize {
  /** CSS pixels — drives the canvas style size. */
  cssWidth: number;
  cssHeight: number;
  /** Grid columns/rows derived by flooring CSS size by cell metrics. */
  cols: number;
  rows: number;
}

const RESIZE_DEBOUNCE_MS = 60;
const MIN_COLS = 10;
const MIN_ROWS = 3;

/**
 * Observe the container's CSS size and translate it into grid columns / rows.
 * Debounced so animated layout transitions (sidebar toggle, etc.) don't burn
 * an `nvim_ui_try_resize` per intermediate frame.
 */
export function useEditorSize(
  ref: React.RefObject<HTMLElement | null>,
  cell: CellMetrics,
): EditorSize {
  const [size, setSize] = useState<EditorSize>({
    cssWidth: 0,
    cssHeight: 0,
    cols: 0,
    rows: 0,
  });

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    let timer: ReturnType<typeof setTimeout> | null = null;
    let last: { w: number; h: number } | null = null;

    const apply = () => {
      timer = null;
      if (!last) return;
      const cols = Math.max(MIN_COLS, Math.floor(last.w / cell.width));
      const rows = Math.max(MIN_ROWS, Math.floor(last.h / cell.height));
      setSize((prev) =>
        prev.cssWidth === last!.w &&
        prev.cssHeight === last!.h &&
        prev.cols === cols &&
        prev.rows === rows
          ? prev
          : { cssWidth: last!.w, cssHeight: last!.h, cols, rows },
      );
    };

    const observer = new ResizeObserver(([entry]) => {
      if (!entry) return;
      last = { w: entry.contentRect.width, h: entry.contentRect.height };
      if (timer !== null) clearTimeout(timer);
      timer = setTimeout(apply, RESIZE_DEBOUNCE_MS);
    });
    observer.observe(el);

    return () => {
      observer.disconnect();
      if (timer !== null) clearTimeout(timer);
    };
  }, [ref, cell.width, cell.height]);

  return size;
}
