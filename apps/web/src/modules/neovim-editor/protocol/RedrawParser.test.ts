import { describe, expect, it } from "vitest";
import { parseRedrawBatch } from "./RedrawParser";

describe("parseRedrawBatch", () => {
  it("parses zero-arg events arriving with one empty arg-set", () => {
    const events = parseRedrawBatch([["flush", []]]);
    expect(events).toEqual([{ type: "flush" }]);
  });

  it("parses zero-arg events even when arg-sets array is empty", () => {
    const events = parseRedrawBatch([["flush"]]);
    expect(events).toEqual([{ type: "flush" }]);
  });

  it("expands repeated arg-sets within one event group", () => {
    const events = parseRedrawBatch([["grid_cursor_goto", [1, 0, 0], [1, 1, 5]]]);
    expect(events).toEqual([
      { type: "grid_cursor_goto", row: 0, col: 0 },
      { type: "grid_cursor_goto", row: 1, col: 5 },
    ]);
  });

  it("drops events for grids other than the primary grid", () => {
    const events = parseRedrawBatch([["grid_clear", [1], [2], [99]]]);
    expect(events).toEqual([{ type: "grid_clear" }]);
  });

  it("propagates the previous hl_id when a cell omits its hl_id", () => {
    const events = parseRedrawBatch([["grid_line", [1, 0, 0, [["a", 7], ["b"], ["c", 0], ["d"]]]]]);
    expect(events).toEqual([
      {
        type: "grid_line",
        row: 0,
        colStart: 0,
        cells: [
          { text: "a", hlId: 7, repeat: 1 },
          { text: "b", hlId: 7, repeat: 1 },
          { text: "c", hlId: 0, repeat: 1 },
          { text: "d", hlId: 0, repeat: 1 },
        ],
      },
    ]);
  });

  it("respects the repeat field on grid_line cells", () => {
    const events = parseRedrawBatch([["grid_line", [1, 5, 2, [[" ", 0, 10]]]]]);
    expect(events[0]).toMatchObject({
      type: "grid_line",
      row: 5,
      colStart: 2,
      cells: [{ text: " ", hlId: 0, repeat: 10 }],
    });
  });

  it("parses mode_info_set and snake_cases the keys", () => {
    const events = parseRedrawBatch([
      [
        "mode_info_set",
        [
          true,
          [
            {
              cursor_shape: "block",
              cell_percentage: 100,
              blinkwait: 700,
              blinkon: 400,
              blinkoff: 250,
              attr_id: 0,
              name: "normal",
            },
            {
              cursor_shape: "vertical",
              cell_percentage: 25,
              attr_id: 0,
              name: "insert",
            },
          ],
        ],
      ],
    ]);
    expect(events).toHaveLength(1);
    const ev = events[0]!;
    if (ev.type !== "mode_info_set") throw new Error("wrong type");
    expect(ev.modeInfo).toHaveLength(2);
    expect(ev.modeInfo[0]).toMatchObject({
      cursorShape: "block",
      cellPercentage: 100,
      name: "normal",
    });
    expect(ev.modeInfo[1]).toMatchObject({
      cursorShape: "vertical",
      cellPercentage: 25,
      name: "insert",
    });
  });

  it("parses default_colors_set with raw RGB integers", () => {
    const events = parseRedrawBatch([["default_colors_set", [0xcdd6f4, 0x1e1e2e, 0xf38ba8, 0, 0]]]);
    expect(events[0]).toEqual({
      type: "default_colors_set",
      rgbFg: 0xcdd6f4,
      rgbBg: 0x1e1e2e,
      rgbSp: 0xf38ba8,
    });
  });

  it("ignores unknown event types without throwing", () => {
    const events = parseRedrawBatch([["i_made_this_up", [1, 2, 3]]]);
    expect(events).toEqual([]);
  });

  it("handles malformed input defensively", () => {
    expect(parseRedrawBatch([null, undefined, [], [123], "garbage"] as unknown[])).toEqual([]);
  });
});
