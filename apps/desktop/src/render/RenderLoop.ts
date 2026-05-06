import type { DrawOp, Frame, InputEvent } from "@fenrir/contracts";

export interface SceneSource {
  readonly kind: string;
  handleInput(event: InputEvent): void;
  render(seq: number, dtMs: number): DrawOp[];
}

export interface RenderLoopOptions {
  fps?: number;
  initialViewport?: { w: number; h: number };
  emit: (frame: Frame) => void;
}

const MIN_FPS = 1;
const MAX_FPS = 240;

export class RenderLoop {
  private fps: number;
  private viewport: { w: number; h: number };
  private readonly emit: (frame: Frame) => void;

  private source: SceneSource | null = null;
  private running = false;
  private seq = 0;
  private last = 0;
  private timer: NodeJS.Timeout | null = null;

  constructor(opts: RenderLoopOptions) {
    this.fps = clamp(opts.fps ?? 120, MIN_FPS, MAX_FPS);
    this.viewport = opts.initialViewport ?? { w: 800, h: 600 };
    this.emit = opts.emit;
  }

  setFps(fps: number): void {
    this.fps = clamp(fps, MIN_FPS, MAX_FPS);
  }

  getFps(): number {
    return this.fps;
  }

  setSource(source: SceneSource | null): void {
    this.source = source;
  }

  setViewport(w: number, h: number): void {
    this.viewport = { w, h };
  }

  pushInput(event: InputEvent): void {
    if (event.kind === "resize") this.setViewport(event.w, event.h);
    this.source?.handleInput(event);
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.last = performance.now();
    this.scheduleNext(0);
  }

  stop(): void {
    this.running = false;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }

  isRunning(): boolean {
    return this.running;
  }

  private tick = (): void => {
    if (!this.running) return;
    const tickStart = performance.now();
    const dt = tickStart - this.last;
    this.last = tickStart;

    let ops: DrawOp[] = [];
    if (this.source) {
      try {
        ops = this.source.render(this.seq, dt);
      } catch (err) {
        console.error("[render] source.render threw:", err);
        ops = [];
      }
    }

    if (ops.length > 0 && this.source) {
      const frame: Frame = {
        seq: this.seq++,
        kind: this.source.kind,
        w: this.viewport.w,
        h: this.viewport.h,
        ops,
      };
      try {
        this.emit(frame);
      } catch (err) {
        console.error("[render] emit threw:", err);
      }
    }

    const elapsed = performance.now() - tickStart;
    const target = 1000 / this.fps;
    this.scheduleNext(Math.max(0, target - elapsed));
  };

  private scheduleNext(delayMs: number): void {
    if (!this.running) return;
    this.timer = setTimeout(this.tick, delayMs);
  }
}

function clamp(n: number, lo: number, hi: number): number {
  if (Number.isNaN(n)) return lo;
  return Math.max(lo, Math.min(hi, n));
}
