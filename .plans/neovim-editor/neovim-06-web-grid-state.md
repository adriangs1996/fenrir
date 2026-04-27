---
depends_on:
  - neovim-05-web-msgpack-bridge
---

# Plan: Web Grid State Manager

## Summary

Implement the core data structure that maintains neovim's screen state: grids of cells, highlights, cursor position, and mode information. Processes redraw events and tracks dirty regions for incremental rendering.

## Motivation

This is the "model" in the MVC pattern. The renderer reads from this state. The bridge writes to it. Must be fast — processes thousands of cell updates per redraw batch.

## Prerequisites

- `neovim-05-web-msgpack-bridge` (RedrawParser types)

## Scope

- New file: `apps/web/src/modules/neovim-editor/renderer/GridState.ts`
- New file: `apps/web/src/modules/neovim-editor/renderer/HighlightManager.ts`
- New file: `apps/web/src/modules/neovim-editor/renderer/FontMetrics.ts`
- New file: `apps/web/src/modules/neovim-editor/__tests__/GridState.test.ts`
- New file: `apps/web/src/modules/neovim-editor/__tests__/HighlightManager.test.ts`

## Proposed Changes

### 1. GridState — `renderer/GridState.ts`

```typescript
import type { RedrawEvent, HlAttr, ModeInfo } from "../protocol/RedrawParser";

// ── Types ──

export interface Cell {
  text: string; // UTF-8 character ("" for right half of double-width)
  hlId: number; // Highlight attribute ID (0 = default)
}

export interface Grid {
  id: number;
  width: number;
  height: number;
  cells: Cell[][]; // [row][col]
  // Dirty tracking: set of row indices that need re-render
  dirtyRows: Set<number>;
  // For multigrid: window position
  winId: number | null;
  startRow: number;
  startCol: number;
  // Floating window properties
  isFloat: boolean;
  zindex: number;
  hidden: boolean;
}

export interface CursorState {
  grid: number;
  row: number;
  col: number;
  visible: boolean; // false during busy_start
}

export interface GridStateSnapshot {
  grids: Map<number, Grid>;
  cursor: CursorState;
  currentModeIdx: number;
  modeInfo: ModeInfo[];
  title: string;
  mouseEnabled: boolean;
}

// ── Implementation ──

export class GridStateManager {
  private grids = new Map<number, Grid>();
  private cursor: CursorState = { grid: 1, row: 0, col: 0, visible: true };
  private currentModeIdx = 0;
  private modeInfo: ModeInfo[] = [];
  private title = "";
  private mouseEnabled = true;

  // Callbacks
  private onFlush: (() => void) | null = null;
  private onBell: (() => void) | null = null;

  constructor(options?: { onFlush?: () => void; onBell?: () => void }) {
    this.onFlush = options?.onFlush ?? null;
    this.onBell = options?.onBell ?? null;
  }

  /** Process a batch of redraw events. Call after parsing. */
  processEvents(events: RedrawEvent[]): void {
    for (const event of events) {
      this.processEvent(event);
    }
  }

  /** Get current state snapshot (for renderer) */
  getSnapshot(): GridStateSnapshot {
    return {
      grids: this.grids,
      cursor: { ...this.cursor },
      currentModeIdx: this.currentModeIdx,
      modeInfo: this.modeInfo,
      title: this.title,
      mouseEnabled: this.mouseEnabled,
    };
  }

  /** Get a single grid */
  getGrid(id: number): Grid | undefined {
    return this.grids.get(id);
  }

  /** Get current mode */
  getCurrentMode(): ModeInfo | undefined {
    return this.modeInfo[this.currentModeIdx];
  }

  /** Clear all dirty flags (called after render) */
  clearDirty(): void {
    for (const grid of this.grids.values()) {
      grid.dirtyRows.clear();
    }
  }

  /** Reset all state */
  reset(): void {
    this.grids.clear();
    this.cursor = { grid: 1, row: 0, col: 0, visible: true };
    this.currentModeIdx = 0;
    this.modeInfo = [];
    this.title = "";
    this.mouseEnabled = true;
  }

  // ── Event Processing ──

  private processEvent(event: RedrawEvent): void {
    switch (event.type) {
      case "grid_resize":
        this.handleGridResize(event);
        break;
      case "grid_line":
        this.handleGridLine(event);
        break;
      case "grid_scroll":
        this.handleGridScroll(event);
        break;
      case "grid_clear":
        this.handleGridClear(event);
        break;
      case "grid_cursor_goto":
        this.handleGridCursorGoto(event);
        break;
      case "grid_destroy":
        this.handleGridDestroy(event);
        break;
      case "hl_attr_define":
        this.handleHlAttrDefine(event);
        break;
      case "default_colors_set":
        this.handleDefaultColorsSet(event);
        break;
      case "mode_info_set":
        this.handleModeInfoSet(event);
        break;
      case "mode_change":
        this.handleModeChange(event);
        break;
      case "option_set":
        this.handleOptionSet(event);
        break;
      case "flush":
        this.handleFlush();
        break;
      case "win_pos":
        this.handleWinPos(event);
        break;
      case "win_float_pos":
        this.handleWinFloatPos(event);
        break;
      case "win_hide":
        this.handleWinHide(event);
        break;
      case "win_close":
        this.handleWinClose(event);
        break;
      case "win_viewport":
        /* store for smooth scrolling later */ break;
      case "set_title":
        this.title = event.title;
        break;
      case "busy_start":
        this.cursor.visible = false;
        break;
      case "busy_stop":
        this.cursor.visible = true;
        break;
      case "bell":
        this.onBell?.();
        break;
      case "mouse_on":
        this.mouseEnabled = true;
        break;
      case "mouse_off":
        this.mouseEnabled = false;
        break;
      default:
        break; // Forward-compatible
    }
  }

  private handleGridResize(event: GridResizeEvent): void {
    let grid = this.grids.get(event.grid);
    if (!grid) {
      grid = this.createGrid(event.grid, event.width, event.height);
      this.grids.set(event.grid, grid);
    } else {
      this.resizeGrid(grid, event.width, event.height);
    }
  }

  private handleGridLine(event: GridLineEvent): void {
    const grid = this.grids.get(event.grid);
    if (!grid) return;

    const row = grid.cells[event.row];
    if (!row) return;

    let col = event.colStart;
    for (const cell of event.cells) {
      for (let r = 0; r < cell.repeat; r++) {
        if (col < grid.width) {
          row[col] = { text: cell.text, hlId: cell.hlId };
          col++;
        }
      }
    }

    grid.dirtyRows.add(event.row);
  }

  private handleGridScroll(event: GridScrollEvent): void {
    const grid = this.grids.get(event.grid);
    if (!grid) return;

    const { top, bot, left, right, rows: scrollRows } = event;

    if (scrollRows > 0) {
      // Scroll UP: move rows up, new empty rows at bottom
      for (let row = top; row < bot - scrollRows; row++) {
        for (let col = left; col < right; col++) {
          grid.cells[row][col] = { ...grid.cells[row + scrollRows][col] };
        }
      }
    } else if (scrollRows < 0) {
      // Scroll DOWN: move rows down, new empty rows at top
      for (let row = bot - 1; row >= top - scrollRows; row--) {
        for (let col = left; col < right; col++) {
          grid.cells[row][col] = { ...grid.cells[row + scrollRows][col] };
        }
      }
    }

    // Mark all scrolled rows as dirty
    for (let row = top; row < bot; row++) {
      grid.dirtyRows.add(row);
    }
  }

  private handleGridClear(event: GridClearEvent): void {
    const grid = this.grids.get(event.grid);
    if (!grid) return;

    for (let row = 0; row < grid.height; row++) {
      for (let col = 0; col < grid.width; col++) {
        grid.cells[row][col] = { text: " ", hlId: 0 };
      }
      grid.dirtyRows.add(row);
    }
  }

  private handleGridCursorGoto(event: GridCursorGotoEvent): void {
    // Mark old cursor row dirty (needs re-render without cursor)
    const oldGrid = this.grids.get(this.cursor.grid);
    if (oldGrid) oldGrid.dirtyRows.add(this.cursor.row);

    this.cursor.grid = event.grid;
    this.cursor.row = event.row;
    this.cursor.col = event.col;

    // Mark new cursor row dirty
    const newGrid = this.grids.get(event.grid);
    if (newGrid) newGrid.dirtyRows.add(event.row);
  }

  private handleFlush(): void {
    this.onFlush?.();
  }

  // ... remaining handlers follow same pattern
  // createGrid, resizeGrid are helper methods that allocate Cell[][] arrays
}
```

