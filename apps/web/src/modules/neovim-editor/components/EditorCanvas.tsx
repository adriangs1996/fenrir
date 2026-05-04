import { useEffect, useRef } from "react";
import { useContainerSize } from "../hooks/useContainerSize";
import { useGridSize } from "../hooks/useGridSize";
import { useResize } from "../hooks/useResize";
import { useInput } from "../hooks/useInput";
import { useNeovim } from "../hooks/useNeovim";
import { DebugOverlay } from "../debug/DebugOverlay";
import { setFocus } from "../debug/debug";

interface EditorCanvasProps {
  cwd: string;
}

export function EditorCanvas({ cwd }: EditorCanvasProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const { width, height } = useContainerSize(containerRef);
  const { cols, rows, cellWidth, cellHeight } = useGridSize(width, height);

  const nvim = useNeovim(cwd, cols, rows, canvasRef);
  const { onKeyDown } = useInput(nvim);

  useResize(nvim, cols, rows);

  useEffect(() => {
    if (nvim) containerRef.current?.focus();
  }, [nvim]);

  return (
    <div
      ref={containerRef}
      style={{ width: "100%", height: "100%", background: "#1e1e2e", overflow: "hidden" }}
      tabIndex={0}
      onKeyDown={onKeyDown}
      onFocus={() => setFocus(true)}
      onBlur={() => setFocus(false)}
    >
      <canvas
        ref={canvasRef}
        width={cols * cellWidth}
        height={rows * cellHeight}
        style={{ display: "block" }}
      />
      <DebugOverlay />
    </div>
  );
}
