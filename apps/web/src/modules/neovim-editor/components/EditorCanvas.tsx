import { useEffect, useMemo, useRef } from "react";
import type { CompositionEvent, KeyboardEvent } from "react";
import { measureCell } from "../font";
import { useEditorSize } from "../hooks/useEditorSize";
import { useNeovim } from "../hooks/useNeovim";
import { translateKey } from "../input";

export interface EditorCanvasProps {
  cwd: string;
}

export function EditorCanvas({ cwd }: EditorCanvasProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  // Cell metrics are stable for the lifetime of the page; memo so the
  // ResizeObserver effect inside `useEditorSize` doesn't re-bind.
  const cell = useMemo(() => measureCell(), []);
  const { cols, rows } = useEditorSize(containerRef, cell);

  const nvim = useNeovim(cwd, cols, rows, cell, canvasRef);

  // Push size changes to Neovim. Skipped until we have a handle (post-attach).
  const lastSizeRef = useRef({ cols: 0, rows: 0 });
  useEffect(() => {
    if (!nvim) return;
    if (cols < 1 || rows < 1) return;
    if (lastSizeRef.current.cols === cols && lastSizeRef.current.rows === rows) return;
    lastSizeRef.current = { cols, rows };
    nvim.uiTryResize(cols, rows);
  }, [nvim, cols, rows]);

  // Keep focus in the container so keydowns fire. Re-focus on click anywhere
  // in the editor surface — the canvas itself isn't tab-focusable.
  useEffect(() => {
    if (nvim) containerRef.current?.focus();
  }, [nvim]);

  function onKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    if (!nvim) return;
    // Skip while IME composition is active. The composed text arrives via
    // onCompositionEnd; a synthetic keydown with `keyCode == 229` may also
    // fire and must be ignored to avoid double-input.
    const native = e.nativeEvent;
    if (native.isComposing || native.keyCode === 229) return;

    const seq = translateKey(e);
    if (!seq) return;
    e.preventDefault();
    nvim.input(seq);
  }

  function onCompositionEnd(e: CompositionEvent<HTMLDivElement>) {
    if (!nvim || !e.data) return;
    nvim.input(e.data);
  }

  return (
    <div
      ref={containerRef}
      tabIndex={0}
      onKeyDown={onKeyDown}
      onCompositionEnd={onCompositionEnd}
      onMouseDown={() => containerRef.current?.focus()}
      style={{
        width: "100%",
        height: "100%",
        background: "#1e1e2e",
        outline: "none",
        overflow: "hidden",
      }}
    >
      <canvas ref={canvasRef} style={{ display: "block" }} />
    </div>
  );
}
