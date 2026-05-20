import { describe, expect, it, vi } from "vitest";

import { getSpecialGlyphFillRects, rasterizeSpecialGlyph } from "./specialGlyphs";

function createPathContextSpy() {
  return {
    beginPath: vi.fn(),
    closePath: vi.fn(),
    moveTo: vi.fn(),
    lineTo: vi.fn(),
    ellipse: vi.fn(),
    fill: vi.fn(),
    fillRect: vi.fn(),
  } as unknown as CanvasRenderingContext2D;
}

describe("getSpecialGlyphFillRects", () => {
  it("renders left block guides edge-to-edge vertically", () => {
    expect(getSpecialGlyphFillRects(0x258f, 8, 16)).toEqual([
      {
        x: 0,
        y: 0,
        width: 1,
        height: 16,
      },
    ]);
  });

  it("renders vertical box-drawing guides across the full cell height", () => {
    expect(getSpecialGlyphFillRects(0x2502, 10, 18)).toEqual([
      {
        x: 4.5,
        y: 0,
        width: 1,
        height: 18,
      },
    ]);
  });

  it("renders dashed vertical box-drawing guides as multiple full-height segments", () => {
    expect(getSpecialGlyphFillRects(0x250a, 8, 14)).toEqual([
      {
        x: 3.5,
        y: 0,
        width: 1,
        height: 2,
      },
      {
        x: 3.5,
        y: 4,
        width: 1,
        height: 2,
      },
      {
        x: 3.5,
        y: 8,
        width: 1,
        height: 2,
      },
      {
        x: 3.5,
        y: 12,
        width: 1,
        height: 2,
      },
    ]);
  });
});

describe("rasterizeSpecialGlyph", () => {
  it("rasterizes rounded box corners as stroked arcs that reach cell edges", () => {
    const cases = [
      {
        cp: 0x256d,
        expectedMoveTo: [14, 15],
        expectedLineTo: [9, 24],
      },
      {
        cp: 0x256e,
        expectedMoveTo: [4, 15],
        expectedLineTo: [9, 24],
      },
      {
        cp: 0x256f,
        expectedMoveTo: [4, 15],
        expectedLineTo: [9, 6],
      },
      {
        cp: 0x2570,
        expectedMoveTo: [14, 15],
        expectedLineTo: [9, 6],
      },
    ] as const;

    for (const { cp, expectedMoveTo, expectedLineTo } of cases) {
      const ops: unknown[][] = [];
      const ctx = {
        fillStyle: "#ffffff",
        set strokeStyle(value: string | CanvasGradient | CanvasPattern) {
          ops.push(["strokeStyle", value]);
        },
        set lineWidth(value: number) {
          ops.push(["lineWidth", value]);
        },
        set lineCap(value: CanvasLineCap) {
          ops.push(["lineCap", value]);
        },
        set lineJoin(value: CanvasLineJoin) {
          ops.push(["lineJoin", value]);
        },
        beginPath() {
          ops.push(["beginPath"]);
        },
        moveTo(x: number, y: number) {
          ops.push(["moveTo", x, y]);
        },
        arcTo(x1: number, y1: number, x2: number, y2: number, radius: number) {
          ops.push(["arcTo", x1, y1, x2, y2, radius]);
        },
        lineTo(x: number, y: number) {
          ops.push(["lineTo", x, y]);
        },
        stroke() {
          ops.push(["stroke"]);
        },
      } as unknown as CanvasRenderingContext2D;

      expect(rasterizeSpecialGlyph(ctx, cp, 4, 6, 10, 18)).toBe(true);
      expect(ops).toEqual([
        ["strokeStyle", "#ffffff"],
        ["lineWidth", 1],
        ["lineCap", "butt"],
        ["lineJoin", "round"],
        ["beginPath"],
        ["moveTo", ...expectedMoveTo],
        ["arcTo", 9, 15, ...expectedLineTo, 3],
        ["lineTo", ...expectedLineTo],
        ["stroke"],
      ]);
    }
  });

  it("procedurally rasterizes rounded powerline separators", () => {
    const ctx = createPathContextSpy();

    const handled = rasterizeSpecialGlyph(ctx, 0xe0b4, 0, 0, 10, 20);

    expect(handled).toBe(true);
    expect(ctx.beginPath).toHaveBeenCalledOnce();
    expect(ctx.moveTo).toHaveBeenCalledWith(0, 0);
    expect(ctx.ellipse).toHaveBeenCalledWith(0, 10, 10, 10, 0, -Math.PI / 2, Math.PI / 2);
    expect(ctx.fill).toHaveBeenCalledOnce();
  });

  it("procedurally rasterizes triangular powerline separators", () => {
    const ctx = createPathContextSpy();

    const handled = rasterizeSpecialGlyph(ctx, 0xe0b0, 2, 4, 12, 18);

    expect(handled).toBe(true);
    expect(ctx.beginPath).toHaveBeenCalledOnce();
    expect(ctx.moveTo).toHaveBeenCalledWith(2, 4);
    expect(ctx.lineTo).toHaveBeenNthCalledWith(1, 14, 13);
    expect(ctx.lineTo).toHaveBeenNthCalledWith(2, 2, 22);
    expect(ctx.fill).toHaveBeenCalledOnce();
  });
});
