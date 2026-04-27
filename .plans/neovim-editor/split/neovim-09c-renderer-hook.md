---
depends_on:
  - neovim-06e-font-metrics-tests
  - neovim-07c-cursor-renderer
  - neovim-07e-webgl-composite
---

# Plan 09c: useNeovimRenderer Hook

## Goal

Wire grid state, canvas renderer, WebGL compositor, cursor renderer, and rAF-coalesced render pipeline behind a single hook.

## Scope

- New file: `apps/web/src/modules/neovim-editor/hooks/useNeovimRenderer.ts`

## Steps

### Step 1. Hook scaffold

```typescript
import { useRef, useEffect, useCallback, useMemo } from "react";
import type { RefObject } from "react";
import { GridStateManager } from "../renderer/GridState";
import { CanvasRenderer } from "../renderer/CanvasRenderer";
import { WebGLCompositor, type CompositeLayer } from "../renderer/WebGLCompositor";
import { CursorRenderer } from "../renderer/CursorRenderer";
import {
  measureCellDimensions,
  calculateGridDimensions,
  type CellDimensions,
} from "../renderer/FontMetrics";
import type { RedrawEvent } from "../protocol/RedrawParser";

interface UseNeovimRendererOptions {
  canvasRef: RefObject<HTMLCanvasElement>;
  fontFamily: string;
  fontSize: number;
  lineHeight: number;
}
```

### Step 2. State + initialization

```typescript
export function useNeovimRenderer(options: UseNeovimRendererOptions) {
  const gridStateRef = useRef<GridStateManager | null>(null);
  const rendererRef = useRef<CanvasRenderer | null>(null);
  const compositorRef = useRef<WebGLCompositor | null>(null);
  const cursorRendererRef = useRef<CursorRenderer | null>(null);

  // OffscreenCanvas per grid id (for compositing)
  const gridCanvasRef = useRef<Map<number, OffscreenCanvas>>(new Map());

  const cellDimensions: CellDimensions = useMemo(
    () => measureCellDimensions(options.fontFamily, options.fontSize, options.lineHeight),
    [options.fontFamily, options.fontSize, options.lineHeight],
  );

  const rafRef = useRef<number>(0);

  const scheduleRender = useCallback(() => {
    cancelAnimationFrame(rafRef.current);
    rafRef.current = requestAnimationFrame(() => render());
  }, []);

  // Render fn declared below; fwd-ref via closure
  const render = useCallback(() => {
    const gridState = gridStateRef.current;
    const renderer = rendererRef.current;
    const compositor = compositorRef.current;
    const cursorRenderer = cursorRendererRef.current;
    if (!gridState || !renderer || !compositor) return;

    const snapshot = gridState.getSnapshot();

    // Render each grid with dirty rows onto its OffscreenCanvas
    // (For initial implementation we render directly to the visible canvas
    // when only grid 1 is active — defer multigrid composite to a later pass.)
    for (const [, grid] of snapshot.grids) {
      if (grid.dirtyRows.size > 0 || gridCanvasRef.current.size === 0) {
        renderer.renderGrid(grid);
      }
    }

    // Cursor
    const cursorVisible =
      snapshot.cursor.visible && (cursorRenderer?.isVisible() ?? true);
    if (cursorVisible) {
      const mode = gridState.getCurrentMode();
      const grid = gridState.getGrid(snapshot.cursor.grid);
      renderer.renderCursor(snapshot.cursor, mode, grid);
    }

    gridState.clearDirty();
  }, []);

  // Initialize on canvas mount
  useEffect(() => {
    const canvas = options.canvasRef.current;
    if (!canvas) return;

    const dpr = window.devicePixelRatio || 1;

    const gridState = new GridStateManager({
      onFlush: () => scheduleRender(),
    });

    const renderer = new CanvasRenderer({
      canvas,
      highlightManager: gridState.highlights,
      cellDimensions,
      fontFamily: options.fontFamily,
      fontSize: options.fontSize,
      devicePixelRatio: dpr,
    });

    const compositor = new WebGLCompositor(canvas);
    const cursorRenderer = new CursorRenderer({
      onBlinkToggle: () => scheduleRender(),
    });

    gridStateRef.current = gridState;
    rendererRef.current = renderer;
    compositorRef.current = compositor;
    cursorRendererRef.current = cursorRenderer;

    return () => {
      cancelAnimationFrame(rafRef.current);
      compositor.dispose();
      cursorRenderer.dispose();
      gridState.reset();
      gridStateRef.current = null;
      rendererRef.current = null;
      compositorRef.current = null;
      cursorRendererRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [options.canvasRef, cellDimensions]);
```

### Step 3. Public API of hook

```typescript
  const processRedraw = useCallback((events: RedrawEvent[]) => {
    gridStateRef.current?.processEvents(events);
  }, []);

  const getGridDimensions = useCallback(
    (containerWidth: number, containerHeight: number) =>
      calculateGridDimensions(containerWidth, containerHeight, cellDimensions),
    [cellDimensions],
  );

  return {
    processRedraw,
    getGridDimensions,
    cellDimensions,
  };
}
```

### Step 4. Multigrid composition (deferred)

The above renders directly to the visible canvas. Multigrid + WebGL compositing requires:

1. Create one `OffscreenCanvas` per grid id; resize on `grid_resize`.
2. Direct `CanvasRenderer.renderGrid(grid, offscreenCtx)` to per-grid offscreen surfaces (requires CanvasRenderer to accept a target context — small extension).
3. Build `CompositeLayer[]` from `snapshot.grids` (skip hidden, sorted by zindex).
4. Call `compositor.composite(layers)` to produce the final visible canvas.

Mark this in code with `// TODO(perf): multigrid compositing` and ship the simpler single-canvas path first.

### Step 5. Resize integration

`useNeovimRenderer` does NOT own the ResizeObserver — that's the component's job (09e). The hook exposes `getGridDimensions` for the component to compute (cols, rows) and call `bridge.resize(...)`.

## Validation

- `bun typecheck`
- `bun lint`

## Done Criteria

- Hook initializes `GridStateManager`, `CanvasRenderer`, `WebGLCompositor`, `CursorRenderer` on mount
- `processRedraw` feeds events into grid state
- `flush` scheduled via rAF coalescing
- Cursor visibility honors both `gridState.cursor.visible` and `cursorRenderer.isVisible()`
- Cleanup on unmount: cancel rAF, dispose compositor + cursor, reset grid state
- TODO marker for multigrid composition
