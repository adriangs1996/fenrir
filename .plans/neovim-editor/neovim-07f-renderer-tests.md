---
depends_on:
  - neovim-07b-canvas-renderer-cursor
  - neovim-07c-cursor-renderer
---

# Plan 07f: Renderer Tests

## Goal

Vitest suite for `CanvasRenderer` using `jest-canvas-mock` (or `vitest-canvas-mock`) so that tests run without a real DOM canvas.

## Scope

- Install: `bun add -D vitest-canvas-mock`
- Modify: `apps/web/vitest.config.ts` (or equivalent) to register canvas mock setup file
- New file: `apps/web/src/modules/neovim-editor/__tests__/CanvasRenderer.test.ts`

## Steps

### Step 1. Install + register mock

```bash
cd apps/web && bun add -D vitest-canvas-mock
```

Add to vitest setup (e.g., `apps/web/vitest.setup.ts`):

```typescript
import "vitest-canvas-mock";
```

Ensure `vitest.config.ts` references this setup file via `setupFiles: ["./vitest.setup.ts"]`.

### Step 2. Test scaffold

```typescript
import { describe, it, expect } from "vitest";
import { CanvasRenderer } from "../renderer/CanvasRenderer";
import { HighlightManager } from "../renderer/HighlightManager";
import { GridStateManager } from "../renderer/GridState";

function makeCanvas(width = 800, height = 600): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  Object.defineProperty(canvas, "clientWidth", { value: width });
  Object.defineProperty(canvas, "clientHeight", { value: height });
  return canvas;
}

function makeRenderer(): { renderer: CanvasRenderer; gs: GridStateManager } {
  const canvas = makeCanvas();
  const hm = new HighlightManager();
  const gs = new GridStateManager();
  // Inject same HighlightManager into renderer that GridStateManager uses
  const renderer = new CanvasRenderer({
    canvas,
    highlightManager: gs.highlights,
    cellDimensions: { width: 8, height: 16, baseline: 12 },
    fontFamily: "monospace",
    fontSize: 14,
    devicePixelRatio: 1,
  });
  return { renderer, gs };
}
```

### Step 3. Cases

10 cases:

1. `renderGrid` draws characters at expected pixel positions (verify `fillText` calls)
2. Background `fillRect` per highlighted run
3. Bold/italic font string differs (`"bold 14px monospace"` vs `"italic 14px monospace"`)
4. Underline variants: assert `setLineDash`, `bezierCurveTo`, or `fillRect` calls per variant
5. Strikethrough: `fillRect` at vertical center
6. Dirty-row optimization: only rows in `grid.dirtyRows` are touched (mock spies on context fn calls per row)
7. Block cursor: 2 fillRect (bg block + glyph) calls at cursor position
8. Vertical cursor: 1 thin fillRect with width = `cell.width * percent / 100`
9. Horizontal cursor: 1 thin fillRect at bottom of cell
10. `resize` updates `canvas.width / canvas.height` and re-applies DPR scale

### Step 4. Mock expectations

Use `vitest-canvas-mock` jest-style expectations:

```typescript
expect(ctx.__getEvents()).toContainEqual(expect.objectContaining({
  type: "fillRect",
  // x, y, width, height...
}));
```

Or read `ctx.__getDrawCalls()` directly (depending on the mock API version).

### Step 5. CursorRenderer.test.ts (optional)

If time permits, add separate test for `CursorRenderer`:

1. `setBlinkParams(0,0,0)` keeps `isVisible` true forever
2. `setBlinkParams(0, 100, 100)` toggles every 100ms (use fake timers)
3. `dispose` clears timers; `isVisible` reverts to true

## Validation

- `bun run test apps/web/src/modules/neovim-editor/__tests__/CanvasRenderer.test.ts`
- `bun typecheck`

## Done Criteria

- Canvas mock setup registered globally
- 10 CanvasRenderer tests passing
- (Optional) 3 CursorRenderer tests passing
- No real canvas required
