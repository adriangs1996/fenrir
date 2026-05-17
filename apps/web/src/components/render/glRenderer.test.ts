import { describe, expect, it } from "vitest";
import { resolveBlockCursorGlyph } from "./glRenderer";

describe("resolveBlockCursorGlyph", () => {
  it("prefers the renderer grid cell over stale cursor.text", () => {
    const glyph = resolveBlockCursorGlyph(
      {
        gridId: 1,
        row: 0,
        col: 2,
        shape: "block",
        text: "e",
      },
      {
        cols: 4,
        rows: 1,
        cellChars: Uint32Array.from(["P", "O", "S", "T"].map((ch) => ch.codePointAt(0)!)),
        cellHl: Uint32Array.from([0, 0, 7, 0]),
      },
      [
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        { bold: true, italic: false },
      ],
    );

    expect(glyph).toEqual({
      cp: "S".codePointAt(0)!,
      bold: true,
      italic: false,
    });
  });

  it("falls back to cursor.text when the grid cell is unavailable", () => {
    const glyph = resolveBlockCursorGlyph(
      {
        gridId: 1,
        row: 4,
        col: 9,
        shape: "block",
        text: "e",
      },
      {
        cols: 4,
        rows: 1,
        cellChars: Uint32Array.from(["P", "O", "S", "T"].map((ch) => ch.codePointAt(0)!)),
        cellHl: Uint32Array.from([0, 0, 7, 0]),
      },
      [],
    );

    expect(glyph).toEqual({
      cp: "e".codePointAt(0)!,
      bold: false,
      italic: false,
    });
  });
});