**Key implementation details**:

- `createGrid(id, w, h)`: Allocate `Cell[h][w]` filled with `{ text: " ", hlId: 0 }`
- `resizeGrid(grid, w, h)`: Grow/shrink Cell arrays, preserve existing content where possible
- `handleHlAttrDefine`: Delegates to HighlightManager (see below)
- `handleDefaultColorsSet`: Delegates to HighlightManager
- `handleWinPos/WinFloatPos/WinHide/WinClose`: Update grid metadata (position, float props, hidden flag)

### 2. HighlightManager — `renderer/HighlightManager.ts`

Manages highlight attribute definitions and resolves final colors for rendering:

```typescript
export interface ResolvedHighlight {
  fg: string; // CSS color "#RRGGBB"
  bg: string; // CSS color "#RRGGBB"
  sp: string; // Special color for underline
  bold: boolean;
  italic: boolean;
  underline: boolean;
  undercurl: boolean;
  underdouble: boolean;
  underdotted: boolean;
  underdashed: boolean;
  strikethrough: boolean;
  reverse: boolean;
  blend: number; // 0-100
}

export class HighlightManager {
  private attrs = new Map<number, HlAttr>();
  private defaultFg = 0xffffff;
  private defaultBg = 0x000000;
  private defaultSp = 0xff0000;
  // Cache resolved highlights to avoid re-computing
  private resolvedCache = new Map<number, ResolvedHighlight>();

  setDefaultColors(fg: number, bg: number, sp: number): void {
    this.defaultFg = fg;
    this.defaultBg = bg;
    this.defaultSp = sp;
    this.resolvedCache.clear(); // Invalidate cache
  }

  defineAttr(id: number, attr: HlAttr): void {
    this.attrs.set(id, attr);
    this.resolvedCache.delete(id); // Invalidate this entry
  }

  /** Resolve highlight ID to concrete CSS colors and flags */
  resolve(hlId: number): ResolvedHighlight {
    const cached = this.resolvedCache.get(hlId);
    if (cached) return cached;

    const attr = this.attrs.get(hlId);
    let fg = attr?.foreground ?? this.defaultFg;
    let bg = attr?.background ?? this.defaultBg;
    const sp = attr?.special ?? this.defaultSp;

    // Handle reverse: swap fg/bg
    if (attr?.reverse) {
      [fg, bg] = [bg, fg];
    }

    const resolved: ResolvedHighlight = {
      fg: rgbIntToCss(fg),
      bg: rgbIntToCss(bg),
      sp: rgbIntToCss(sp),
      bold: attr?.bold ?? false,
      italic: attr?.italic ?? false,
      underline: attr?.underline ?? false,
      undercurl: attr?.undercurl ?? false,
      underdouble: attr?.underdouble ?? false,
      underdotted: attr?.underdotted ?? false,
      underdashed: attr?.underdashed ?? false,
      strikethrough: attr?.strikethrough ?? false,
      reverse: false, // Already applied
      blend: attr?.blend ?? 0,
    };

    this.resolvedCache.set(hlId, resolved);
    return resolved;
  }

  reset(): void {
    this.attrs.clear();
    this.resolvedCache.clear();
  }
}

function rgbIntToCss(rgb: number): string {
  const r = (rgb >> 16) & 0xff;
  const g = (rgb >> 8) & 0xff;
  const b = rgb & 0xff;
  return `#${r.toString(16).padStart(2, "0")}${g.toString(16).padStart(2, "0")}${b.toString(16).padStart(2, "0")}`;
}
```

### 3. FontMetrics — `renderer/FontMetrics.ts`

Measures monospace font cell dimensions:

```typescript
export interface CellDimensions {
  width: number; // Cell width in pixels
  height: number; // Cell height in pixels
  baseline: number; // Distance from top to text baseline
}

