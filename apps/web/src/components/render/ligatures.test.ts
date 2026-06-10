import { describe, expect, it } from "vitest";

import { findLigatureMatch } from "./ligatures";

function cps(text: string): Uint32Array {
  return Uint32Array.from(Array.from(text, (char) => char.codePointAt(0)!));
}

describe("findLigatureMatch", () => {
  it("prefers the longest ligature candidate at a column", () => {
    const cellChars = cps("!===");
    const cellHl = Uint32Array.from([7, 7, 7, 7]);

    expect(findLigatureMatch(cellChars, cellHl, 0, cellChars.length, 0)).toEqual({
      id: 0,
      text: "!==",
      span: 3,
    });
    expect(findLigatureMatch(cellChars, cellHl, 0, cellChars.length, 1)).toEqual({
      id: 1,
      text: "===",
      span: 3,
    });
  });

  it("rejects runs that cross highlight boundaries", () => {
    const cellChars = cps("=>");
    const cellHl = Uint32Array.from([1, 2]);

    expect(findLigatureMatch(cellChars, cellHl, 0, cellChars.length, 0)).toBeNull();
  });

  it("returns null for non-ligature text", () => {
    const cellChars = cps("ab");
    const cellHl = Uint32Array.from([0, 0]);

    expect(findLigatureMatch(cellChars, cellHl, 0, cellChars.length, 0)).toBeNull();
  });
});
