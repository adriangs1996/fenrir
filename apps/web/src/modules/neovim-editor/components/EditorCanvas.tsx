import { useEffect, useRef } from "react";
import { useContainerSize } from "../hooks/useContainerSize";
import { useGridSize } from "../hooks/useGridSize";
import { useResize } from "../hooks/useResize";
import { useRenderer } from "../hooks/useRenderer";
import { useInput } from "../hooks/useInput";
import { useNeovim } from "../hooks/useNeovim";

interface EditorCanvasProps {
  cwd: string;
}

export function EditorCanvas({ cwd }: EditorCanvasProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const { width, height } = useContainerSize(containerRef);
  const { cols, rows, cellWidth, cellHeight } = useGridSize(width, height);

  const nvim = useNeovim(cwd, cols, rows);
  const { onKeyDown } = useInput(nvim);

  useEffect(() => {
    if (nvim) containerRef.current?.focus();
  }, [nvim]);

  useResize(nvim, cols, rows);
  useRenderer(canvasRef);

  return (
    <div
      ref={containerRef}
      style={{ width: "100%", height: "100%", background: "#1e1e1e" }}
      tabIndex={0}
      onKeyDown={onKeyDown}
    >
      <canvas
        ref={canvasRef}
        width={cols * cellWidth}
        height={rows * cellHeight}
        style={{ display: "block" }}
      />
    </div>
  );
}