/**
 * Measure a monospace font's cell dimensions.
 * Uses an offscreen canvas to measure character width/height.
 */
export function measureCellDimensions(
  fontFamily: string,
  fontSize: number,
  lineHeight: number = 1.2,
): CellDimensions {
  const canvas = new OffscreenCanvas(100, 100);
  const ctx = canvas.getContext("2d")!;

  ctx.font = `${fontSize}px ${fontFamily}`;
  const metrics = ctx.measureText("M");

  const width = Math.ceil(metrics.width);
  const height = Math.ceil(fontSize * lineHeight);
  const baseline = Math.ceil(metrics.actualBoundingBoxAscent);

  return { width, height, baseline };
}

/**
 * Calculate grid dimensions from container size and cell dimensions.
 */
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

### 4. Integration with HighlightManager

`GridStateManager` owns a `HighlightManager` instance:

```typescript
class GridStateManager {
  readonly highlights = new HighlightManager();

  private handleHlAttrDefine(event: HlAttrDefineEvent): void {
    this.highlights.defineAttr(event.id, event.rgbAttr);
  }

  private handleDefaultColorsSet(event: DefaultColorsSetEvent): void {
    this.highlights.setDefaultColors(event.rgbFg, event.rgbBg, event.rgbSp);
  }
}
```

