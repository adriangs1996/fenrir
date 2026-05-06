import type { DrawOp, InputEvent } from "@fenrir/contracts";
import type { SceneSource } from "../RenderLoop";

const SQUARE_SIZE = 80;
const BASE_SPEED = 280; // px/sec
const KEY_BOOST = 600;

export class DemoSource implements SceneSource {
  readonly kind = "demo";

  private viewport = { w: 800, h: 600 };
  private pos = { x: 100, y: 100 };
  private vel = { x: BASE_SPEED, y: BASE_SPEED * 0.7 };
  private color = "#5ac8fa";
  private fpsSample = 0;
  private fpsAccum = 0;
  private fpsFrames = 0;
  private inputHint = "";
  private mouseHover: { x: number; y: number } | null = null;

  handleInput(event: InputEvent): void {
    if (event.kind === "resize") {
      this.viewport = { w: event.w, h: event.h };
      this.pos.x = Math.min(this.pos.x, Math.max(0, event.w - SQUARE_SIZE));
      this.pos.y = Math.min(this.pos.y, Math.max(0, event.h - SQUARE_SIZE));
      return;
    }
    if (event.kind === "key" && event.type === "down") {
      this.inputHint = `key:${event.key}`;
      switch (event.key) {
        case "ArrowLeft":
          this.vel.x = -KEY_BOOST;
          break;
        case "ArrowRight":
          this.vel.x = KEY_BOOST;
          break;
        case "ArrowUp":
          this.vel.y = -KEY_BOOST;
          break;
        case "ArrowDown":
          this.vel.y = KEY_BOOST;
          break;
        case " ":
          this.color = randomColor();
          break;
      }
      return;
    }
    if (event.kind === "mouse") {
      this.mouseHover = { x: event.x, y: event.y };
      if (event.type === "down") {
        this.pos.x = Math.max(
          0,
          Math.min(this.viewport.w - SQUARE_SIZE, event.x - SQUARE_SIZE / 2),
        );
        this.pos.y = Math.max(
          0,
          Math.min(this.viewport.h - SQUARE_SIZE, event.y - SQUARE_SIZE / 2),
        );
        this.inputHint = `mouse:${event.button ?? 0}`;
      }
    }
  }

  render(seq: number, dtMs: number): DrawOp[] {
    const dt = Math.min(dtMs, 100) / 1000; // cap dt to avoid teleport on long pauses

    this.pos.x += this.vel.x * dt;
    this.pos.y += this.vel.y * dt;

    if (this.pos.x <= 0) {
      this.pos.x = 0;
      this.vel.x = Math.abs(this.vel.x);
    } else if (this.pos.x + SQUARE_SIZE >= this.viewport.w) {
      this.pos.x = this.viewport.w - SQUARE_SIZE;
      this.vel.x = -Math.abs(this.vel.x);
    }
    if (this.pos.y <= 0) {
      this.pos.y = 0;
      this.vel.y = Math.abs(this.vel.y);
    } else if (this.pos.y + SQUARE_SIZE >= this.viewport.h) {
      this.pos.y = this.viewport.h - SQUARE_SIZE;
      this.vel.y = -Math.abs(this.vel.y);
    }

    // ease velocity back toward base after key boost
    this.vel.x = decayToward(this.vel.x, signed(this.vel.x, BASE_SPEED), dt * 1.5);
    this.vel.y = decayToward(this.vel.y, signed(this.vel.y, BASE_SPEED * 0.7), dt * 1.5);

    this.fpsAccum += dtMs;
    this.fpsFrames += 1;
    if (this.fpsAccum >= 500) {
      this.fpsSample = (this.fpsFrames * 1000) / this.fpsAccum;
      this.fpsAccum = 0;
      this.fpsFrames = 0;
    }

    const ops: DrawOp[] = [
      { op: "clear", color: "#0e0f13" },
      {
        op: "fillRect",
        x: this.pos.x,
        y: this.pos.y,
        w: SQUARE_SIZE,
        h: SQUARE_SIZE,
        color: this.color,
      },
      {
        op: "text",
        x: 16,
        y: 24,
        text: `frame ${seq} | ${this.fpsSample.toFixed(1)} fps | ${this.viewport.w}x${this.viewport.h}`,
        color: "#e8e8ea",
        font: "14px ui-monospace, SFMono-Regular, Menlo, monospace",
        baseline: "top",
      },
      {
        op: "text",
        x: 16,
        y: 44,
        text: this.inputHint
          ? `last input: ${this.inputHint}`
          : "arrows = boost · space = recolor · click = teleport",
        color: "#9aa0a6",
        font: "12px ui-monospace, SFMono-Regular, Menlo, monospace",
        baseline: "top",
      },
    ];

    if (this.mouseHover) {
      ops.push({
        op: "fillRect",
        x: this.mouseHover.x - 3,
        y: this.mouseHover.y - 3,
        w: 6,
        h: 6,
        color: "#ff453a",
      });
    }

    return ops;
  }
}

function decayToward(value: number, target: number, t: number): number {
  const k = Math.min(1, Math.max(0, t));
  return value + (target - value) * k;
}

function signed(value: number, magnitude: number): number {
  return value >= 0 ? magnitude : -magnitude;
}

function randomColor(): string {
  const palette = ["#5ac8fa", "#ff9f0a", "#bf5af2", "#30d158", "#ff375f", "#ffd60a"];
  return palette[Math.floor(Math.random() * palette.length)] ?? "#5ac8fa";
}
