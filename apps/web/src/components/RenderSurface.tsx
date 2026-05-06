import { useEffect, useRef, useState } from "react";
import type { DrawOp, Frame, InputModifiers } from "@fenrir/contracts";

interface RenderSurfaceProps {
  fps?: number;
  className?: string;
  style?: React.CSSProperties;
}

export function RenderSurface({
  fps = 120,
  className,
  style,
}: RenderSurfaceProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const lastFrameRef = useRef<Frame | null>(null);
  const rafRef = useRef<number | null>(null);
  const profileRef = useRef({
    start: performance.now(),
    frames: 0,
    ops: 0,
    paintMs: 0,
  });
  const [bridgeMissing, setBridgeMissing] = useState(false);

  useEffect(() => {
    const bridge = window.desktopBridge;
    if (!bridge) {
      setBridgeMissing(true);
      return;
    }

    const off = bridge.onFrame((frame) => {
      lastFrameRef.current = frame;
      if (rafRef.current === null) {
        rafRef.current = requestAnimationFrame(paint);
      }
    });

    void bridge.renderSetFps(fps);
    void bridge.renderStart();

    return () => {
      off();
      void bridge.renderStop();
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
    };
  }, [fps]);

  useEffect(() => {
    const bridge = window.desktopBridge;
    const container = containerRef.current;
    if (!bridge || !container) return;

    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) return;
      const { width, height } = entry.contentRect;
      const dpr = window.devicePixelRatio || 1;
      const w = Math.max(1, Math.floor(width));
      const h = Math.max(1, Math.floor(height));
      const canvas = canvasRef.current;
      if (canvas) {
        canvas.width = Math.floor(w * dpr);
        canvas.height = Math.floor(h * dpr);
        canvas.style.width = `${w}px`;
        canvas.style.height = `${h}px`;
      }
      bridge.sendInput({ kind: "resize", w, h });
      // force a repaint of the last frame at the new size
      if (lastFrameRef.current && rafRef.current === null) {
        rafRef.current = requestAnimationFrame(paint);
      }
    });
    observer.observe(container);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    const bridge = window.desktopBridge;
    if (!canvas || !bridge) return;

    const mods = (
      e: KeyboardEvent | MouseEvent | WheelEvent,
    ): InputModifiers => ({
      ctrl: e.ctrlKey,
      alt: e.altKey,
      shift: e.shiftKey,
      meta: e.metaKey,
    });

    const onKeyDown = (e: KeyboardEvent) => {
      bridge.sendInput({
        kind: "key",
        type: "down",
        key: e.key,
        code: e.code,
        mods: mods(e),
      });
      e.preventDefault();
    };
    const onKeyUp = (e: KeyboardEvent) => {
      bridge.sendInput({
        kind: "key",
        type: "up",
        key: e.key,
        code: e.code,
        mods: mods(e),
      });
    };

    const localXY = (e: MouseEvent) => {
      const rect = canvas.getBoundingClientRect();
      return { x: e.clientX - rect.left, y: e.clientY - rect.top };
    };
    const buttonOf = (n: number): 0 | 1 | 2 => (n === 1 ? 1 : n === 2 ? 2 : 0);

    const onMouseDown = (e: MouseEvent) => {
      canvas.focus();
      const { x, y } = localXY(e);
      bridge.sendInput({
        kind: "mouse",
        type: "down",
        x,
        y,
        button: buttonOf(e.button),
        mods: mods(e),
      });
    };
    const onMouseUp = (e: MouseEvent) => {
      const { x, y } = localXY(e);
      bridge.sendInput({
        kind: "mouse",
        type: "up",
        x,
        y,
        button: buttonOf(e.button),
        mods: mods(e),
      });
    };
    const onMouseMove = (e: MouseEvent) => {
      const { x, y } = localXY(e);
      bridge.sendInput({ kind: "mouse", type: "move", x, y, mods: mods(e) });
    };
    const onWheel = (e: WheelEvent) => {
      const { x, y } = localXY(e);
      bridge.sendInput({
        kind: "mouse",
        type: "wheel",
        x,
        y,
        deltaX: e.deltaX,
        deltaY: e.deltaY,
        mods: mods(e),
      });
      e.preventDefault();
    };

    canvas.addEventListener("keydown", onKeyDown);
    canvas.addEventListener("keyup", onKeyUp);
    canvas.addEventListener("mousedown", onMouseDown);
    canvas.addEventListener("mouseup", onMouseUp);
    canvas.addEventListener("mousemove", onMouseMove);
    canvas.addEventListener("wheel", onWheel, { passive: false });
    return () => {
      canvas.removeEventListener("keydown", onKeyDown);
      canvas.removeEventListener("keyup", onKeyUp);
      canvas.removeEventListener("mousedown", onMouseDown);
      canvas.removeEventListener("mouseup", onMouseUp);
      canvas.removeEventListener("mousemove", onMouseMove);
      canvas.removeEventListener("wheel", onWheel);
    };
  }, []);

  const paint = () => {
    rafRef.current = null;
    const canvas = canvasRef.current;
    const frame = lastFrameRef.current;
    if (!canvas || !frame) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const t0 = performance.now();
    const dpr = window.devicePixelRatio || 1;
    const cssW = canvas.width / dpr;
    const cssH = canvas.height / dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    // scale source frame coords to canvas css size
    const sx = frame.w > 0 ? cssW / frame.w : 1;
    const sy = frame.h > 0 ? cssH / frame.h : 1;
    for (const op of frame.ops) {
      applyOp(ctx, op, sx, sy, cssW, cssH);
    }
    const t1 = performance.now();
    const p = profileRef.current;
    p.frames += 1;
    p.ops += frame.ops.length;
    p.paintMs += t1 - t0;
    if (t1 - p.start >= 1000) {
      console.log(
        `[renderSurface] ${(t1 - p.start).toFixed(0)}ms` +
          ` frames=${p.frames} ops=${p.ops}` +
          ` paint=${p.paintMs.toFixed(2)}ms`,
      );
      p.start = t1;
      p.frames = 0;
      p.ops = 0;
      p.paintMs = 0;
    }
  };

  if (bridgeMissing) {
    return (
      <div className={className} style={style}>
        <p>Render bridge unavailable (web mode).</p>
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      className={className}
      style={{ width: "100%", height: "100%", ...style }}
    >
      <canvas
        ref={canvasRef}
        tabIndex={0}
        style={{ display: "block", outline: "none", background: "#000" }}
      />
    </div>
  );
}

function applyOp(
  ctx: CanvasRenderingContext2D,
  op: DrawOp,
  sx: number,
  sy: number,
  cssW: number,
  cssH: number,
): void {
  switch (op.op) {
    case "clear":
      ctx.fillStyle = op.color;
      ctx.fillRect(0, 0, cssW, cssH);
      return;
    case "fillRect":
      ctx.fillStyle = op.color;
      ctx.fillRect(op.x * sx, op.y * sy, op.w * sx, op.h * sy);
      return;
    case "text":
      ctx.fillStyle = op.color;
      if (op.font) ctx.font = op.font;
      if (op.baseline) ctx.textBaseline = op.baseline;
      ctx.fillText(op.text, op.x * sx, op.y * sy);
      return;
  }
}