### 5. Tests

**GridState.test.ts**:

1. `grid_resize` creates new grid with correct dimensions
2. `grid_line` writes cells at correct positions
3. `grid_line` cell hl_id inheritance from previous cell
4. `grid_line` repeat cells expand correctly
5. `grid_scroll` up: rows shift, dirty tracking correct
6. `grid_scroll` down: rows shift correctly
7. `grid_clear` fills all cells with space + hlId 0
8. `grid_cursor_goto` updates cursor and marks old/new rows dirty
9. `flush` calls onFlush callback
10. `busy_start`/`busy_stop` toggles cursor visibility
11. `mode_change` updates currentModeIdx
12. `win_pos` positions grid correctly
13. Dirty tracking: only modified rows in dirtyRows set
14. `clearDirty` resets all dirty flags
15. `reset` clears all state

**HighlightManager.test.ts**:

1. Default colors used when attr has no fg/bg
2. Attr-specific colors override defaults
3. Reverse swaps fg/bg
4. `rgbIntToCss` converts correctly (0xFF0000 → "#ff0000")
5. Cache invalidation on default color change
6. Cache invalidation on attr redefine
7. Bold/italic/underline flags resolve correctly
8. Blend value propagates

## Validation

- `bun test apps/web/src/modules/neovim-editor/__tests__/GridState.test.ts`
- `bun test apps/web/src/modules/neovim-editor/__tests__/HighlightManager.test.ts`
- `bun typecheck`

## Done Criteria

- GridStateManager processes all critical redraw events
- Dirty-row tracking enables incremental rendering
- HighlightManager resolves hlId → concrete CSS colors with caching
- FontMetrics measures monospace cell dimensions
- All 23 test cases pass
- No DOM dependency — all pure computation, testable without browser
