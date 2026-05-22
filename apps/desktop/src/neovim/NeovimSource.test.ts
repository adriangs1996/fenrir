import { describe, expect, it, vi } from "vitest";

vi.mock("electron", () => ({
  app: {
    getPath: vi.fn(() => "/tmp/fenrir-test"),
  },
}));

import { domKeyToVimNotation, NeovimSource } from "./NeovimSource";

function createSource(): NeovimSource {
  return new NeovimSource("/tmp/project");
}

function applyEvent(source: NeovimSource, name: string, args: unknown[]): void {
  (source as any).applyEvent(name, args);
}

function buildFrame(source: NeovimSource) {
  return (source as any).buildFrame();
}

describe("NeovimSource", () => {
  it("pastes clipboard text through nvim_paste", () => {
    const source = createSource();
    const request = vi.fn().mockResolvedValue(true);
    (source as any).client = { request };
    (source as any).started = true;

    source.handleInput({ kind: "paste", text: "console.log('hi')\n" });

    expect(request).toHaveBeenCalledWith("nvim_paste", ["console.log('hi')\n", false, -1]);
  });

  it("emits binary grid deltas preserving supplementary-plane glyphs", () => {
    const source = createSource();

    applyEvent(source, "grid_resize", [1, 4, 1]);
    applyEvent(source, "grid_line", [
      1,
      0,
      0,
      [
        ["a", 1],
        [" ", 1],
        ["😀", 1],
        ["b", 2],
      ],
    ]);

    const frame = buildFrame(source);

    expect(frame?.gridDeltas).toEqual([
      {
        gridId: 1,
        cols: 4,
        rowIndexes: Uint32Array.from([0]),
        cellChars: Uint32Array.from(["a", " ", "😀", "b"].map((ch) => ch.codePointAt(0)!)),
        cellHl: Uint32Array.from([1, 1, 1, 2]),
      },
    ]);
  });

  it("emits scrolled rows with the same visible contents after follow-up updates", () => {
    const source = createSource();

    applyEvent(source, "grid_resize", [1, 3, 3]);
    applyEvent(source, "grid_line", [1, 0, 0, [["a", 1, 3]]]);
    applyEvent(source, "grid_line", [1, 1, 0, [["b", 2, 3]]]);
    applyEvent(source, "grid_line", [1, 2, 0, [["c", 3, 3]]]);
    buildFrame(source);

    applyEvent(source, "grid_scroll", [1, 0, 3, 0, 3, 1]);
    applyEvent(source, "grid_line", [1, 2, 0, [[" ", 0, 3]]]);

    const frame = buildFrame(source);

    expect(frame?.gridDeltas).toEqual([
      {
        gridId: 1,
        cols: 3,
        rowIndexes: Uint32Array.from([0, 1, 2]),
        cellChars: Uint32Array.from(
          ["b", "b", "b", "c", "c", "c", " ", " ", " "].map((ch) => ch.codePointAt(0)!),
        ),
        cellHl: Uint32Array.from([2, 2, 2, 3, 3, 3, 0, 0, 0]),
      },
    ]);
  });

  it("keeps cursor text intact for supplementary-plane glyphs", () => {
    const source = createSource();

    applyEvent(source, "grid_resize", [1, 1, 1]);
    applyEvent(source, "grid_line", [1, 0, 0, [["😀", 7]]]);
    applyEvent(source, "grid_cursor_goto", [1, 0, 0]);

    const frame = buildFrame(source);

    expect(frame?.cursor).toEqual({
      gridId: 1,
      row: 0,
      col: 0,
      shape: "block",
      text: "😀",
    });
  });

  it("does not let win_pos change the grid stride before grid_resize arrives", () => {
    const source = createSource();

    applyEvent(source, "grid_resize", [1, 4, 2]);
    applyEvent(source, "grid_line", [1, 0, 0, [["a", 1, 4]]]);
    applyEvent(source, "grid_line", [1, 1, 0, [["b", 2, 4]]]);
    buildFrame(source);

    // Opening a split can move/resize the window before the backing grid is
    // actually resized. `win_pos` must not change the typed-array stride.
    applyEvent(source, "win_pos", [1, null, 0, 0, 2, 2]);
    applyEvent(source, "grid_line", [1, 1, 0, [["c", 3, 4]]]);

    const frame = buildFrame(source);

    expect(frame?.gridDeltas).toEqual([
      {
        gridId: 1,
        cols: 4,
        rowIndexes: Uint32Array.from([1]),
        cellChars: Uint32Array.from(["c", "c", "c", "c"].map((ch) => ch.codePointAt(0)!)),
        cellHl: Uint32Array.from([3, 3, 3, 3]),
      },
    ]);
  });

  it("keeps cursor text correct after split-style win_pos updates", () => {
    const source = createSource();

    applyEvent(source, "grid_resize", [1, 4, 2]);
    applyEvent(source, "grid_line", [
      1,
      0,
      0,
      [
        ["r", 1],
        ["e", 1],
        ["s", 1],
        ["p", 1],
      ],
    ]);
    applyEvent(source, "grid_line", [
      1,
      1,
      0,
      [
        ["P", 2],
        ["O", 2],
        ["S", 2],
        ["T", 2],
      ],
    ]);
    buildFrame(source);

    // Simulate the default editor window being moved into a narrower split
    // before nvim sends any backing-grid resize.
    applyEvent(source, "win_pos", [1, null, 0, 0, 2, 2]);
    applyEvent(source, "grid_cursor_goto", [1, 1, 2]);

    const frame = buildFrame(source);

    expect(frame?.cursor).toEqual({
      gridId: 1,
      row: 1,
      col: 2,
      shape: "block",
      text: "S",
    });
  });
});

describe("domKeyToVimNotation", () => {
  it("maps Cmd+V to a nvim meta chord", () => {
    expect(
      domKeyToVimNotation("v", "KeyV", {
        ctrl: false,
        alt: false,
        shift: false,
        meta: true,
      }),
    ).toBe("<D-v>");
  });

  it("uses event.code for Alt dead-key chords", () => {
    expect(
      domKeyToVimNotation("Dead", "KeyE", {
        ctrl: false,
        alt: true,
        shift: false,
        meta: false,
      }),
    ).toBe("<A-e>");
  });
});
