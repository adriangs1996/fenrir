---
depends_on:
  - neovim-06c-window-mode-handlers
  - neovim-06d-highlight-manager
---

# Plan 06e: FontMetrics + GridState/Highlight Tests

## Goal

Implement `FontMetrics` (cell measurement) and add Vitest suites for `GridStateManager` and `HighlightManager`.

## Scope

- New file: `apps/web/src/modules/neovim-editor/renderer/FontMetrics.ts`
- New file: `apps/web/src/modules/neovim-editor/__tests__/GridState.test.ts`
- New file: `apps/web/src/modules/neovim-editor/__tests__/HighlightManager.test.ts`

## Steps

### Step 1. FontMetrics.ts

```typescript
export interface CellDimensions {
  width: number;     // pixels
  height: number;
  baseline: number;  // top → text baseline
}

/** Measure monospace cell using OffscreenCanvas. Browser only. */
export function measureCellDimensions(
  fontFamily: string,
  fontSize: number,
  lineHeight = 1.2,
): CellDimensions {
  const canvas = new OffscreenCanvas(100, 100);
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    return {
      width: Math.ceil(fontSize * 0.6),
      height: Math.ceil(fontSize * lineHeight),
      baseline: Math.ceil(fontSize * 0.8),
    };
  }
  ctx.font = `${fontSize}px ${fontFamily}`;
  const metrics = ctx.measureText("M");
  const width = Math.ceil(metrics.width);
  const height = Math.ceil(fontSize * lineHeight);
  const baseline =
    Math.ceil(metrics.actualBoundingBoxAscent ?? fontSize * 0.8);
  return { width, height, baseline };
}

/** Compute (cols, rows) given pixel container size. Min 20x5. */
export function calculateGridDimensions(
  containerWidth: number,
  containerHeight: number,
  cellDimensions: CellDimensions,
): { cols: number; rows: number } {
  return {
    cols: Math.max(20, Math.floor(containerWidth / cellDimensions.width)),
    rows: Math.max(5, Math.floor(containerHeight / cellDimensions.height)),
  };
}
```

### Step 2. HighlightManager.test.ts

```typescript
import { describe, it, expect } from "vitest";
import { HighlightManager } from "../renderer/HighlightManager";

describe("HighlightManager", () => {
  it("uses default colors when attr has none", () => { /* ... */ });
  it("attr-specific overrides default", () => { /* ... */ });
  it("reverse swaps fg/bg", () => { /* ... */ });
  it("rgbInt → CSS pads zeros (0xff0000 → '#ff0000')", () => { /* ... */ });
  it("setDefaultColors invalidates entire cache", () => { /* ... */ });
  it("defineAttr invalidates single entry", () => { /* ... */ });
  it("bold/italic/underline flags propagate", () => { /* ... */ });
  it("blend defaults to 0; passes through when set", () => { /* ... */ });
});
```

8 cases — fill in assertions per case.

### Step 3. GridState.test.ts

```typescript
import { describe, it, expect } from "vitest";
import { GridStateManager } from "../renderer/GridState";
import type { RedrawEvent } from "../protocol/RedrawParser";
```

15 cases:

1. `grid_resize` creates grid (correct width/height, all dirty)
2. `grid_line` writes cells at correct positions
3. `grid_line` cell hl_id inheritance
4. `grid_line` repeat expansion
5. `grid_scroll` up: rows shift, dirty tracking covers `[top, bot)`
6. `grid_scroll` down: rows shift correctly
7. `grid_clear` fills with `{ text: " ", hlId: 0 }` and marks all dirty
8. `grid_cursor_goto` updates cursor + marks old/new rows dirty
9. `flush` calls `onFlush` callback
10. `busy_start` → cursor.visible=false; `busy_stop` → true
11. `mode_change` updates `currentModeIdx`
12. `win_pos` sets `startRow`/`startCol` and clears `isFloat`
13. Dirty tracking: only modified rows in `dirtyRows`
14. `clearDirty` empties all dirty sets
15. `reset` clears grids, resets cursor + state

### Step 4. Notes for tests

- For `flush` test, pass `new GridStateManager({ onFlush: vi.fn() })`.
- For OffscreenCanvas — vitest might lack it; FontMetrics tests are NOT in this plan (defer to e2e).

## Validation

- `bun run test apps/web/src/modules/neovim-editor/__tests__/GridState.test.ts`
- `bun run test apps/web/src/modules/neovim-editor/__tests__/HighlightManager.test.ts`
- `bun typecheck`

## Done Criteria

- `FontMetrics` exports `measureCellDimensions` + `calculateGridDimensions`
- 8 highlight tests + 15 grid state tests passing
- No DOM dependency in `GridState.test.ts` (pure logic)
