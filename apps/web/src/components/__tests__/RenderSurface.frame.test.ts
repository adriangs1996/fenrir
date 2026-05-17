import { describe, expect, it, vi } from "vitest";
import type { Frame } from "@fenrir/contracts";
import { applyFrame } from "../RenderSurface";
import type { GLRenderer } from "../render/glRenderer";

function createRendererMock() {
  return {
    setCellMetrics: vi.fn(),
    upsertHl: vi.fn(),
    setDefaultColors: vi.fn(),
    ensureGrid: vi.fn(),
    removeGrid: vi.fn(),
    updateRows: vi.fn(),
    setWindows: vi.fn(),
    setCursor: vi.fn(),
  } as unknown as GLRenderer & {
    updateRows: ReturnType<typeof vi.fn>;
  };
}

describe("applyFrame", () => {
  it("forwards binary grid deltas to the renderer", () => {
    const renderer = createRendererMock();
    const rowIndexes = Uint32Array.from([1, 3]);
    const cellChars = Uint32Array.from(["a", "b", "😀", " "].map((ch) => ch.codePointAt(0)!));
    const cellHl = Uint32Array.from([1, 1, 2, 0]);
    const frame: Frame = {
      kind: "neovim",
      seq: 7,
      gridDeltas: [
        {
          gridId: 9,
          cols: 2,
          rowIndexes,
          cellChars,
          cellHl,
        },
      ],
    };

    applyFrame(renderer, frame);

    expect(renderer.updateRows).toHaveBeenCalledWith(9, rowIndexes, 2, cellChars, cellHl);
  });
});
