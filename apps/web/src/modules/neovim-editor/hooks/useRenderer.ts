import { useEffect } from "react";
import { useNeovimStore } from "../stores/neovimStore";

export function useRenderer(canvasRef: React.RefObject<HTMLCanvasElement | null>) {
  const grid = useNeovimStore((s) => s.grid);
  const cursor = useNeovimStore((s) => s.cursor);
  const rows = useNeovimStore((s) => s.rows);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext("2d")!;
    ctx.font = "14px monospace";

    const cellWidth = 10;
    const cellHeight = 18;

    ctx.clearRect(0, 0, canvas.width, canvas.height);

    ctx.fillStyle = "#cccccc";
    for (let row = 0; row < rows; row++) {
      const line = grid[row]?.map((c) => c.text).join("") ?? "";
      ctx.fillText(line, 0, row * cellHeight + cellHeight - 3);
    }

    ctx.fillStyle = "rgba(255,255,255,0.3)";
    ctx.fillRect(cursor.col * cellWidth, cursor.row * cellHeight, cellWidth, cellHeight);
  }, [grid, cursor, rows, canvasRef]);
}
