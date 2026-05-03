import { useMemo } from "react";

export function useGridSize(width: number, height: number) {
  const cellWidth = 10;
  const cellHeight = 18;

  const cols = useMemo(() => Math.floor(width / cellWidth), [width]);
  const rows = useMemo(() => Math.floor(height / cellHeight), [height]);

  return { cols, rows, cellWidth, cellHeight };
}
