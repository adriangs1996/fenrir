import { describe, expect, it } from "vitest";

import { getSpecialGlyphFillRects } from "./specialGlyphs";

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
